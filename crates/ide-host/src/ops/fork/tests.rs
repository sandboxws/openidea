//! The Python Tests explorer: collection (which imports project code, but runs no test body),
//! the tests a change affects, test runs (prepared here and started by the frontend as run
//! configurations, so Run and Debug work as usual) and the stream of their results.

use crate::ops::Channel;
use crate::{Host, Project};
use ide_command::command;
use ide_core::{IdeError, IdeResult, IpcPath, RequestId};
use ide_pyidea::tests::events::{self, PythonTestEvent};
use ide_pyidea::tests::model::{HelperOutput, ImportGraph, PythonCollectedTest, PythonTestFramework};
use ide_pyidea::tests::{helpers, related, run};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

/// Per project: the interpreter of the last collection, its import graph and test files.
struct Collected {
    interpreter: PathBuf,
    graph: ImportGraph,
    test_files: BTreeSet<String>,
}

static COLLECTED: LazyLock<Mutex<HashMap<PathBuf, Collected>>> = LazyLock::new(Default::default);

const COLLECT_TIMEOUT: Duration = Duration::from_secs(180);
const GRAPH_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonTestCollectSpec {
    pub framework: PythonTestFramework,
    /// The interpreter (absolute, or relative to the project); default: the project's.
    #[serde(default)]
    pub interpreter: Option<String>,
    /// Runner arguments of a saved configuration (`-k slow`, `--doctest-modules`).
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonTestCollection {
    pub tests: Vec<PythonCollectedTest>,
    /// Collection failures (import errors…), shown beside the tests that did collect.
    pub errors: Vec<String>,
    pub interpreter: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonRelatedTests {
    pub test_files: Vec<IpcPath>,
    /// Collect again first: the change can add, remove or rename tests.
    pub refresh: bool,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonDoctestExample {
    pub file: IpcPath,
    /// 1-based line of the example's `>>>` prompt.
    pub line: u32,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonTestRunSpec {
    pub framework: PythonTestFramework,
    #[serde(default)]
    pub interpreter: Option<String>,
    /// Test ids to run; empty runs everything.
    #[serde(default)]
    pub ids: Vec<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub cwd: Option<IpcPath>,
    #[serde(default)]
    pub example: Option<PythonDoctestExample>,
}

/// A prepared run: start `interpreter args` in `cwd` with `env`; results append to `events`.
#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonTestRun {
    pub interpreter: String,
    pub args: Vec<String>,
    pub cwd: IpcPath,
    pub env: BTreeMap<String, String>,
    pub events: IpcPath,
}

fn interpreter(project: &Project, requested: Option<&str>) -> IdeResult<PathBuf> {
    if let Some(path) = requested.and_then(|r| ide_sdk::apply::setting_path(&project.root, r)) {
        return Ok(path);
    }
    let settings = project.settings.effective();
    ide_sdk::apply::python_interpreter_near(&project.root, None, &settings).ok_or_else(|| {
        IdeError::invalid("No local Python interpreter: choose one in Settings › Languages & Frameworks › Python")
    })
}

/// `PYTHONPATH` with the helpers and the project's roots in front of what `env` has.
fn python_env(
    project: &Project,
    helpers: &Path,
    mut env: BTreeMap<String, String>,
) -> IdeResult<BTreeMap<String, String>> {
    let mut paths = vec![helpers.to_path_buf()];
    paths.extend(super::super::python::paths(project));
    ide_run::python_path::extend(&mut env, &paths, true)?;
    env.insert("PYTHONUNBUFFERED".into(), "1".into());
    env.insert("PYTHONDONTWRITEBYTECODE".into(), "1".into());
    Ok(env)
}

fn scratch_file(data_dir: &Path, dir: &str, ext: &str) -> IdeResult<PathBuf> {
    let dir = data_dir.join("pyidea").join(dir);
    std::fs::create_dir_all(&dir).map_err(|e| IdeError::internal(e.to_string()))?;
    // Keep the last few dozen; older run logs and requests are of no use.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        let mut files: Vec<_> =
            entries.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).collect();
        if files.len() > 40 {
            files.sort();
            for (_, path) in &files[..files.len() - 40] {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    Ok(dir.join(format!("{}.{ext}", uuid::Uuid::new_v4())))
}

/// Runs the collection helper and reads its output.
fn run_collector(
    data_dir: &Path,
    project: &Project,
    python: &Path,
    request: serde_json::Value,
    env: BTreeMap<String, String>,
    cancel: &ide_core::CancellationToken,
    timeout: Duration,
) -> IdeResult<HelperOutput> {
    let helpers = helpers::install(data_dir)?;
    let request_file = scratch_file(data_dir, "collect", "json")?;
    let output_file = request_file.with_extension("out.json");
    std::fs::write(&request_file, request.to_string()).map_err(|e| IdeError::internal(e.to_string()))?;
    let env = python_env(project, &helpers, env)?;
    let mut command = Command::new(python);
    ide_core::process::prepare(&mut command);
    command
        .arg(helpers.join(helpers::COLLECT))
        .arg(&request_file)
        .arg(&output_file)
        .current_dir(&project.root)
        .envs(&env)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child =
        command.spawn().map_err(|e| IdeError::invalid(format!("cannot start {}: {e}", python.display())))?;
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| IdeError::internal(e.to_string()))? {
            break status;
        }
        if cancel.is_cancelled() || started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&request_file);
            return Err(if cancel.is_cancelled() {
                IdeError::cancelled()
            } else {
                IdeError::invalid("Test collection timed out")
            });
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = std::io::Read::read_to_string(&mut pipe, &mut stderr);
    }
    let _ = std::fs::remove_file(&request_file);
    let output = std::fs::read_to_string(&output_file);
    let _ = std::fs::remove_file(&output_file);
    match output {
        Ok(json) => serde_json::from_str(&json).map_err(|e| IdeError::internal(format!("unreadable collection: {e}"))),
        Err(_) => {
            let tail: String =
                stderr.lines().rev().take(20).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            Err(IdeError::invalid(format!("Test collection failed ({status}):\n{tail}")))
        }
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> IdeResult<T> + Send + 'static) -> IdeResult<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| IdeError::internal(e.to_string()))?
}

/// Collects `spec.framework`'s tests with the project's (or the given) interpreter. Collection
/// imports project code and runs collection hooks, not test bodies. Cancel with
/// `cancel_request(request)`.
#[command(trust = trusted)]
pub async fn pyidea_tests_collect(
    host: &Host,
    window: &str,
    spec: PythonTestCollectSpec,
    request: RequestId,
) -> IdeResult<PythonTestCollection> {
    let project = host.project(window)?;
    project.require_trust()?;
    let data_dir = host.local_data_dir.clone();
    let cancel = host.begin_request(request);
    let result = blocking(move || {
        let python = interpreter(&project, spec.interpreter.as_deref())?;
        let roots = super::super::python::paths(&project);
        let previous = COLLECTED.lock().get(&project.root).map(|c| c.graph.clone());
        let req = run::collect_request(&project.root, Some(spec.framework), &roots, &[], &spec.args, previous.as_ref());
        let output = run_collector(&data_dir, &project, &python, req, spec.env, &cancel, COLLECT_TIMEOUT)?;
        let test_files = output.tests.iter().map(|t| t.file.clone()).collect();
        COLLECTED.lock().insert(
            project.root.clone(),
            Collected { interpreter: python.clone(), graph: output.import_graph(), test_files },
        );
        Ok(PythonTestCollection {
            tests: output.tests,
            errors: output.errors,
            interpreter: python.display().to_string(),
        })
    })
    .await;
    host.end_request(request);
    result
}

/// The collected test files that `changed` files affect, after refreshing the import graph.
/// Empty until the project's tests were collected.
#[command(trust = trusted)]
pub async fn pyidea_tests_related(host: &Host, window: &str, changed: Vec<IpcPath>) -> IdeResult<PythonRelatedTests> {
    let project = host.project(window)?;
    project.require_trust()?;
    let data_dir = host.local_data_dir.clone();
    blocking(move || {
        let Some((python, previous, test_files)) =
            COLLECTED.lock().get(&project.root).map(|c| (c.interpreter.clone(), c.graph.clone(), c.test_files.clone()))
        else {
            return Ok(PythonRelatedTests { test_files: Vec::new(), refresh: false });
        };
        let roots = super::super::python::paths(&project);
        let req = run::collect_request(&project.root, None, &roots, &[], &[], Some(&previous));
        let graph =
            match run_collector(&data_dir, &project, &python, req, BTreeMap::new(), &Default::default(), GRAPH_TIMEOUT)
            {
                Ok(output) => output.import_graph(),
                // An interpreter gone or a helper failure: the last graph still answers.
                Err(_) => previous,
            };
        if let Some(entry) = COLLECTED.lock().get_mut(&project.root) {
            entry.graph = graph.clone();
        }
        let changed: Vec<String> = changed.iter().map(|p| p.0.display().to_string()).collect();
        let found = related::related(&graph, &test_files, &changed);
        Ok(PythonRelatedTests {
            test_files: found.test_files.into_iter().map(|f| IpcPath(PathBuf::from(f))).collect(),
            refresh: found.refresh,
        })
    })
    .await
}

/// The command line of a test run that reports results to the returned `events` file.
#[command(trust = trusted)]
pub async fn pyidea_tests_prepare(host: &Host, window: &str, spec: PythonTestRunSpec) -> IdeResult<PythonTestRun> {
    let project = host.project(window)?;
    project.require_trust()?;
    let data_dir = host.local_data_dir.clone();
    blocking(move || {
        let python = interpreter(&project, spec.interpreter.as_deref())?;
        let helpers = helpers::install(&data_dir)?;
        let events = scratch_file(&data_dir, "runs", "jsonl")?;
        let cwd = spec.cwd.map(|c| c.0).unwrap_or_else(|| project.root.clone());
        let example_file = spec.example.as_ref().map(|e| e.file.0.display().to_string());
        let target = run::RunTarget {
            ids: &spec.ids,
            args: &spec.args,
            example: spec.example.as_ref().zip(example_file.as_deref()).map(|(e, f)| (f, e.line)),
            start: Some(&cwd),
        };
        let args = run::run_args(spec.framework, &target);
        let mut env = python_env(&project, &helpers, spec.env)?;
        env.insert("OPENIDEA_TEST_EVENTS".into(), events.display().to_string());
        Ok(PythonTestRun {
            interpreter: python.display().to_string(),
            args,
            cwd: IpcPath(cwd),
            env,
            events: IpcPath(events),
        })
    })
    .await
}

/// Streams the results a prepared run appends to `events` until it reports the end, or until
/// `cancel_request(request)` (after the run's process exits), which reads what's left first.
#[command(trust = always)]
pub async fn pyidea_tests_events(
    host: &Host,
    events: IpcPath,
    request: RequestId,
    on_event: Channel<PythonTestEvent>,
) -> IdeResult<()> {
    let cancel = host.begin_request(request);
    let path = events.0;
    let mut offset = 0;
    let started = Instant::now();
    let result = loop {
        let cancelled = cancel.is_cancelled();
        let (batch, next) = match events::read_new(&path, offset) {
            Ok(read) => read,
            Err(e) => break Err(IdeError::internal(e.to_string())),
        };
        offset = next;
        let mut finished = false;
        for event in batch {
            finished |= matches!(event, PythonTestEvent::Finished { .. });
            on_event.send(event)?;
        }
        if finished || cancelled || started.elapsed() > Duration::from_secs(12 * 3600) {
            break Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    host.end_request(request);
    result
}

ide_command::domain!(
    fork_tests: pyidea_tests_collect,
    pyidea_tests_related,
    pyidea_tests_prepare,
    pyidea_tests_events
);
