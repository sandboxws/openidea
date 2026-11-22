//! uv command lines for locking and synchronizing the project.

use serde::{Deserialize, Serialize};

/// What a sync installs (PyIdea's "Select Groups and Extras").
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonSyncSelection {
    /// Optional extras to install.
    pub extras: Vec<String>,
    pub all_extras: bool,
    /// Dependency groups: none for uv's defaults (`dev`), an empty list for none at all.
    pub groups: Option<Vec<String>>,
    /// Keep installed packages the lock doesn't list (`--inexact`).
    pub inexact: bool,
}

/// `uv lock`, upgrading `upgrades` within their declared constraints.
pub fn lock_args(upgrades: &[String]) -> Vec<String> {
    let mut args = vec!["lock".to_owned()];
    for package in upgrades {
        args.extend(["--upgrade-package".to_owned(), package.clone()]);
    }
    args
}

/// `uv sync --locked …` for `selection`.
pub fn sync_args(selection: &PythonSyncSelection, dry_run: bool) -> Vec<String> {
    let mut args = vec!["sync".to_owned(), "--locked".to_owned()];
    if dry_run {
        args.push("--dry-run".into());
    }
    if selection.all_extras {
        args.push("--all-extras".into());
    } else {
        for extra in &selection.extras {
            args.extend(["--extra".to_owned(), extra.clone()]);
        }
    }
    if let Some(groups) = &selection.groups {
        args.push("--no-default-groups".into());
        for group in groups {
            args.extend(["--group".to_owned(), group.clone()]);
        }
    }
    if selection.inexact {
        args.push("--inexact".into());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_sync_and_lock_commands() {
        assert_eq!(sync_args(&PythonSyncSelection::default(), true), ["sync", "--locked", "--dry-run"]);
        let selection = PythonSyncSelection {
            extras: vec!["socks".into()],
            all_extras: false,
            groups: Some(vec!["test".into()]),
            inexact: true,
        };
        assert_eq!(
            sync_args(&selection, false),
            ["sync", "--locked", "--extra", "socks", "--no-default-groups", "--group", "test", "--inexact"]
        );
        let none = PythonSyncSelection { groups: Some(Vec::new()), all_extras: true, ..Default::default() };
        assert_eq!(sync_args(&none, false), ["sync", "--locked", "--all-extras", "--no-default-groups"]);
        assert_eq!(lock_args(&["flask".into()]), ["lock", "--upgrade-package", "flask"]);
    }
}
