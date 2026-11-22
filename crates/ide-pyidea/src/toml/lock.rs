//! Locked versions from `uv.lock`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// A distribution name as PEP 503 compares it: lowercase, runs of `-_.` as one `-`.
pub fn normalize(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut separator = false;
    for c in name.trim().chars() {
        if matches!(c, '-' | '_' | '.') {
            separator = true;
        } else {
            if separator && !out.is_empty() {
                out.push('-');
            }
            separator = false;
            out.extend(c.to_lowercase());
        }
    }
    out
}

/// The versions `uv.lock` pins, by normalized name (several when markers fork the resolution);
/// packages without a version (the project itself, editable sources) are left out.
pub fn locked_versions(text: &str) -> BTreeMap<String, Vec<String>> {
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let Ok(table) = text.parse::<::toml::Table>() else { return out };
    let Some(packages) = table.get("package").and_then(|p| p.as_array()) else { return out };
    for package in packages {
        let (Some(name), Some(version)) =
            (package.get("name").and_then(|v| v.as_str()), package.get("version").and_then(|v| v.as_str()))
        else {
            continue;
        };
        let versions = out.entry(normalize(name)).or_default();
        if !versions.iter().any(|v| v == version) {
            versions.push(version.to_owned());
        }
    }
    out
}

/// The nearest `uv.lock` from `dir` up to the project root (a uv workspace locks at its root).
pub fn uv_lock(dir: &Path, root: &Path) -> Option<PathBuf> {
    dir.ancestors().take_while(|d| d.starts_with(root)).map(|d| d.join("uv.lock")).find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_like_pep_503() {
        assert_eq!(normalize("Friendly_Bard"), "friendly-bard");
        assert_eq!(normalize("zope.interface"), "zope-interface");
        assert_eq!(normalize("a-_.b"), "a-b");
    }

    #[test]
    fn reads_pinned_versions() {
        let lock = r#"
version = 1
requires-python = ">=3.11"

[[package]]
name = "web-app"
version = "0.1.0"
source = { editable = "." }

[[package]]
name = "Flask"
version = "3.1.3"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "numpy"
version = "2.2.6"
resolution-markers = ["python_full_version < '3.11'"]

[[package]]
name = "numpy"
version = "2.3.1"
resolution-markers = ["python_full_version >= '3.11'"]

[[package]]
name = "local-tool"
source = { directory = "tools/local" }
"#;
        let locked = locked_versions(lock);
        assert_eq!(locked["flask"], ["3.1.3"]);
        assert_eq!(locked["numpy"], ["2.2.6", "2.3.1"]);
        assert!(!locked.contains_key("local-tool"));
        assert!(locked_versions("not = [toml").is_empty());
    }

    #[test]
    fn finds_the_nearest_lock_inside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("p");
        std::fs::create_dir_all(root.join("packages/api")).unwrap();
        std::fs::write(root.join("uv.lock"), "version = 1\n").unwrap();
        std::fs::write(dir.path().join("uv.lock"), "version = 1\n").unwrap();
        assert_eq!(uv_lock(&root.join("packages/api"), &root), Some(root.join("uv.lock")));
        std::fs::remove_file(root.join("uv.lock")).unwrap();
        assert_eq!(uv_lock(&root.join("packages/api"), &root), None);
    }
}
