//! The requirements a `pyproject.toml` declares, by group.

use crate::toml::lock::normalize;
use serde::{Deserialize, Serialize};
use toml_edit::{Document, Item};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PythonDependencyKind {
    /// `[project] dependencies`.
    Runtime,
    /// `[project.optional-dependencies]`.
    Extra,
    /// PEP 735 `[dependency-groups]`.
    Group,
    /// uv's legacy `[tool.uv] dev-dependencies` (its `dev` group).
    UvDev,
    /// `[build-system] requires`: isolated, never installed into the environment.
    Build,
}

/// A group of requirements: `name` is the extra / group name, empty for the others.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonDependencyGroupRef {
    pub kind: PythonDependencyKind,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonDeclaredRequirement {
    /// The PEP 508 string.
    pub text: String,
    /// Its normalized distribution name; empty for a URL or path requirement.
    pub package: String,
    /// UTF-16 span of the string's contents in the file; none for a staged requirement.
    pub from: Option<u32>,
    pub to: Option<u32>,
    /// Added by a staged edit (not in the file yet).
    pub staged: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonDeclaredGroup {
    pub group: PythonDependencyGroupRef,
    pub requirements: Vec<PythonDeclaredRequirement>,
    /// `{ include-group = "…" }` entries of a dependency group.
    pub includes: Vec<String>,
}

/// The distribution name a requirement starts with (normalized), if it names one.
pub fn requirement_name(requirement: &str) -> String {
    let requirement = requirement.trim();
    let end = requirement
        .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
        .unwrap_or(requirement.len());
    let rest = requirement[end..].trim_start();
    if end == 0 || rest.starts_with([':', '/', '\\']) {
        return String::new();
    }
    normalize(&requirement[..end])
}

fn utf16(text: &str, byte: usize) -> u32 {
    text[..byte].encode_utf16().count() as u32
}

fn group(kind: PythonDependencyKind, name: &str) -> PythonDependencyGroupRef {
    PythonDependencyGroupRef { kind, name: name.to_owned() }
}

/// The project's declared groups, in the file's order within each kind: runtime, extras,
/// dependency groups, uv's dev dependencies, build requirements. Runtime is always present.
pub fn declared(text: &str) -> Result<Vec<PythonDeclaredGroup>, String> {
    let doc = text.parse::<Document<String>>().map_err(|e| e.to_string())?;
    let mut arrays: Vec<(PythonDependencyGroupRef, Option<&Item>)> = Vec::new();
    let project = doc.get("project").and_then(Item::as_table_like);
    arrays.push((group(PythonDependencyKind::Runtime, ""), project.and_then(|p| p.get("dependencies"))));
    if let Some(extras) = project.and_then(|p| p.get("optional-dependencies")).and_then(Item::as_table_like) {
        arrays.extend(extras.iter().map(|(name, item)| (group(PythonDependencyKind::Extra, name), Some(item))));
    }
    if let Some(groups) = doc.get("dependency-groups").and_then(Item::as_table_like) {
        arrays.extend(groups.iter().map(|(name, item)| (group(PythonDependencyKind::Group, name), Some(item))));
    }
    let uv = doc.get("tool").and_then(Item::as_table_like).and_then(|t| t.get("uv")).and_then(Item::as_table_like);
    if let Some(dev) = uv.and_then(|uv| uv.get("dev-dependencies")) {
        arrays.push((group(PythonDependencyKind::UvDev, ""), Some(dev)));
    }
    if let Some(requires) = doc.get("build-system").and_then(Item::as_table_like).and_then(|b| b.get("requires")) {
        arrays.push((group(PythonDependencyKind::Build, ""), Some(requires)));
    }
    Ok(arrays
        .into_iter()
        .map(|(group, item)| {
            let mut requirements = Vec::new();
            let mut includes = Vec::new();
            for value in item.and_then(Item::as_array).into_iter().flat_map(|a| a.iter()) {
                if let Some(include) =
                    value.as_inline_table().and_then(|t| t.get("include-group")).and_then(|v| v.as_str())
                {
                    includes.push(include.to_owned());
                    continue;
                }
                let Some(requirement) = value.as_str() else { continue };
                let span = value.span().and_then(|span| {
                    let raw = text.get(span.clone())?;
                    let delimiter = if raw.starts_with("\"\"\"") || raw.starts_with("'''") { 3 } else { 1 };
                    Some((utf16(text, span.start + delimiter), utf16(text, span.end - delimiter)))
                });
                requirements.push(PythonDeclaredRequirement {
                    text: requirement.to_owned(),
                    package: requirement_name(requirement),
                    from: span.map(|s| s.0),
                    to: span.map(|s| s.1),
                    staged: false,
                });
            }
            PythonDeclaredGroup { group, requirements, includes }
        })
        .collect())
}

/// The groups of `edited` (the file with staged edits applied), with the spans of the
/// requirements the file on disk (`saved`) has, and the others marked staged.
pub fn declared_with_staged(saved: &str, edited: &str) -> Result<Vec<PythonDeclaredGroup>, String> {
    let on_disk = declared(saved)?;
    let mut groups = declared(edited)?;
    for g in &mut groups {
        let disk = on_disk.iter().find(|d| d.group == g.group);
        let mut used = vec![false; disk.map_or(0, |d| d.requirements.len())];
        for r in &mut g.requirements {
            let found =
                disk.and_then(|d| d.requirements.iter().enumerate().find(|(i, s)| !used[*i] && s.text == r.text));
            match found {
                Some((i, s)) => {
                    used[i] = true;
                    r.from = s.from;
                    r.to = s.to;
                }
                None => {
                    r.from = None;
                    r.to = None;
                    r.staged = true;
                }
            }
        }
    }
    Ok(groups)
}

/// `[project] name`.
pub fn project_name(text: &str) -> Option<String> {
    let doc = text.parse::<Document<String>>().ok()?;
    doc.get("project")?.as_table_like()?.get("name")?.as_str().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PYPROJECT: &str = r#"[project]
name = "demo"
dependencies = [
    "Flask>=3.0",
    "requests[socks]>=2.31 ; python_version >= '3.11'",
]

[project.optional-dependencies]
docs = ["sphinx"]

[dependency-groups]
test = ["pytest>=8", { include-group = "lint" }]
lint = ["ruff"]

[tool.uv]
dev-dependencies = ["ipython"]

[build-system]
requires = ["hatchling"]
"#;

    #[test]
    fn lists_every_group_with_spans() {
        let groups = declared(PYPROJECT).unwrap();
        let kinds: Vec<_> = groups.iter().map(|g| (g.group.kind, g.group.name.as_str())).collect();
        assert_eq!(
            kinds,
            [
                (PythonDependencyKind::Runtime, ""),
                (PythonDependencyKind::Extra, "docs"),
                (PythonDependencyKind::Group, "test"),
                (PythonDependencyKind::Group, "lint"),
                (PythonDependencyKind::UvDev, ""),
                (PythonDependencyKind::Build, ""),
            ]
        );
        let flask = &groups[0].requirements[0];
        assert_eq!((flask.package.as_str(), flask.staged), ("flask", false));
        let units: Vec<u16> = PYPROJECT.encode_utf16().collect();
        let span = String::from_utf16(&units[flask.from.unwrap() as usize..flask.to.unwrap() as usize]).unwrap();
        assert_eq!(span, "Flask>=3.0");
        assert_eq!(groups[0].requirements[1].package, "requests");
        assert_eq!(groups[2].includes, ["lint"]);
        assert_eq!(project_name(PYPROJECT).as_deref(), Some("demo"));
    }

    #[test]
    fn runtime_is_listed_even_when_missing() {
        let groups = declared("[project]\nname = \"x\"\n").unwrap();
        assert_eq!(groups.len(), 1);
        assert!(groups[0].requirements.is_empty());
        assert!(declared("not = [toml").is_err());
    }

    #[test]
    fn marks_staged_requirements() {
        let edited = PYPROJECT.replace("\"sphinx\"", "\"sphinx\", \"furo\"");
        let groups = declared_with_staged(PYPROJECT, &edited).unwrap();
        let docs = &groups[1].requirements;
        assert!(!docs[0].staged && docs[0].from.is_some());
        assert!(docs[1].staged && docs[1].from.is_none());
    }

    #[test]
    fn names_requirements() {
        assert_eq!(requirement_name("Zope.Interface[x]>=5"), "zope-interface");
        assert_eq!(requirement_name("pkg @ https://example.com/p.whl"), "pkg");
        assert_eq!(requirement_name("./local/path"), "");
        assert_eq!(requirement_name("https://example.com/p.whl"), "");
    }
}
