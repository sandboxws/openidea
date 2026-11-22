//! The collection helper's request and the runners' command lines.

use super::model::{ImportGraph, PythonTestFramework};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// Options that stop or hijack a run meant to report in the explorer.
const STRIP: &[&str] = &["--pdb", "--trace", "-x", "--exitfirst", "--collect-only", "--co"];

/// The helper request collecting `framework`'s tests (`None`: only refresh the import graph).
pub fn collect_request(
    project: &Path,
    framework: Option<PythonTestFramework>,
    roots: &[PathBuf],
    targets: &[String],
    args: &[String],
    previous: Option<&ImportGraph>,
) -> Value {
    json!({
        "project": project,
        "framework": framework.map_or("graph", PythonTestFramework::name),
        "roots": roots,
        "discovery": project,
        "targets": targets,
        "args": args.iter().filter(|a| !STRIP.contains(&a.as_str())).collect::<Vec<_>>(),
        "excluded": [],
        "previous": previous.map(|g| json!({ "graph": g.graph, "stamps": g.stamps })),
    })
}

/// A run of `ids` (all tests when empty), or of one doctest example.
#[derive(Clone, Debug, Default)]
pub struct RunTarget<'a> {
    pub ids: &'a [String],
    pub args: &'a [String],
    /// `(file, 1-based line of the example's >>> prompt)`.
    pub example: Option<(&'a str, u32)>,
    /// unittest discovery start when `ids` is empty.
    pub start: Option<&'a Path>,
}

/// Interpreter arguments of a run (the reporting helpers must be importable).
pub fn run_args(framework: PythonTestFramework, target: &RunTarget) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    match framework {
        PythonTestFramework::Pytest => {
            out.extend(["-m", "pytest", "-p", "openidea_pytest_reporter"].map(String::from));
            out.extend(target.args.iter().filter(|a| !STRIP.contains(&a.as_str())).cloned());
            out.extend(target.ids.iter().cloned());
        }
        PythonTestFramework::Unittest => {
            out.extend(["-m", "openidea_unittest_runner"].map(String::from));
            if target.ids.is_empty()
                && let Some(start) = target.start
            {
                out.extend(["--start".into(), start.display().to_string()]);
            }
            out.extend(target.ids.iter().cloned());
        }
        PythonTestFramework::Doctest => {
            out.extend(["-m", "openidea_doctest_runner"].map(String::from));
            if let Some((file, line)) = target.example {
                out.extend([file.to_owned(), "--example".into(), line.to_string()]);
            } else {
                out.extend(target.ids.iter().cloned());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn pytest_runs_report_and_drop_options_that_stop_the_run() {
        let ids = strings(&["tests/test_a.py::test_x[1]"]);
        let args = strings(&["-q", "--pdb", "-x", "--maxfail=3"]);
        let got = run_args(PythonTestFramework::Pytest, &RunTarget { ids: &ids, args: &args, ..Default::default() });
        assert_eq!(
            got,
            strings(&[
                "-m",
                "pytest",
                "-p",
                "openidea_pytest_reporter",
                "-q",
                "--maxfail=3",
                "tests/test_a.py::test_x[1]"
            ])
        );
    }

    #[test]
    fn unittest_and_doctest_runs_use_their_helpers() {
        let none: Vec<String> = Vec::new();
        let start = Path::new("/p");
        assert_eq!(
            run_args(
                PythonTestFramework::Unittest,
                &RunTarget { ids: &none, start: Some(start), ..Default::default() }
            ),
            strings(&["-m", "openidea_unittest_runner", "--start", "/p"])
        );
        let ids = strings(&["/p/a.py::area"]);
        assert_eq!(
            run_args(PythonTestFramework::Doctest, &RunTarget { ids: &ids, ..Default::default() }),
            strings(&["-m", "openidea_doctest_runner", "/p/a.py::area"])
        );
        assert_eq!(
            run_args(PythonTestFramework::Doctest, &RunTarget { example: Some(("/p/a.py", 7)), ..Default::default() }),
            strings(&["-m", "openidea_doctest_runner", "/p/a.py", "--example", "7"])
        );
    }

    #[test]
    fn collection_requests_name_the_framework_or_the_graph() {
        let graph = ImportGraph::default();
        let req = collect_request(Path::new("/p"), None, &[PathBuf::from("/p/src")], &[], &[], Some(&graph));
        assert_eq!(req["framework"], "graph");
        assert_eq!(req["roots"][0], "/p/src");
        assert!(req["previous"].is_object());
        let req = collect_request(
            Path::new("/p"),
            Some(PythonTestFramework::Pytest),
            &[],
            &[],
            &strings(&["--pdb", "-k", "x"]),
            None,
        );
        assert_eq!(req["framework"], "pytest");
        assert_eq!(req["args"], json!(["-k", "x"]));
        assert!(req["previous"].is_null());
    }
}
