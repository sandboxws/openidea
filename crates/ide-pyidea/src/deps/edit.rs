//! Staged edits of a `pyproject.toml`'s requirements, applied with `toml_edit` so the rest of
//! the file (formatting, comments, other tables) stays as written.

use super::manifest::{PythonDependencyGroupRef, PythonDependencyKind};
use serde::{Deserialize, Serialize};
use toml_edit::{Array, DocumentMut, Item, Table, Value};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum PythonStagedEdit {
    Add {
        group: PythonDependencyGroupRef,
        requirement: String,
    },
    Remove {
        group: PythonDependencyGroupRef,
        requirement: String,
    },
    Replace {
        group: PythonDependencyGroupRef,
        requirement: String,
        with: String,
    },
    Move {
        group: PythonDependencyGroupRef,
        to: PythonDependencyGroupRef,
        requirement: String,
    },
    /// Lock a newer version within the declared constraints (`uv lock --upgrade-package`);
    /// the file doesn't change.
    Upgrade {
        package: String,
    },
}

fn label(group: &PythonDependencyGroupRef) -> String {
    match group.kind {
        PythonDependencyKind::Runtime => "the runtime dependencies".into(),
        PythonDependencyKind::Extra => format!("the `{}` extra", group.name),
        PythonDependencyKind::Group => format!("the `{}` group", group.name),
        PythonDependencyKind::UvDev => "uv's dev dependencies".into(),
        PythonDependencyKind::Build => "the build requirements".into(),
    }
}

/// `table[key]` as a table, created (as a section) when missing.
fn table<'a>(parent: &'a mut Table, key: &str) -> Result<&'a mut Table, String> {
    if !parent.contains_key(key) {
        let mut created = Table::new();
        created.set_implicit(true);
        parent.insert(key, Item::Table(created));
    }
    parent[key].as_table_mut().ok_or_else(|| format!("`{key}` is not a table"))
}

/// The array of `group`, created when `create`.
fn array<'a>(
    doc: &'a mut DocumentMut,
    group: &PythonDependencyGroupRef,
    create: bool,
) -> Result<Option<&'a mut Array>, String> {
    let root = doc.as_table_mut();
    let (parent, key): (&mut Table, &str) = match group.kind {
        PythonDependencyKind::Runtime => (table(root, "project")?, "dependencies"),
        PythonDependencyKind::Extra => {
            let project = table(root, "project")?;
            let extras = table(project, "optional-dependencies")?;
            extras.set_implicit(false);
            (extras, group.name.as_str())
        }
        PythonDependencyKind::Group => {
            let groups = table(root, "dependency-groups")?;
            groups.set_implicit(false);
            (groups, group.name.as_str())
        }
        PythonDependencyKind::UvDev => (table(table(root, "tool")?, "uv")?, "dev-dependencies"),
        PythonDependencyKind::Build => (table(root, "build-system")?, "requires"),
    };
    if !parent.contains_key(key) {
        if !create {
            return Ok(None);
        }
        parent.insert(key, Item::Value(Value::Array(Array::new())));
    }
    parent[key].as_array_mut().map(Some).ok_or_else(|| format!("{} is not a list", label(group)))
}

fn position(array: &Array, requirement: &str) -> Option<usize> {
    array.iter().position(|v| v.as_str().is_some_and(|s| s.trim() == requirement.trim()))
}

/// Appends like the array's own entries: one per line when it's written that way.
fn push(array: &mut Array, requirement: &str) {
    let mut value = Value::from(requirement);
    let prefix = array.iter().last().and_then(|v| v.decor().prefix()).and_then(|p| p.as_str()).map(str::to_owned);
    match prefix {
        Some(prefix) if prefix.contains('\n') => {
            // Only the indentation: a comment before it belongs to the previous entry's line.
            let indent = prefix.rsplit('\n').next().unwrap_or_default();
            value.decor_mut().set_prefix(format!("\n{indent}"));
            array.push_formatted(value);
            array.set_trailing_comma(true);
            if !array.trailing().as_str().is_some_and(|t| t.contains('\n')) {
                array.set_trailing("\n");
            }
        }
        _ if array.is_empty() => array.push_formatted(value),
        _ => {
            value.decor_mut().set_prefix(" ");
            array.push_formatted(value);
        }
    }
}

fn remove(array: &mut Array, at: usize) {
    let removed = array.remove(at);
    // The next entry takes the removed one's place, prefix included (`[ "b"]` otherwise).
    if at < array.len()
        && let Some(prefix) = removed.decor().prefix().cloned()
        && let Some(next) = array.get_mut(at)
    {
        next.decor_mut().set_prefix(prefix);
    }
}

fn missing(requirement: &str, group: &PythonDependencyGroupRef) -> String {
    format!("`{requirement}` is no longer in {}", label(group))
}

fn apply_one(doc: &mut DocumentMut, edit: &PythonStagedEdit) -> Result<(), String> {
    match edit {
        PythonStagedEdit::Add { group, requirement } => {
            let array = array(doc, group, true)?.ok_or_else(|| missing(requirement, group))?;
            if position(array, requirement).is_none() {
                push(array, requirement.trim());
            }
        }
        PythonStagedEdit::Remove { group, requirement } => {
            let array = array(doc, group, false)?.ok_or_else(|| missing(requirement, group))?;
            let at = position(array, requirement).ok_or_else(|| missing(requirement, group))?;
            remove(array, at);
        }
        PythonStagedEdit::Replace { group, requirement, with } => {
            let array = array(doc, group, false)?.ok_or_else(|| missing(requirement, group))?;
            let at = position(array, requirement).ok_or_else(|| missing(requirement, group))?;
            let old = array.get(at).map(|v| v.decor().clone()).unwrap_or_default();
            let mut value = Value::from(with.trim());
            *value.decor_mut() = old;
            array.replace_formatted(at, value);
        }
        PythonStagedEdit::Move { group, to, requirement } => {
            apply_one(doc, &PythonStagedEdit::Remove { group: group.clone(), requirement: requirement.clone() })?;
            apply_one(doc, &PythonStagedEdit::Add { group: to.clone(), requirement: requirement.clone() })?;
        }
        PythonStagedEdit::Upgrade { .. } => {}
    }
    Ok(())
}

/// `text` with `edits` applied in order.
pub fn apply(text: &str, edits: &[PythonStagedEdit]) -> Result<String, String> {
    if edits.iter().all(|e| matches!(e, PythonStagedEdit::Upgrade { .. })) {
        return Ok(text.to_owned());
    }
    let mut doc = text.parse::<DocumentMut>().map_err(|e| e.to_string())?;
    for edit in edits {
        apply_one(&mut doc, edit)?;
    }
    Ok(doc.to_string())
}

/// The packages staged for an upgrade.
pub fn upgrades(edits: &[PythonStagedEdit]) -> Vec<String> {
    edits
        .iter()
        .filter_map(|e| match e {
            PythonStagedEdit::Upgrade { package } => Some(package.clone()),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(kind: PythonDependencyKind, name: &str) -> PythonDependencyGroupRef {
        PythonDependencyGroupRef { kind, name: name.into() }
    }

    const MULTILINE: &str = r#"[project]
name = "demo"
# runtime
dependencies = [
    "flask>=3.0",  # web
    "requests>=2.31",
]

[tool.ruff]
line-length = 100
"#;

    #[test]
    fn adds_like_the_list_is_written() {
        let add =
            PythonStagedEdit::Add { group: g(PythonDependencyKind::Runtime, ""), requirement: "httpx>=0.27".into() };
        let out = apply(MULTILINE, std::slice::from_ref(&add)).unwrap();
        assert!(out.contains("    \"requests>=2.31\",\n    \"httpx>=0.27\",\n]"), "{out}");
        assert!(out.contains("\"flask>=3.0\",  # web") && out.contains("# runtime") && out.contains("[tool.ruff]"));
        // Already there: nothing changes.
        assert_eq!(apply(&out, &[add]).unwrap(), out);
        let inline = apply(
            "[project]\ndependencies = [\"a\"]\n",
            &[PythonStagedEdit::Add { group: g(PythonDependencyKind::Runtime, ""), requirement: "b".into() }],
        )
        .unwrap();
        assert_eq!(inline, "[project]\ndependencies = [\"a\", \"b\"]\n");
    }

    #[test]
    fn creates_missing_groups() {
        let out = apply(
            MULTILINE,
            &[
                PythonStagedEdit::Add {
                    group: g(PythonDependencyKind::Group, "test"),
                    requirement: "pytest>=8".into(),
                },
                PythonStagedEdit::Add { group: g(PythonDependencyKind::Extra, "docs"), requirement: "sphinx".into() },
            ],
        )
        .unwrap();
        assert!(out.contains("[dependency-groups]\ntest = [\"pytest>=8\"]"), "{out}");
        assert!(out.contains("[project.optional-dependencies]\ndocs = [\"sphinx\"]"), "{out}");
        let groups = super::super::manifest::declared(&out).unwrap();
        assert!(groups.iter().any(|x| x.group.name == "test" && x.requirements[0].text == "pytest>=8"));
    }

    #[test]
    fn removes_replaces_and_moves() {
        let runtime = g(PythonDependencyKind::Runtime, "");
        let out = apply(
            MULTILINE,
            &[PythonStagedEdit::Replace {
                group: runtime.clone(),
                requirement: "flask>=3.0".into(),
                with: "flask>=3.1".into(),
            }],
        )
        .unwrap();
        assert!(out.contains("    \"flask>=3.1\",  # web"), "{out}");
        let out = apply(
            MULTILINE,
            &[PythonStagedEdit::Move {
                group: runtime.clone(),
                to: g(PythonDependencyKind::Group, "dev"),
                requirement: "requests>=2.31".into(),
            }],
        )
        .unwrap();
        assert!(!out.contains("    \"requests>=2.31\",\n]"), "{out}");
        assert!(out.contains("dev = [\"requests>=2.31\"]"), "{out}");
        let first = apply(
            "[project]\ndependencies = [\"a\", \"b\"]\n",
            &[PythonStagedEdit::Remove { group: runtime.clone(), requirement: "a".into() }],
        )
        .unwrap();
        assert_eq!(first, "[project]\ndependencies = [\"b\"]\n");
        let gone = apply(MULTILINE, &[PythonStagedEdit::Remove { group: runtime, requirement: "numpy".into() }]);
        assert_eq!(gone.unwrap_err(), "`numpy` is no longer in the runtime dependencies");
    }

    #[test]
    fn upgrades_leave_the_file_alone() {
        let edits = [PythonStagedEdit::Upgrade { package: "flask".into() }];
        assert_eq!(apply(MULTILINE, &edits).unwrap(), MULTILINE);
        assert_eq!(upgrades(&edits), ["flask"]);
    }
}
