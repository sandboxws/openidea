//! The package graph of `uv.lock`, for transitive packages and "Why installed?".

use crate::toml::lock::normalize;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};

/// A locked package (every version the lock pins for it) and what it depends on.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonLockedPackage {
    /// Normalized.
    pub name: String,
    pub versions: Vec<String>,
    /// Normalized names: runtime, optional and development dependencies.
    pub dependencies: Vec<String>,
    /// A workspace member (the project itself): `source = { virtual | editable }`.
    pub member: bool,
}

fn names(value: Option<&toml::Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|d| d.get("name").and_then(|n| n.as_str()).map(normalize))
        .collect()
}

/// The packages of a `uv.lock`, by name.
pub fn lock_graph(text: &str) -> Vec<PythonLockedPackage> {
    let Ok(table) = text.parse::<toml::Table>() else { return Vec::new() };
    let mut by_name: BTreeMap<String, PythonLockedPackage> = BTreeMap::new();
    for package in table.get("package").and_then(|p| p.as_array()).into_iter().flatten() {
        let Some(name) = package.get("name").and_then(|n| n.as_str()).map(normalize) else { continue };
        let entry = by_name.entry(name.clone()).or_insert_with(|| PythonLockedPackage {
            name,
            versions: Vec::new(),
            dependencies: Vec::new(),
            member: false,
        });
        if let Some(version) = package.get("version").and_then(|v| v.as_str())
            && !entry.versions.iter().any(|v| v == version)
        {
            entry.versions.push(version.to_owned());
        }
        let source = package.get("source").and_then(|s| s.as_table());
        entry.member |= source.is_some_and(|s| s.contains_key("virtual") || s.contains_key("editable"));
        let mut deps = names(package.get("dependencies"));
        for key in ["optional-dependencies", "dev-dependencies"] {
            for (_, list) in package.get(key).and_then(|t| t.as_table()).into_iter().flatten() {
                deps.extend(names(Some(list)));
            }
        }
        for dep in deps {
            if !entry.dependencies.contains(&dep) {
                entry.dependencies.push(dep);
            }
        }
    }
    by_name.into_values().collect()
}

/// For each package reachable from the workspace members: the shortest chain of dependencies
/// from a member to it (`[member, …, package]`).
pub fn why_paths(graph: &[PythonLockedPackage]) -> HashMap<String, Vec<String>> {
    let index: HashMap<&str, &PythonLockedPackage> = graph.iter().map(|p| (p.name.as_str(), p)).collect();
    let mut parent: HashMap<&str, Option<&str>> = HashMap::new();
    let mut queue: VecDeque<&str> = VecDeque::new();
    for member in graph.iter().filter(|p| p.member) {
        parent.insert(&member.name, None);
        queue.push_back(&member.name);
    }
    while let Some(name) = queue.pop_front() {
        for dep in index.get(name).map(|p| p.dependencies.as_slice()).unwrap_or_default() {
            if !parent.contains_key(dep.as_str()) {
                parent.insert(dep, Some(name));
                queue.push_back(dep);
            }
        }
    }
    parent
        .keys()
        .map(|&name| {
            let mut chain = vec![name.to_owned()];
            let mut at = name;
            while let Some(Some(up)) = parent.get(at) {
                chain.push((*up).to_owned());
                at = up;
            }
            chain.reverse();
            (name.to_owned(), chain)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOCK: &str = r#"
version = 1

[[package]]
name = "web-app"
version = "0.1.0"
source = { virtual = "." }
dependencies = [{ name = "flask" }, { name = "Requests" }]

[package.optional-dependencies]
socks = [{ name = "pysocks" }]

[package.dev-dependencies]
dev = [{ name = "pytest" }]

[[package]]
name = "flask"
version = "3.1.3"
dependencies = [{ name = "werkzeug" }, { name = "click" }]

[[package]]
name = "werkzeug"
version = "3.1.3"
dependencies = [{ name = "markupsafe" }]

[[package]]
name = "markupsafe"
version = "3.0.2"

[[package]]
name = "requests"
version = "2.34.2"

[[package]]
name = "click"
version = "8.2.1"

[[package]]
name = "pysocks"
version = "1.7.1"

[[package]]
name = "pytest"
version = "8.4.0"
"#;

    #[test]
    fn reads_packages_members_and_edges() {
        let graph = lock_graph(LOCK);
        let app = graph.iter().find(|p| p.name == "web-app").unwrap();
        assert!(app.member);
        assert_eq!(app.dependencies, ["flask", "requests", "pysocks", "pytest"]);
        assert!(lock_graph("bad = [").is_empty());
    }

    #[test]
    fn finds_the_shortest_chain_to_each_package() {
        let paths = why_paths(&lock_graph(LOCK));
        assert_eq!(paths["markupsafe"], ["web-app", "flask", "werkzeug", "markupsafe"]);
        assert_eq!(paths["requests"], ["web-app", "requests"]);
        assert_eq!(paths["web-app"], ["web-app"]);
    }
}
