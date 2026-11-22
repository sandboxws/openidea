//! Local Django, Flask and FastAPI applications, found by the `openidea_web_discover.py`
//! helper without importing project code.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PythonWebFramework {
    Django,
    Flask,
    Fastapi,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonWebApp {
    pub framework: PythonWebFramework,
    /// A `manage.py` path (Django), else `module:app` / `module:factory`.
    pub target: String,
    /// `target` names an application factory.
    #[serde(default)]
    pub factory: bool,
    pub file: String,
    /// 1-based.
    #[serde(default)]
    pub line: u32,
    /// Where to start the server.
    pub directory: String,
    /// The directory the application's module imports from.
    pub python_path: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonWebDiscovery {
    #[serde(default)]
    pub apps: Vec<PythonWebApp>,
    /// Files that didn't parse.
    #[serde(default)]
    pub errors: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_helper_output() {
        let json = r#"{"apps":[{"framework":"fastapi","target":"api.main:create_app","factory":true,"file":"/p/a.py","line":3,"directory":"/p","pythonPath":"/p/src"}],"errors":[]}"#;
        let found: PythonWebDiscovery = serde_json::from_str(json).unwrap();
        assert_eq!(found.apps[0].framework, PythonWebFramework::Fastapi);
        assert!(found.apps[0].factory);
        assert_eq!(found.apps[0].python_path, "/p/src");
    }
}
