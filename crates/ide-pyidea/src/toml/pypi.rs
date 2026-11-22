//! PyPI's simple index (PEP 691 JSON with PEP 700's version list).

use std::collections::BTreeSet;

/// The version a distribution file is of: the first `-` separated part after the name that
/// starts with a digit (`python_dateutil-2.8.2-py3-none-any.whl`, `python-dateutil-2.8.2.tar.gz`).
pub fn file_version(filename: &str) -> Option<&str> {
    let stem = [".whl", ".tar.gz", ".tar.bz2", ".tar.xz", ".zip", ".tgz", ".egg", ".exe", ".msi"]
        .iter()
        .find_map(|ext| filename.strip_suffix(ext))?;
    stem.split('-').skip(1).find(|part| part.starts_with(|c: char| c.is_ascii_digit()))
}

/// The versions with at least one file that isn't yanked.
pub fn pypi_versions(json: &str) -> Option<Vec<String>> {
    let index: serde_json::Value = serde_json::from_str(json).ok()?;
    let mut available = BTreeSet::new();
    for file in index.get("files")?.as_array()? {
        let yanked = file.get("yanked").is_some_and(|y| y.as_bool() != Some(false));
        if let Some(version) = file.get("filename").and_then(|f| f.as_str()).and_then(file_version)
            && !yanked
        {
            available.insert(version.to_owned());
        }
    }
    Some(match index.get("versions").and_then(|v| v.as_array()) {
        Some(listed) => {
            listed.iter().filter_map(|v| v.as_str()).filter(|v| available.contains(*v)).map(str::to_owned).collect()
        }
        None => available.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_versions_from_the_simple_index_without_yanked_ones() {
        let json = r#"{
            "meta": {"api-version": "1.1"},
            "name": "python-dateutil",
            "files": [
                {"filename": "python-dateutil-2.8.1.tar.gz", "yanked": false},
                {"filename": "python_dateutil-2.8.2-py2.py3-none-any.whl", "yanked": false},
                {"filename": "python_dateutil-2.9.0-py2.py3-none-any.whl", "yanked": "broken metadata"},
                {"filename": "python-dateutil-3.0rc1.tar.gz"}
            ],
            "versions": ["2.8.1", "2.8.2", "2.9.0", "3.0rc1"]
        }"#;
        assert_eq!(pypi_versions(json).unwrap(), ["2.8.1", "2.8.2", "3.0rc1"]);
        assert_eq!(file_version("3to2-1.1.1.zip"), Some("1.1.1"));
        assert_eq!(file_version("notes.txt"), None);
    }
}
