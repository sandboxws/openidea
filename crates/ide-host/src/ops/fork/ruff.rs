//! Ruff for the fork's Python save actions and suppression-comment completion.
//!
//! Ruff is looked up like the Ruff formatter (`languages.ruff.path`, then managed tools and
//! `PATH`), except that the selected Python environment's own `ruff` comes before the global
//! ones, as in PyIdea. Nothing here installs Ruff.

use crate::{Host, Project};
use ide_command::command;
use ide_core::{IdeError, IdeResult, IpcPath, RequestId};
use ide_pyidea::ruff::{self, RuffRule};
use ide_tools::{Tools, formatter};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuffInfo {
    pub version: String,
}

/// The `ruff` command for files near `near`, and the configuration file the settings name.
fn ruff_command(data_dir: &Path, project: &Project, near: &Path) -> IdeResult<(Command, Option<PathBuf>)> {
    let settings = project.settings.effective();
    let custom = ide_sdk::apply::setting_path(&project.root, &settings.languages.ruff.path);
    let environment = || {
        let python = ide_sdk::apply::python_interpreter_near(&project.root, Some(near), &settings)?;
        let exe = if cfg!(windows) { "ruff.exe" } else { "ruff" };
        Some(python.parent()?.join(exe)).filter(|p| p.is_file())
    };
    let program = custom.or_else(environment);
    let command = Tools::new(data_dir).formatter_command("ruff", near, program.as_deref())?;
    let config = ide_sdk::apply::ruff_configuration(&project.root, &settings.languages.ruff.configuration_directory)?;
    Ok((command, config))
}

fn version(data_dir: &Path, project: &Project) -> Option<String> {
    let (mut command, _) = ruff_command(data_dir, project, &project.root.join("pyproject.toml")).ok()?;
    command.arg("--version").current_dir(&project.root);
    ruff::parse_version(&formatter::run("ruff", command, "", &Default::default()).ok()?)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> IdeResult<T> + Send + 'static) -> IdeResult<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| IdeError::internal(e.to_string()))?
}

/// The Ruff the project would use, or `None` when there is none.
#[command(trust = trusted)]
pub async fn pyidea_ruff_info(host: &Host, window: &str) -> IdeResult<Option<RuffInfo>> {
    let project = host.project(window)?;
    let data_dir = host.local_data_dir.clone();
    blocking(move || Ok(version(&data_dir, &project).map(|version| RuffInfo { version }))).await
}

/// Ruff's lint rules (empty without Ruff), cached per Ruff version.
#[command(trust = trusted)]
pub async fn pyidea_ruff_rules(host: &Host, window: &str) -> IdeResult<Vec<RuffRule>> {
    let project = host.project(window)?;
    let data_dir = host.local_data_dir.clone();
    blocking(move || {
        let Some(version) = version(&data_dir, &project) else { return Ok(Vec::new()) };
        ruff::rules_cached(&data_dir.join("pyidea"), &version, || {
            let (mut command, _) = ruff_command(&data_dir, &project, &project.root.join("pyproject.toml"))?;
            command.args(ruff::rules_args()).current_dir(&project.root);
            formatter::run("ruff", command, "", &Default::default())
        })
    })
    .await
}

/// `text` (the contents of `path`) with Ruff's safe lint fixes applied (`fix`) and then
/// formatted by Ruff (`format`), or `None` when nothing changes. The project's Ruff
/// configuration and exclusions apply. Cancel with `cancel_request(request)`.
#[command(trust = trusted)]
pub async fn pyidea_ruff_apply(
    host: &Host,
    window: &str,
    path: IpcPath,
    text: String,
    fix: bool,
    format: bool,
    request: RequestId,
) -> IdeResult<Option<String>> {
    let project: Arc<Project> = host.project(window)?;
    project.require_trust()?;
    if text.len() as u64 > ide_vfs::LARGE_FILE_THRESHOLD || (!fix && !format) {
        return Ok(None);
    }
    let data_dir = host.local_data_dir.clone();
    let cancel = host.begin_request(request);
    let result = blocking(move || {
        let path = path.0;
        let run = |input: &str, args: Vec<std::ffi::OsString>| -> IdeResult<String> {
            let (mut command, _) = ruff_command(&data_dir, &project, &path)?;
            command.args(args);
            if let Some(dir) = path.parent() {
                command.current_dir(dir);
            }
            formatter::run("ruff", command, input, &cancel)
        };
        let config = ruff_command(&data_dir, &project, &path)?.1;
        let mut out = text.clone();
        if fix {
            out = run(&out, ruff::fix_args(&path, config.as_deref()))?;
        }
        if format {
            out = run(&out, ruff::format_args(&path, config.as_deref()))?;
        }
        Ok((out != text).then_some(out))
    })
    .await;
    host.end_request(request);
    result
}

ide_command::domain!(fork_ruff: pyidea_ruff_info, pyidea_ruff_rules, pyidea_ruff_apply);
