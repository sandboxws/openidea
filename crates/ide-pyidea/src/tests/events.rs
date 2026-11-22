//! The test runners' JSON-lines events (`$OPENIDEA_TEST_EVENTS`), read as a run appends them.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonTestLocation {
    pub file: String,
    /// 1-based.
    pub line: u32,
}

/// Source lines around a failure, with their original line numbers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonTestSnapshot {
    pub file: String,
    /// 1-based number of `lines[0]`.
    pub start: u32,
    /// 1-based number of the reported line.
    pub line: u32,
    pub lines: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PythonTestOutcome {
    Passed,
    Failed,
    Error,
    Skipped,
    Xfailed,
    Xpassed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonTestResult {
    pub id: String,
    pub outcome: PythonTestOutcome,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub longrepr: Option<String>,
    #[serde(default)]
    pub location: Option<PythonTestLocation>,
    #[serde(default)]
    pub expected: Option<String>,
    #[serde(default)]
    pub actual: Option<String>,
    #[serde(default)]
    pub params: Option<BTreeMap<String, String>>,
    #[serde(default)]
    pub snapshot: Option<PythonTestSnapshot>,
    #[serde(default)]
    pub stdout: Option<String>,
    #[serde(default)]
    pub stderr: Option<String>,
    #[serde(default)]
    pub log: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "event")]
pub enum PythonTestEvent {
    Collected { count: u32 },
    Started { id: String },
    Result(Box<PythonTestResult>),
    Finished { exitstatus: i32 },
}

/// Reads complete lines appended to `path` since byte `offset`: the events and the offset after
/// the last complete line (a partly written line waits for the next read). Unknown lines are skipped.
pub fn read_new(path: &Path, offset: u64) -> std::io::Result<(Vec<PythonTestEvent>, u64)> {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((Vec::new(), offset)),
        Err(e) => return Err(e),
    };
    file.seek(SeekFrom::Start(offset))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let Some(end) = bytes.iter().rposition(|b| *b == b'\n') else { return Ok((Vec::new(), offset)) };
    let events = String::from_utf8_lossy(&bytes[..end])
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    Ok((events, offset + end as u64 + 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_complete_lines_as_they_are_appended() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        assert_eq!(read_new(&path, 0).unwrap(), (vec![], 0));
        let mut f = std::fs::File::create(&path).unwrap();
        let first = concat!(
            r#"{"event":"collected","count":2}"#,
            "\n",
            r#"{"event":"started","id":"t::a"}"#,
            "\n",
            r#"{"event":"res"#
        );
        f.write_all(first.as_bytes()).unwrap();
        let (events, offset) = read_new(&path, 0).unwrap();
        assert_eq!(
            events,
            vec![PythonTestEvent::Collected { count: 2 }, PythonTestEvent::Started { id: "t::a".into() }]
        );
        let rest = concat!(
            r#"ult","id":"t::a","outcome":"failed","duration":0.5,"expected":"5","actual":"4","snapshot":{"file":"/t.py","start":3,"line":5,"lines":["a","b","c"]}}"#,
            "\n",
            r#"{"event":"finished","exitstatus":1}"#,
            "\n"
        );
        f.write_all(rest.as_bytes()).unwrap();
        let (events, end) = read_new(&path, offset).unwrap();
        let PythonTestEvent::Result(result) = &events[0] else { panic!("{events:?}") };
        assert_eq!(result.outcome, PythonTestOutcome::Failed);
        assert_eq!(result.expected.as_deref(), Some("5"));
        assert_eq!(result.snapshot.as_ref().unwrap().line, 5);
        assert_eq!(events[1], PythonTestEvent::Finished { exitstatus: 1 });
        assert_eq!(end, std::fs::metadata(&path).unwrap().len());
    }
}
