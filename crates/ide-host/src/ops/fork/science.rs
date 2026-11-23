//! PyIdea's Science captures: where a profile or plot capture of a Python run is written.

use crate::Host;
use ide_command::command;
use ide_core::{IdeError, IdeResult, IpcPath};
use ide_pyidea::tests::helpers;
use serde::Serialize;
use specta::Type;
use std::path::Path;

/// Captures kept per kind; older ones are removed when a new one starts.
const KEEP: usize = 20;

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScienceCapture {
    /// The helpers' directory (`openidea_science_profile.py`, the `openidea_mpl_backend` module).
    pub helpers: IpcPath,
    /// An empty directory for this capture's output.
    pub output: IpcPath,
}

fn prune(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut captures: Vec<_> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    captures.sort();
    let excess = captures.len().saturating_sub(KEEP - 1);
    for old in captures.into_iter().take(excess) {
        let _ = std::fs::remove_dir_all(old);
    }
}

/// Installs the helpers and makes an output directory for a `kind` capture (`profile`, `plots`,
/// `timeline`).
#[command(trust = trusted)]
pub async fn pyidea_science_prepare(host: &Host, kind: String) -> IdeResult<ScienceCapture> {
    if !matches!(kind.as_str(), "profile" | "plots" | "timeline") {
        return Err(IdeError::invalid(format!("unknown capture `{kind}`")));
    }
    let data_dir = host.local_data_dir.clone();
    tokio::task::spawn_blocking(move || {
        let helpers = helpers::install(&data_dir)?;
        let base = data_dir.join("pyidea").join("science").join(&kind);
        std::fs::create_dir_all(&base).map_err(|e| IdeError::internal(e.to_string()))?;
        prune(&base);
        let millis =
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        // Sortable by start time.
        let output = base.join(format!("{millis:015}-{}", &uuid::Uuid::new_v4().to_string()[..8]));
        std::fs::create_dir_all(&output).map_err(|e| IdeError::internal(e.to_string()))?;
        Ok(ScienceCapture { helpers: helpers.into(), output: output.into() })
    })
    .await
    .map_err(|e| IdeError::internal(e.to_string()))?
}

ide_command::domain!(fork_science: pyidea_science_prepare);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_latest_captures() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..25 {
            std::fs::create_dir(dir.path().join(format!("{i:03}"))).unwrap();
        }
        prune(dir.path());
        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left.len(), KEEP - 1);
        assert_eq!(left.first().map(String::as_str), Some("006"));
    }
}
