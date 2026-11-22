//! PyIdea's Project Dependencies workspace: the declared groups with staged edits, the lock,
//! the environment, and uv previews and synchronization.

use crate::Host;
use ide_command::command;
use ide_core::{CancellationToken, IdeError, IdeResult, IpcPath, RequestId};
use ide_pyidea::deps::edit::{PythonStagedEdit, apply, upgrades};
use ide_pyidea::deps::graph::{lock_graph, why_paths};
use ide_pyidea::deps::manifest::{PythonDeclaredGroup, declared_with_staged, project_name};
use ide_pyidea::deps::preview::{
    PythonEnvironmentChange, PythonLockChange, environment_changes, lock_changes, snapshot,
};
use ide_pyidea::deps::uv::{PythonSyncSelection, lock_args, sync_args};
use ide_pyidea::toml::lock::{normalize, uv_lock};
use parking_lot::Mutex;
use serde::Serialize;
use specta::Type;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonPackageState {
    /// Normalized.
    pub name: String,
    pub locked: Vec<String>,
    pub installed: Option<String>,
    /// Declared by the project (else a transitive package).
    pub direct: bool,
    /// The shortest chain of dependencies from the project to it.
    pub why: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonDependencyModel {
    pub path: IpcPath,
    pub project_name: Option<String>,
    /// With the staged edits applied (staged requirements marked).
    pub groups: Vec<PythonDeclaredGroup>,
    /// Why the staged edits no longer apply to the file.
    pub edit_error: Option<String>,
    /// Every package the lock pins, the project's members excluded.
    pub packages: Vec<PythonPackageState>,
    pub lock: Option<IpcPath>,
    pub interpreter: Option<IpcPath>,
    /// The interpreter's virtual environment, which a sync installs into.
    pub environment: Option<IpcPath>,
    pub uv: Option<IpcPath>,
}

/// The uv next to the interpreter, on `PATH`, or where its installers put it.
fn find_uv(python: Option<&Path>) -> Option<PathBuf> {
    let exe = if cfg!(windows) { "uv.exe" } else { "uv" };
    let mut dirs: Vec<PathBuf> = python.and_then(Path::parent).map(Path::to_path_buf).into_iter().collect();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from) {
        dirs.extend([home.join(".local").join("bin"), home.join(".cargo").join("bin")]);
    }
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    dirs.into_iter().map(|d| d.join(exe)).find(|p| p.is_file())
}

fn read(path: &Path) -> IdeResult<String> {
    std::fs::read_to_string(path).map_err(|e| IdeError::not_found(format!("{}: {e}", path.display())))
}

struct Context {
    pyproject: PathBuf,
    dir: PathBuf,
    lock: Option<PathBuf>,
    python: Option<PathBuf>,
    environment: Option<PathBuf>,
}

fn context(host: &Host, project: &crate::Project, path: &Path) -> IdeResult<Context> {
    if path.file_name().is_none_or(|n| n != "pyproject.toml") || !path.starts_with(&project.root) {
        return Err(IdeError::invalid("Choose a pyproject.toml of the project"));
    }
    let dir = path.parent().unwrap_or(&project.root).to_path_buf();
    let python = crate::ops::sdk::effective_python(&host.config_dir, project, Some(&dir));
    let environment = python.as_deref().and_then(ide_sdk::venv_of);
    Ok(Context { pyproject: path.to_path_buf(), lock: uv_lock(&dir, &project.root), dir, python, environment })
}

/// The project's dependencies as declared in `path` with `edits` applied, as locked and as
/// installed.
#[command(trust = trusted)]
pub async fn pyidea_deps_model(
    host: &Host,
    window: &str,
    path: IpcPath,
    edits: Vec<PythonStagedEdit>,
    request: RequestId,
) -> IdeResult<PythonDependencyModel> {
    let project = host.project(window)?;
    let ctx = context(host, &project, path.as_ref())?;
    let cancel = host.begin_project_read_request(window, request);
    let result = host
        .blocking(move || {
            let saved = read(&ctx.pyproject)?;
            let (edited, edit_error) = match apply(&saved, &edits) {
                Ok(text) => (text, None),
                Err(e) => (saved.clone(), Some(e)),
            };
            let groups = declared_with_staged(&saved, &edited).map_err(IdeError::invalid)?;
            let graph = ctx
                .lock
                .as_deref()
                .and_then(|p| std::fs::read_to_string(p).ok())
                .map(|t| lock_graph(&t))
                .unwrap_or_default();
            let why = why_paths(&graph);
            let installed: HashMap<String, String> = ctx
                .python
                .as_deref()
                .and_then(|p| super::toml::installed_packages(p, &cancel).ok())
                .unwrap_or_default()
                .into_iter()
                .map(|p| (normalize(&p.name), p.version))
                .collect();
            if cancel.is_cancelled() {
                return Err(IdeError::cancelled());
            }
            let direct: HashSet<&str> =
                groups.iter().flat_map(|g| &g.requirements).map(|r| r.package.as_str()).collect();
            let mut packages: Vec<PythonPackageState> = graph
                .iter()
                .filter(|p| !p.member)
                .map(|p| PythonPackageState {
                    name: p.name.clone(),
                    locked: p.versions.clone(),
                    installed: installed.get(&p.name).cloned(),
                    direct: direct.contains(p.name.as_str()),
                    why: why.get(&p.name).cloned().unwrap_or_default(),
                })
                .collect();
            // Declared but not locked yet (a staged addition, or no lock at all).
            for name in direct.iter().filter(|n| !n.is_empty() && !graph.iter().any(|p| p.name == **n)) {
                packages.push(PythonPackageState {
                    name: (*name).to_owned(),
                    locked: Vec::new(),
                    installed: installed.get(*name).cloned(),
                    direct: true,
                    why: Vec::new(),
                });
            }
            packages.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(PythonDependencyModel {
                path: ctx.pyproject.clone().into(),
                project_name: project_name(&saved),
                groups,
                edit_error,
                packages,
                lock: ctx.lock.clone().map(Into::into),
                interpreter: ctx.python.clone().map(Into::into),
                environment: ctx.environment.clone().map(Into::into),
                uv: find_uv(ctx.python.as_deref()).map(Into::into),
            })
        })
        .await;
    host.end_request(request);
    result
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonDependencyPreview {
    pub id: String,
    pub manifest_before: String,
    pub manifest_after: String,
    /// Where the lock is (or will be written).
    pub lock_path: IpcPath,
    /// Empty when the project has no lock yet.
    pub lock_before: String,
    pub lock_after: String,
    pub lock_changes: Vec<PythonLockChange>,
    /// What a sync would change in the environment (empty without one).
    pub environment_changes: Vec<PythonEnvironmentChange>,
    /// What uv printed.
    pub output: String,
}

/// A command for the Run tool window.
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonSyncCommand {
    pub command: IpcPath,
    pub args: Vec<String>,
    pub cwd: IpcPath,
    pub env: BTreeMap<String, String>,
}

struct StoredPreview {
    pyproject: PathBuf,
    manifest_before: String,
    manifest_after: String,
    lock_path: PathBuf,
    lock_before: Option<String>,
    lock_after: String,
    sync: PythonSyncCommand,
}

static PREVIEWS: LazyLock<Mutex<HashMap<String, StoredPreview>>> = LazyLock::new(Default::default);

fn sync_command(uv: &Path, ctx: &Context, selection: &PythonSyncSelection) -> IdeResult<PythonSyncCommand> {
    let environment = ctx.environment.as_ref().ok_or_else(|| {
        IdeError::invalid("Select a local virtual environment as the project interpreter to synchronize it")
    })?;
    Ok(PythonSyncCommand {
        command: uv.to_path_buf().into(),
        args: sync_args(selection, false),
        cwd: ctx.dir.clone().into(),
        env: BTreeMap::from([("UV_PROJECT_ENVIRONMENT".to_owned(), environment.to_string_lossy().into_owned())]),
    })
}

fn uv_env() -> BTreeMap<String, String> {
    BTreeMap::from([("NO_COLOR".to_owned(), "1".to_owned()), ("UV_NO_PROGRESS".to_owned(), "1".to_owned())])
}

fn output(run: &super::HelperRun) -> String {
    format!("{}{}", run.stdout, run.stderr)
}

fn preview(
    data_dir: &Path,
    ctx: &Context,
    edits: &[PythonStagedEdit],
    selection: &PythonSyncSelection,
    cancel: &CancellationToken,
) -> IdeResult<PythonDependencyPreview> {
    let uv = find_uv(ctx.python.as_deref())
        .ok_or_else(|| IdeError::unavailable("Previewing changes needs uv: install it (https://docs.astral.sh/uv/)"))?;
    let sync = sync_command(&uv, ctx, selection)?;
    let manifest_before = read(&ctx.pyproject)?;
    let manifest_after = apply(&manifest_before, edits).map_err(IdeError::invalid)?;
    // Resolve where the lock lives: a uv workspace locks at its root.
    let workspace = ctx.lock.as_deref().and_then(Path::parent).unwrap_or(&ctx.dir).to_path_buf();
    let lock_path = workspace.join("uv.lock");
    let lock_before = std::fs::read_to_string(&lock_path).ok();
    let scratch = data_dir.join("pyidea").join("deps-preview").join(uuid::Uuid::new_v4().to_string());
    let result = (|| {
        snapshot(&workspace, &scratch).map_err(IdeError::invalid)?;
        let member = scratch.join(ctx.dir.strip_prefix(&workspace).unwrap_or(Path::new("")));
        std::fs::write(member.join("pyproject.toml"), &manifest_after)
            .map_err(|e| IdeError::internal(e.to_string()))?;
        let mut args = lock_args(&upgrades(edits));
        if let Some(python) = &ctx.python {
            args.extend(["--python".to_owned(), python.to_string_lossy().into_owned()]);
        }
        let args: Vec<std::ffi::OsString> = args.into_iter().map(Into::into).collect();
        let locked = super::run_program(&uv, &args, &member, &uv_env(), cancel, Duration::from_secs(300), "Locking")?;
        let mut printed = output(&locked);
        if !locked.status.success() {
            return Err(IdeError::invalid(format!("uv lock failed:\n{}", printed.trim())));
        }
        let lock_after =
            std::fs::read_to_string(scratch.join("uv.lock")).map_err(|e| IdeError::internal(e.to_string()))?;
        let mut env = uv_env();
        env.extend(sync.env.clone());
        let args: Vec<std::ffi::OsString> = sync_args(selection, true).into_iter().map(Into::into).collect();
        let dry =
            super::run_program(&uv, &args, &member, &env, cancel, Duration::from_secs(300), "Previewing the sync")?;
        let dry_output = output(&dry);
        if !dry.status.success() {
            return Err(IdeError::invalid(format!("uv sync --dry-run failed:\n{}", dry_output.trim())));
        }
        printed.push_str(&dry_output);
        let id = uuid::Uuid::new_v4().to_string();
        let preview = PythonDependencyPreview {
            id: id.clone(),
            manifest_before: manifest_before.clone(),
            manifest_after: manifest_after.clone(),
            lock_path: lock_path.clone().into(),
            lock_before: lock_before.clone().unwrap_or_default(),
            lock_changes: lock_changes(lock_before.as_deref().unwrap_or(""), &lock_after),
            environment_changes: environment_changes(&dry_output),
            lock_after: lock_after.clone(),
            output: printed,
        };
        let mut previews = PREVIEWS.lock();
        previews.retain(|_, p| p.pyproject != ctx.pyproject);
        previews.insert(
            id,
            StoredPreview {
                pyproject: ctx.pyproject.clone(),
                manifest_before,
                manifest_after,
                lock_path,
                lock_before,
                lock_after,
                sync,
            },
        );
        Ok(preview)
    })();
    let _ = std::fs::remove_dir_all(&scratch);
    result
}

/// Resolves the staged edits in a copy of the project (`uv lock`, then `uv sync --dry-run`
/// against the project's environment); nothing in the project or the environment changes.
#[command(trust = trusted)]
pub async fn pyidea_deps_preview(
    host: &Host,
    window: &str,
    path: IpcPath,
    edits: Vec<PythonStagedEdit>,
    selection: PythonSyncSelection,
    request: RequestId,
) -> IdeResult<PythonDependencyPreview> {
    let project = host.project(window)?;
    project.require_trust()?;
    let ctx = context(host, &project, path.as_ref())?;
    let data_dir = host.local_data_dir.clone();
    let cancel = host.begin_project_read_request(window, request);
    let result = host.blocking(move || preview(&data_dir, &ctx, &edits, &selection, &cancel)).await;
    host.end_request(request);
    result
}

/// Writes a preview's manifest and lock into the project, unless either file changed since,
/// and returns the sync to run.
#[command(trust = trusted)]
pub async fn pyidea_deps_apply(host: &Host, window: &str, id: String) -> IdeResult<PythonSyncCommand> {
    let project = host.project(window)?;
    project.require_trust()?;
    host.blocking(move || {
        let stored = PREVIEWS
            .lock()
            .remove(&id)
            .ok_or_else(|| IdeError::invalid("The preview is no longer available: preview again"))?;
        let manifest = read(&stored.pyproject)?;
        let lock = std::fs::read_to_string(&stored.lock_path).ok();
        if manifest != stored.manifest_before || lock != stored.lock_before {
            return Err(IdeError::invalid("The project's files changed since the preview: preview again"));
        }
        if stored.manifest_after != manifest {
            std::fs::write(&stored.pyproject, &stored.manifest_after).map_err(|e| IdeError::internal(e.to_string()))?;
        }
        std::fs::write(&stored.lock_path, &stored.lock_after).map_err(|e| IdeError::internal(e.to_string()))?;
        Ok(stored.sync)
    })
    .await
}

/// The sync of the project's environment against its lock (Retry Sync).
#[command(trust = trusted)]
pub async fn pyidea_deps_sync(
    host: &Host,
    window: &str,
    path: IpcPath,
    selection: PythonSyncSelection,
) -> IdeResult<PythonSyncCommand> {
    let project = host.project(window)?;
    project.require_trust()?;
    let ctx = context(host, &project, path.as_ref())?;
    let uv = find_uv(ctx.python.as_deref())
        .ok_or_else(|| IdeError::unavailable("Synchronizing needs uv: install it (https://docs.astral.sh/uv/)"))?;
    sync_command(&uv, &ctx, &selection)
}

ide_command::domain!(fork_deps: pyidea_deps_model, pyidea_deps_preview, pyidea_deps_apply, pyidea_deps_sync);
