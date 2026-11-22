//! Which collected test files a change affects (PyIdea's related-test watch): files that
//! import a changed file, directly or through shared modules and test helpers; the changed
//! source file's mirrored test file (`pkg/cart.py` ↔ `tests/pkg/test_cart.py`, with the
//! directory path deciding between files of the same name); and every test file under a
//! changed `conftest.py`. A runner configuration change, a changed `conftest.py`, or a test
//! file collection doesn't know yet calls for collecting again first.

use super::model::ImportGraph;
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::path::Path;

/// Files whose change can alter what pytest or unittest collects.
const RUNNER_CONFIG: &[&str] = &["pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini"];

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Related {
    /// Collected test files to run, sorted.
    pub test_files: Vec<String>,
    /// Collect again before running: the changes can add, remove or rename tests.
    pub refresh: bool,
}

fn file_name(path: &str) -> &str {
    Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or("")
}

fn is_test_file_name(name: &str) -> bool {
    name.ends_with(".py") && (name.starts_with("test_") || name.ends_with("_test.py"))
}

fn under(path: &str, dir: &Path) -> bool {
    Path::new(path).starts_with(dir)
}

/// Directory components, without the conventional `src` / `tests` / `test` containers.
fn components(path: &str) -> Vec<String> {
    Path::new(path)
        .parent()
        .map(|p| {
            p.components()
                .filter_map(|c| c.as_os_str().to_str())
                .filter(|c| !matches!(*c, "src" | "tests" | "test" | "/"))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The test files mirroring `source`: `test_<stem>.py` / `<stem>_test.py`, the ones sharing the
/// longest trailing directory path with it when several have that name.
pub fn mirrors(source: &str, test_files: &BTreeSet<String>) -> Vec<String> {
    let Some(stem) = file_name(source).strip_suffix(".py") else { return Vec::new() };
    let names = [format!("test_{stem}.py"), format!("{stem}_test.py")];
    let candidates: Vec<&String> = test_files.iter().filter(|t| names.iter().any(|n| n == file_name(t))).collect();
    if candidates.len() <= 1 {
        return candidates.into_iter().cloned().collect();
    }
    let own = components(source);
    let score = |test: &str| {
        let theirs = components(test);
        own.iter().rev().zip(theirs.iter().rev()).take_while(|(a, b)| a == b).count()
    };
    let best = candidates.iter().map(|t| score(t)).max().unwrap_or(0);
    if best == 0 {
        return Vec::new();
    }
    candidates.into_iter().filter(|t| score(t) == best).cloned().collect()
}

pub fn related(graph: &ImportGraph, test_files: &BTreeSet<String>, changed: &[String]) -> Related {
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();
    for (file, imports) in &graph.graph {
        for import in imports {
            dependents.entry(import.as_str()).or_default().push(file.as_str());
        }
    }
    let mut refresh = false;
    let mut out: BTreeSet<String> = BTreeSet::new();
    let mut affected: BTreeSet<String> = BTreeSet::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    for path in changed {
        let name = file_name(path);
        if RUNNER_CONFIG.contains(&name) {
            refresh = true;
            continue;
        }
        if name == "conftest.py" {
            refresh = true;
            if let Some(dir) = Path::new(path).parent() {
                out.extend(test_files.iter().filter(|t| under(t, dir)).cloned());
            }
            continue;
        }
        if !name.ends_with(".py") {
            continue;
        }
        if is_test_file_name(name) && !test_files.contains(path) {
            refresh = true;
        }
        if test_files.contains(path) && !Path::new(path).exists() {
            refresh = true;
        }
        if !test_files.contains(path) {
            out.extend(mirrors(path, test_files));
        }
        if affected.insert(path.clone()) {
            queue.push_back(path.clone());
        }
    }
    while let Some(file) = queue.pop_front() {
        for dependent in dependents.get(file.as_str()).into_iter().flatten() {
            if affected.insert((*dependent).to_owned()) {
                queue.push_back((*dependent).to_owned());
            }
        }
    }
    out.extend(affected.into_iter().filter(|f| test_files.contains(f)));
    Related { test_files: out.into_iter().collect(), refresh }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph(edges: &[(&str, &[&str])]) -> ImportGraph {
        ImportGraph {
            graph: edges
                .iter()
                .map(|(f, deps)| (f.to_string(), deps.iter().map(|d| d.to_string()).collect()))
                .collect(),
            stamps: Default::default(),
        }
    }

    fn set(files: &[&str]) -> BTreeSet<String> {
        files.iter().map(|f| f.to_string()).collect()
    }

    #[test]
    fn follows_imports_transitively_through_shared_modules_and_helpers() {
        let g = graph(&[
            ("/p/tests/test_cart.py", &["/p/tests/helpers.py"]),
            ("/p/tests/helpers.py", &["/p/src/shop/cart.py"]),
            ("/p/src/shop/cart.py", &["/p/src/shop/price.py"]),
            ("/p/tests/test_other.py", &[]),
        ]);
        let tests = set(&["/p/tests/test_cart.py", "/p/tests/test_other.py"]);
        let r = related(&g, &tests, &["/p/src/shop/price.py".into()]);
        assert_eq!(r, Related { test_files: vec!["/p/tests/test_cart.py".into()], refresh: false });
        // A changed test file runs itself.
        let r = related(&g, &tests, &["/p/tests/test_other.py".into()]);
        assert_eq!(r.test_files, ["/p/tests/test_other.py"]);
    }

    #[test]
    fn pairs_source_files_with_their_mirrored_test_files() {
        let tests = set(&[
            "/p/exercises/one/tests/test_solution.py",
            "/p/exercises/two/tests/test_solution.py",
            "/p/tests/test_cart.py",
            "/p/tests/cart_test.py",
        ]);
        let g = ImportGraph::default();
        assert_eq!(
            related(&g, &tests, &["/p/exercises/two/solution.py".into()]).test_files,
            ["/p/exercises/two/tests/test_solution.py"]
        );
        assert_eq!(
            related(&g, &tests, &["/p/src/cart.py".into()]).test_files,
            ["/p/tests/cart_test.py", "/p/tests/test_cart.py"]
        );
        // Same names in unrelated directories: no guess.
        assert!(related(&g, &tests, &["/p/lib/solution.py".into()]).test_files.is_empty());
    }

    #[test]
    fn conftest_affects_its_subtree_and_config_changes_refresh() {
        let tests = set(&["/p/tests/api/test_a.py", "/p/tests/api/test_b.py", "/p/tests/test_c.py"]);
        let g = ImportGraph::default();
        let r = related(&g, &tests, &["/p/tests/api/conftest.py".into()]);
        assert_eq!(r.test_files, ["/p/tests/api/test_a.py", "/p/tests/api/test_b.py"]);
        assert!(r.refresh);
        let r = related(&g, &tests, &["/p/pyproject.toml".into()]);
        assert!(r.refresh && r.test_files.is_empty());
    }

    #[test]
    fn new_test_files_need_collecting() {
        let r = related(&ImportGraph::default(), &set(&[]), &["/p/tests/test_new.py".into()]);
        assert!(r.refresh);
        assert!(related(&ImportGraph::default(), &set(&[]), &["/p/README.md".into()]) == Related::default());
    }
}
