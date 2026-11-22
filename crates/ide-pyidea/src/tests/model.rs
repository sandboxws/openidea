//! What collection reports, and the project's import graph it keeps.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The framework a collection or run uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PythonTestFramework {
    Pytest,
    Unittest,
    Doctest,
}

impl PythonTestFramework {
    pub fn name(self) -> &'static str {
        match self {
            Self::Pytest => "pytest",
            Self::Unittest => "unittest",
            Self::Doctest => "doctest",
        }
    }
}

/// One collected test case (a pytest parameter case is one).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonCollectedTest {
    /// The id the runner reports results under: a pytest node id, a unittest id
    /// (`pkg.mod.Class.test`) or `FILE::SYMBOL` for a docstring.
    pub id: String,
    pub file: String,
    pub name: String,
    /// 0-based line of the test's definition (pytest) or 0-based docstring line (doctest).
    #[serde(default)]
    pub line: u32,
    /// Dotted symbol within the file: `TestCart.test_total`.
    #[serde(default)]
    pub symbol: String,
    /// A pytest parameter case's values.
    #[serde(default)]
    pub params: Option<BTreeMap<String, String>>,
}

/// Each local `.py` file's imports of other local files, and the stamps they were read at.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ImportGraph {
    #[serde(default)]
    pub graph: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub stamps: BTreeMap<String, [u64; 2]>,
}

/// The collection helper's output file.
#[derive(Debug, Deserialize)]
pub struct HelperOutput {
    #[serde(default)]
    pub tests: Vec<PythonCollectedTest>,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub graph: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub stamps: BTreeMap<String, [u64; 2]>,
}

impl HelperOutput {
    pub fn import_graph(&self) -> ImportGraph {
        ImportGraph { graph: self.graph.clone(), stamps: self.stamps.clone() }
    }
}
