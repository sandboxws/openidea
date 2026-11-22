//! The Python helpers, embedded in the binary and written once per content version to
//! `<data dir>/pyidea/helpers/<hash>/`, where collection imports them and test runs load them
//! (`-p openidea_pytest_reporter`, `-m openidea_unittest_runner`, `-m openidea_doctest_runner`).

use ide_core::{IdeError, IdeResult};
use std::path::{Path, PathBuf};

pub const COLLECT: &str = "openidea_tests_collect.py";
pub const WEB_DISCOVER: &str = "openidea_web_discover.py";

pub const HELPERS: &[(&str, &str)] = &[
    (COLLECT, include_str!("../../helpers/openidea_tests_collect.py")),
    ("openidea_pytest_reporter.py", include_str!("../../helpers/openidea_pytest_reporter.py")),
    ("openidea_unittest_runner.py", include_str!("../../helpers/openidea_unittest_runner.py")),
    ("openidea_doctest_runner.py", include_str!("../../helpers/openidea_doctest_runner.py")),
    (WEB_DISCOVER, include_str!("../../helpers/openidea_web_discover.py")),
];

/// FNV-1a over every helper's name and contents: a new build's helpers get a new directory.
pub fn version() -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for (name, text) in HELPERS {
        for byte in name.bytes().chain(text.bytes()) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("{:016x}", hash)[..12].to_owned()
}

/// Writes the helpers under `data_dir` (once per version) and returns their directory.
pub fn install(data_dir: &Path) -> IdeResult<PathBuf> {
    let dir = data_dir.join("pyidea").join("helpers").join(version());
    let io = |e: std::io::Error| IdeError::internal(format!("cannot write the Python Tests helpers: {e}"));
    std::fs::create_dir_all(&dir).map_err(io)?;
    for (name, text) in HELPERS {
        let path = dir.join(name);
        if std::fs::read_to_string(&path).is_ok_and(|current| current == *text) {
            continue;
        }
        let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
        std::fs::write(&tmp, text).map_err(io)?;
        std::fs::rename(&tmp, &path).map_err(io)?;
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers_are_written_once_per_version() {
        let dir = tempfile::tempdir().unwrap();
        let installed = install(dir.path()).unwrap();
        assert!(installed.ends_with(version()));
        for (name, text) in HELPERS {
            assert_eq!(std::fs::read_to_string(installed.join(name)).unwrap(), *text);
        }
        // Idempotent.
        assert_eq!(install(dir.path()).unwrap(), installed);
        assert_eq!(version().len(), 12);
    }
}

/// `PYTHON=/path/to/python cargo test -p ide-pyidea -- --ignored`: the helpers' own tests
/// (`helpers/tests`) against real projects; their pytest cases need pytest in that Python.
#[cfg(test)]
mod python_tests {
    #[test]
    #[ignore = "needs Python (PYTHON or python3)"]
    fn helpers_pass_their_python_tests() {
        let python = std::env::var("PYTHON").unwrap_or_else(|_| "python3".into());
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("helpers/tests");
        let out = std::process::Command::new(python)
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .args(["-B", "-m", "unittest", "discover", "-s"])
            .arg(&dir)
            .output()
            .expect("python runs");
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(out.status.success(), "{stderr}");
    }
}
