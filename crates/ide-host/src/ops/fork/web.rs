//! Local web applications for the fork's Flask, FastAPI and Django Server configurations.

use crate::Host;
use ide_command::command;
use ide_core::{IdeError, IdeResult};
use ide_pyidea::tests::helpers;
use ide_pyidea::web::PythonWebDiscovery;
use std::collections::BTreeMap;
use std::time::Duration;

/// The project's Django, Flask and FastAPI applications, read from its files with the
/// project's interpreter; nothing is imported or installed.
#[command(trust = trusted)]
pub async fn pyidea_web_discover(host: &Host, window: &str) -> IdeResult<PythonWebDiscovery> {
    let project = host.project(window)?;
    project.require_trust()?;
    let data_dir = host.local_data_dir.clone();
    tokio::task::spawn_blocking(move || {
        let settings = project.settings.effective();
        let python = ide_sdk::apply::python_interpreter_near(&project.root, None, &settings).ok_or_else(|| {
            IdeError::invalid("No local Python interpreter: choose one in Settings › Languages & Frameworks › Python")
        })?;
        let helpers = helpers::install(&data_dir)?;
        let dir = data_dir.join("pyidea").join("web");
        std::fs::create_dir_all(&dir).map_err(|e| IdeError::internal(e.to_string()))?;
        let output = dir.join(format!("{}.json", uuid::Uuid::new_v4()));
        let args =
            [helpers.join(helpers::WEB_DISCOVER).into_os_string(), project.root.clone().into(), output.clone().into()];
        let env = BTreeMap::from([("PYTHONDONTWRITEBYTECODE".to_owned(), "1".to_owned())]);
        let run = super::run_program(
            &python,
            &args,
            &project.root,
            &env,
            &Default::default(),
            Duration::from_secs(60),
            "Discovering web applications",
        )?;
        let json = std::fs::read_to_string(&output);
        let _ = std::fs::remove_file(&output);
        let json = json.map_err(|_| {
            IdeError::invalid(format!("Web application discovery failed ({}):\n{}", run.status, run.stderr_tail()))
        })?;
        serde_json::from_str(&json).map_err(|e| IdeError::internal(format!("unreadable discovery: {e}")))
    })
    .await
    .map_err(|e| IdeError::internal(e.to_string()))?
}

ide_command::domain!(fork_web: pyidea_web_discover);
