//! Commands of this fork's features (FORK.md); their domain logic lives in `ide-pyidea`.

pub mod deps;
pub mod mojo;
pub mod ruff;
pub mod science;
pub mod tests;
pub mod toml;
pub mod web;

use ide_core::{CancellationToken, IdeError, IdeResult};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

/// How a helper run ended, with (the end of) what it printed.
pub(crate) struct HelperRun {
    pub status: ExitStatus,
    pub stdout: String,
    pub stderr: String,
}

impl HelperRun {
    /// The last lines of stderr, for an error message.
    pub fn stderr_tail(&self) -> String {
        let lines: Vec<&str> = self.stderr.lines().collect();
        lines[lines.len().saturating_sub(20)..].join("\n")
    }
}

/// Runs `program args` in `cwd`, killing it on `cancel` or after `timeout` (`what` names it in
/// the timeout error). Both outputs are drained as they come, so a chatty program can't block
/// on a full pipe; each keeps its last 64 KiB.
pub(crate) fn run_program(
    python: &Path,
    args: &[OsString],
    cwd: &Path,
    env: &BTreeMap<String, String>,
    cancel: &CancellationToken,
    timeout: Duration,
    what: &str,
) -> IdeResult<HelperRun> {
    let mut command = Command::new(python);
    ide_core::process::prepare(&mut command);
    command.args(args).current_dir(cwd).envs(env).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child =
        command.spawn().map_err(|e| IdeError::invalid(format!("cannot start {}: {e}", python.display())))?;
    let stdout = child.stdout.take().map(drain);
    let stderr = child.stderr.take().map(drain);
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| IdeError::internal(e.to_string()))? {
            break status;
        }
        if cancel.is_cancelled() || started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if cancel.is_cancelled() {
                IdeError::cancelled()
            } else {
                IdeError::invalid(format!("{what} timed out"))
            });
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    let stdout = stdout.and_then(|t| t.join().ok()).unwrap_or_default();
    let stderr = stderr.and_then(|t| t.join().ok()).unwrap_or_default();
    Ok(HelperRun { status, stdout, stderr })
}

/// Reads a pipe to its end on its own thread, keeping the end: that's where a traceback or
/// error says what went wrong.
fn drain(mut pipe: impl std::io::Read + Send + 'static) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        let mut text = String::from_utf8_lossy(&bytes).into_owned();
        if text.len() > 64 * 1024 {
            let cut = text.ceil_char_boundary(text.len() - 64 * 1024);
            text.drain(..cut);
        }
        text
    })
}
