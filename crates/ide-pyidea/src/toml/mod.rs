//! PyIdea's TOML Workbench: bundled schemas, locked versions and PyPI version order.

pub mod lock;
pub mod pep440;
pub mod pypi;
pub mod schemas;

use serde::{Deserialize, Serialize};

/// What a `pyproject.toml` requirement resolves to: `from..to` is its string's UTF-16 span.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonVersionHint {
    pub package: String,
    pub from: u32,
    pub to: u32,
    /// Pinned by `uv.lock` (several when markers fork the resolution).
    pub locked: Vec<String>,
    /// Installed in the project interpreter.
    pub installed: Option<String>,
}
