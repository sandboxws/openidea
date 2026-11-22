//! PyIdea's Mojo support: the project's Mojo SDK, its language server and debug adapter, and
//! building and formatting with it.

use crate::Host;
use ide_command::command;
use ide_core::{IdeError, IdeResult, IpcPath, RequestId};
use ide_pyidea::mojo::{
    MojoToolchain, adapter_script, build_args, discover, language_server_args, managed_argument, shell_line,
};
use serde::Serialize;
use serde_json::json;
use specta::Type;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// `plugins.mojo`: `sdkDirectory` (blank: look for it) and `importPaths` (one per line).
struct MojoSettings {
    sdk_directory: String,
    import_paths: Vec<String>,
}

fn settings(project: &crate::Project) -> MojoSettings {
    let effective = project.settings.effective();
    let own = effective.plugins.get("mojo");
    let text = |key: &str| own.and_then(|m| m.get(key)).and_then(|v| v.as_str()).unwrap_or_default().to_owned();
    MojoSettings {
        sdk_directory: text("sdkDirectory"),
        import_paths: text("importPaths").lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_owned).collect(),
    }
}

fn toolchain(host: &Host, project: &crate::Project) -> IdeResult<Option<MojoToolchain>> {
    let python = crate::ops::sdk::effective_python(&host.config_dir, project, None);
    discover(&settings(project).sdk_directory, &project.root, python.as_deref()).map_err(IdeError::invalid)
}

fn require(host: &Host, project: &crate::Project) -> IdeResult<MojoToolchain> {
    toolchain(host, project)?.ok_or_else(|| {
        IdeError::unavailable(
            "No Mojo SDK found: install it in the project's .venv (pip install mojo) or choose its environment in Settings › Languages & Frameworks › Mojo",
        )
    })
}

/// The settings' import paths (relative to the project), then the project's source roots.
fn import_paths(project: &crate::Project) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = settings(project).import_paths.iter().map(|p| project.root.join(p)).collect();
    for root in project.roots().roots {
        if root.kind == ide_workspace::roots::RootKind::Source {
            let path = if root.path.is_empty() { project.root.clone() } else { project.root.join(&root.path) };
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    paths
}

/// The environment for running SDK tools from here: the SDK's `bin` before this `PATH`.
fn run_environment(sdk: &MojoToolchain) -> BTreeMap<String, String> {
    sdk.environment(std::env::var("PATH").ok().as_deref())
}

/// The environment kept in settings and command lines: without `PATH`, which stays inherited.
fn stored_environment(sdk: &MojoToolchain) -> BTreeMap<String, String> {
    let mut env = sdk.environment(None);
    env.remove("PATH");
    env
}

#[cfg(target_os = "macos")]
fn debugserver() -> Option<PathBuf> {
    let out = std::process::Command::new("/usr/bin/xcode-select").arg("-p").output().ok()?;
    let developer = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
    [
        developer.join("../SharedFrameworks/LLDB.framework/Resources/debugserver"),
        PathBuf::from(
            "/Library/Developer/CommandLineTools/Library/PrivateFrameworks/LLDB.framework/Resources/debugserver",
        ),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

#[cfg(not(target_os = "macos"))]
fn debugserver() -> Option<PathBuf> {
    None
}

/// Writes `<data>/pyidea/mojo/<sdk hash>/lldb-dap` for `sdk` (when its content changed).
fn write_adapter(data_dir: &Path, sdk: &MojoToolchain) -> IdeResult<Option<PathBuf>> {
    if cfg!(windows) || !sdk.adapter.is_file() {
        return Ok(None);
    }
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in sdk.root.to_string_lossy().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    let dir = data_dir.join("pyidea").join("mojo").join(format!("{hash:016x}"));
    let path = dir.join("lldb-dap");
    let script = adapter_script(sdk, debugserver().as_deref());
    if std::fs::read_to_string(&path).ok().as_deref() != Some(script.as_str()) {
        std::fs::create_dir_all(&dir).map_err(|e| IdeError::internal(e.to_string()))?;
        std::fs::write(&path, &script).map_err(|e| IdeError::internal(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| IdeError::internal(e.to_string()))?;
        }
    }
    Ok(Some(path))
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MojoSetup {
    /// The SDK's environment.
    pub root: IpcPath,
    /// The project's `languageServers.mojo` entry: the SDK's language server for `mojo` files.
    #[specta(type = specta_typescript::Unknown)]
    pub server: serde_json::Value,
    /// A launcher for the SDK's `lldb-dap` (the project's `tools.lldb-dap.path`).
    pub adapter: Option<IpcPath>,
}

/// What the project's Mojo files need configured, or none without a Mojo SDK.
#[command(trust = trusted)]
pub async fn pyidea_mojo_setup(host: &Host, window: &str) -> IdeResult<Option<MojoSetup>> {
    let project = host.project(window)?;
    let data_dir = host.local_data_dir.clone();
    let sdk = toolchain(host, &project)?;
    let Some(sdk) = sdk else { return Ok(None) };
    let paths = import_paths(&project);
    let adapter = write_adapter(&data_dir, &sdk)?;
    Ok(Some(MojoSetup {
        root: sdk.root.clone().into(),
        server: json!({
            "command": sdk.language_server.to_string_lossy(),
            "args": language_server_args(&paths),
            "env": stored_environment(&sdk),
            "languages": ["mojo"],
            "rootMarkers": ["mojoproject.toml", "pixi.toml", "pyproject.toml"],
        }),
        adapter: adapter.map(Into::into),
    }))
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MojoStatus {
    pub root: Option<IpcPath>,
    /// `mojo --version`.
    pub version: Option<String>,
    pub missing: Vec<String>,
    pub error: Option<String>,
}

/// Show Mojo Toolchain Status: the SDK found, its version and missing tools.
#[command(trust = trusted)]
pub async fn pyidea_mojo_status(host: &Host, window: &str) -> IdeResult<MojoStatus> {
    let project = host.project(window)?;
    project.require_trust()?;
    let config_dir = host.config_dir.clone();
    host.blocking(move || {
        let python = crate::ops::sdk::effective_python(&config_dir, &project, None);
        let sdk = match discover(&settings(&project).sdk_directory, &project.root, python.as_deref()) {
            Ok(Some(sdk)) => sdk,
            Ok(None) => return Ok(MojoStatus { root: None, version: None, missing: Vec::new(), error: None }),
            Err(e) => return Ok(MojoStatus { root: None, version: None, missing: Vec::new(), error: Some(e) }),
        };
        let run = super::run_program(
            &sdk.compiler,
            &[OsString::from("--version")],
            &project.root,
            &run_environment(&sdk),
            &Default::default(),
            Duration::from_secs(20),
            "mojo --version",
        );
        let (version, error) = match run {
            Ok(r) if r.status.success() => (Some(r.stdout.trim().to_owned()), None),
            Ok(r) => (None, Some(r.stderr_tail())),
            Err(e) => (None, Some(e.message)),
        };
        Ok(MojoStatus { root: Some(sdk.root.clone().into()), version, missing: sdk.missing(true), error })
    })
    .await
}

fn compile_args(
    project: &crate::Project,
    source: &Path,
    output: &Path,
    compiler_args: &[String],
    debug: bool,
) -> IdeResult<Vec<String>> {
    if let Some(arg) = managed_argument(compiler_args) {
        return Err(IdeError::invalid(format!(
            "`{arg}` is set by the configuration: remove it from the compiler arguments"
        )));
    }
    Ok(build_args(&import_paths(project), compiler_args, source, output, debug))
}

/// The `mojo build` of `source` as a shell command line (a configuration's Before Launch task).
#[command(trust = trusted)]
pub async fn pyidea_mojo_build_line(
    host: &Host,
    window: &str,
    source: IpcPath,
    output: IpcPath,
    compiler_args: Vec<String>,
    debug: bool,
) -> IdeResult<String> {
    let project = host.project(window)?;
    let sdk = require(host, &project)?;
    let args = compile_args(&project, source.as_ref(), output.as_ref(), &compiler_args, debug)?;
    let output_dir = Path::new(output.as_ref()).parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    // The output's directory may not exist yet.
    Ok(format!(
        "mkdir -p {} && {}",
        ide_pyidea::mojo::shell_quote(&output_dir),
        shell_line(&stored_environment(&sdk), &sdk.compiler, &args)
    ))
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MojoBuild {
    pub ok: bool,
    /// The compiler's output (diagnostics).
    pub output: String,
}

/// Builds `source` into `output`; a failed build leaves the previous output in place.
#[command(trust = trusted)]
pub async fn pyidea_mojo_build(
    host: &Host,
    window: &str,
    source: IpcPath,
    output: IpcPath,
    compiler_args: Vec<String>,
    debug: bool,
    request: RequestId,
) -> IdeResult<MojoBuild> {
    let project = host.project(window)?;
    project.require_trust()?;
    let sdk = require(host, &project)?;
    let args = compile_args(&project, source.as_ref(), output.as_ref(), &compiler_args, debug)?;
    let cancel = host.begin_project_read_request(window, request);
    let output_path = PathBuf::from(output.as_ref());
    let result = host
        .blocking(move || {
            if let Some(dir) = output_path.parent() {
                std::fs::create_dir_all(dir).map_err(|e| IdeError::internal(e.to_string()))?;
            }
            let args: Vec<OsString> = args.into_iter().map(Into::into).collect();
            let mut env = run_environment(&sdk);
            if debug {
                // Cached objects could carry another build's debug information.
                env.insert(
                    "MODULAR_CACHE_DIR".into(),
                    output_path
                        .parent()
                        .unwrap_or(&project.root)
                        .join(".mojo-debug-cache")
                        .to_string_lossy()
                        .into_owned(),
                );
            }
            let run = super::run_program(
                &sdk.compiler,
                &args,
                &project.root,
                &env,
                &cancel,
                Duration::from_secs(600),
                "Building",
            )?;
            Ok(MojoBuild { ok: run.status.success(), output: format!("{}{}", run.stdout, run.stderr) })
        })
        .await;
    host.end_request(request);
    result
}

/// `text` (of the Mojo file `path`) formatted by `mojo format`, run on a copy.
#[command(trust = trusted)]
pub async fn pyidea_mojo_format(
    host: &Host,
    window: &str,
    path: IpcPath,
    text: String,
    request: RequestId,
) -> IdeResult<String> {
    let project = host.project(window)?;
    project.require_trust()?;
    let sdk = require(host, &project)?;
    let scratch = host.local_data_dir.join("pyidea").join("mojo-format").join(uuid::Uuid::new_v4().to_string());
    let cancel = host.begin_project_read_request(window, request);
    let name = Path::new(path.as_ref()).file_name().map(|n| n.to_owned()).unwrap_or_else(|| "main.mojo".into());
    let result = host
        .blocking(move || {
            std::fs::create_dir_all(&scratch).map_err(|e| IdeError::internal(e.to_string()))?;
            let file = scratch.join(name);
            std::fs::write(&file, &text).map_err(|e| IdeError::internal(e.to_string()))?;
            let args = [OsString::from("format"), OsString::from("--quiet"), file.clone().into_os_string()];
            let run = super::run_program(
                &sdk.compiler,
                &args,
                &scratch,
                &run_environment(&sdk),
                &cancel,
                Duration::from_secs(60),
                "Formatting",
            );
            let formatted = std::fs::read_to_string(&file);
            let _ = std::fs::remove_dir_all(&scratch);
            let run = run?;
            if !run.status.success() {
                return Err(IdeError::invalid(format!("mojo format failed:\n{}", run.stderr_tail())));
            }
            formatted.map_err(|e| IdeError::internal(e.to_string()))
        })
        .await;
    host.end_request(request);
    result
}

ide_command::domain!(fork_mojo: pyidea_mojo_setup, pyidea_mojo_status, pyidea_mojo_build_line, pyidea_mojo_build, pyidea_mojo_format);
