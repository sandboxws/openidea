//! Previewing staged changes: a snapshot of the project to resolve in, and what changes in
//! the lock and in the environment.

use crate::toml::lock::{locked_versions, normalize};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;

pub const MAX_FILES: usize = 20_000;
pub const MAX_BYTES: u64 = 256 * 1024 * 1024;

/// Directories a snapshot leaves out: version control, IDE state, caches, dependencies.
const SKIPPED: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".openidea",
    ".idea",
    ".vscode",
    "__pycache__",
    "node_modules",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".nox",
    ".venv",
    "venv",
    ".pixi",
];

fn skipped(dir: &Path) -> bool {
    dir.file_name().and_then(|n| n.to_str()).is_some_and(|n| SKIPPED.contains(&n)) || dir.join("pyvenv.cfg").is_file()
}

/// Copies `root` into `dest` (keeping the layout) for resolving there; fails on a symbolic
/// link (a snapshot holds real files only) or past [`MAX_FILES`] / [`MAX_BYTES`].
pub fn snapshot(root: &Path, dest: &Path) -> Result<(), String> {
    let mut files = 0usize;
    let mut bytes = 0u64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let target = dest.join(dir.strip_prefix(root).unwrap_or(Path::new("")));
        std::fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        let entries = std::fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            let kind = entry.file_type().map_err(|e| format!("{}: {e}", path.display()))?;
            if kind.is_symlink() {
                let shown = path.strip_prefix(root).unwrap_or(&path).display().to_string();
                return Err(format!(
                    "{shown} is a symbolic link: a preview snapshot copies real files only. Replace the link with a copy or move it out of the project."
                ));
            }
            if kind.is_dir() {
                if !skipped(&path) {
                    stack.push(path);
                }
                continue;
            }
            files += 1;
            bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            if files > MAX_FILES {
                return Err(format!("The project has more than {MAX_FILES} files to copy for a preview"));
            }
            if bytes > MAX_BYTES {
                return Err(format!("The project has more than {} MiB to copy for a preview", MAX_BYTES / 1024 / 1024));
            }
            std::fs::copy(&path, target.join(entry.file_name())).map_err(|e| format!("{}: {e}", path.display()))?;
        }
    }
    Ok(())
}

/// How a package's locked versions change.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonLockChange {
    pub name: String,
    pub before: Vec<String>,
    pub after: Vec<String>,
}

/// The packages whose locked versions differ between two `uv.lock`s.
pub fn lock_changes(before: &str, after: &str) -> Vec<PythonLockChange> {
    let (old, new) = (locked_versions(before), locked_versions(after));
    let names: BTreeSet<&String> = old.keys().chain(new.keys()).collect();
    names
        .into_iter()
        .filter_map(|name| {
            let (b, a) = (old.get(name).cloned().unwrap_or_default(), new.get(name).cloned().unwrap_or_default());
            (b != a).then(|| PythonLockChange { name: name.clone(), before: b, after: a })
        })
        .collect()
}

/// How the environment changes: installed `before` and `after` the sync (none: absent).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvironmentChange {
    pub name: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

/// The ` - name==version` / ` + name==version` lines of `uv sync --dry-run`, paired by package.
pub fn environment_changes(output: &str) -> Vec<PythonEnvironmentChange> {
    let mut changes: Vec<PythonEnvironmentChange> = Vec::new();
    for line in output.lines() {
        let (removed, rest) = match line.trim_start().split_once(' ') {
            Some(("-", rest)) => (true, rest),
            Some(("+", rest)) => (false, rest),
            _ => continue,
        };
        let Some((name, version)) = rest.trim().split_once("==") else { continue };
        let name = normalize(name);
        let at = changes.iter().position(|c| c.name == name).unwrap_or_else(|| {
            changes.push(PythonEnvironmentChange { name, before: None, after: None });
            changes.len() - 1
        });
        let version = Some(version.trim().to_owned());
        if removed {
            changes[at].before = version;
        } else {
            changes[at].after = version;
        }
    }
    changes.sort_by(|a, b| a.name.cmp(&b.name));
    changes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairs_dry_run_lines() {
        let output = "Would use project environment at: .venv\nResolved 30 packages in 13ms\nWould uninstall 2 packages\n - fastapi==0.165.0\n + fastapi==0.163.1\n + requests==2.34.2\n - debugpy==1.8.22\n";
        assert_eq!(
            environment_changes(output),
            [
                PythonEnvironmentChange { name: "debugpy".into(), before: Some("1.8.22".into()), after: None },
                PythonEnvironmentChange {
                    name: "fastapi".into(),
                    before: Some("0.165.0".into()),
                    after: Some("0.163.1".into())
                },
                PythonEnvironmentChange { name: "requests".into(), before: None, after: Some("2.34.2".into()) },
            ]
        );
    }

    #[test]
    fn diffs_locks() {
        let before = "[[package]]\nname = \"a\"\nversion = \"1\"\n\n[[package]]\nname = \"b\"\nversion = \"2\"\n";
        let after = "[[package]]\nname = \"a\"\nversion = \"1\"\n\n[[package]]\nname = \"b\"\nversion = \"3\"\n\n[[package]]\nname = \"c\"\nversion = \"1\"\n";
        let changes = lock_changes(before, after);
        assert_eq!(changes.len(), 2);
        assert_eq!((changes[0].name.as_str(), changes[0].after.as_slice()), ("b", ["3".to_owned()].as_slice()));
        assert!(changes[1].before.is_empty());
    }

    #[test]
    fn snapshots_without_caches_and_refuses_links() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("p");
        for d in ["src/pkg", ".git", ".venv/lib", "src/pkg/__pycache__", "env"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        std::fs::write(root.join("pyproject.toml"), "[project]\n").unwrap();
        std::fs::write(root.join("src/pkg/__init__.py"), "").unwrap();
        std::fs::write(root.join(".git/HEAD"), "").unwrap();
        std::fs::write(root.join("env/pyvenv.cfg"), "").unwrap();
        let dest = dir.path().join("snap");
        snapshot(&root, &dest).unwrap();
        assert!(dest.join("pyproject.toml").is_file() && dest.join("src/pkg/__init__.py").is_file());
        assert!(!dest.join(".git").exists() && !dest.join(".venv").exists() && !dest.join("env").exists());
        assert!(!dest.join("src/pkg/__pycache__").exists());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("pyproject.toml"), root.join("link.toml")).unwrap();
            let err = snapshot(&root, &dir.path().join("snap2")).unwrap_err();
            assert!(err.starts_with("link.toml is a symbolic link"), "{err}");
        }
    }
}
