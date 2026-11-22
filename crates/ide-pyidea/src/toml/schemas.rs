//! PyIdea's bundled schemas for `pyproject.toml`, `uv.toml` and `ruff.toml` (`schemas/`),
//! written to the data directory for taplo.
//!
//! Each written schema's `$id` is its own file URL: taplo resolves relative `$ref`s against it
//! (without one they resolve against an unsupported `json-schema:` base). Its hover and
//! completion still don't follow `$ref`s into other files, so `pyproject.json` is written
//! self-contained, with the files it references inlined under `definitions`.

use ide_core::{IdeError, IdeResult};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

const SOURCES: &[(&str, &str)] = &[
    ("pyproject.json", include_str!("../../schemas/pyproject.json")),
    ("project_metadata.schema.json", include_str!("../../schemas/project_metadata.schema.json")),
    ("uv.json", include_str!("../../schemas/uv.json")),
    ("ruff.json", include_str!("../../schemas/ruff.json")),
];

/// The schemas written for taplo, the documents they describe and those documents' names.
const WRITTEN: &[(&str, &str, &[&str])] = &[
    ("pyproject.json", r".*/pyproject\.toml$", &["pyproject.toml"]),
    ("uv.json", r".*/uv\.toml$", &["uv.toml"]),
    ("ruff.json", r".*/\.?ruff\.toml$", &["ruff.toml", ".ruff.toml"]),
];

/// A document pattern (a regular expression over the document URI, as taplo's
/// `schema.associations` takes) and the schema URL for it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TomlSchemaAssociation {
    pub pattern: String,
    pub schema: String,
    /// File names the pattern matches: a user's own association for one of them wins.
    pub files: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TomlSchemas {
    pub associations: Vec<TomlSchemaAssociation>,
    /// URL prefix of every bundled schema: associations to it are the IDE's own.
    pub prefix: String,
}

fn source(name: &str) -> Option<Value> {
    SOURCES.iter().find(|(n, _)| *n == name).and_then(|(_, text)| serde_json::from_str(text).ok())
}

/// RFC 6901 escaping of one pointer segment.
fn escape(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

/// Points the internal references (`#/…`) of a schema moved to `#{prefix}` below it.
fn rehome(node: &mut Value, prefix: &str) {
    match node {
        Value::Object(map) => {
            for (key, value) in map.iter_mut() {
                match value {
                    Value::String(target) if key == "$ref" && target.starts_with('#') => {
                        *target = format!("#{prefix}{}", &target[1..]);
                    }
                    _ => rehome(value, prefix),
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|item| rehome(item, prefix)),
        _ => {}
    }
}

/// `root` with every reference to another file (`uv.json`, `other.json#/definitions/x`) replaced
/// by one into a copy of that file under `definitions` (`load` reads a file by name).
pub fn bundle(mut root: Value, load: &dyn Fn(&str) -> Option<Value>) -> Result<Value, String> {
    let mut inlined: Map<String, Value> = Map::new();
    let mut pending: Vec<String> = Vec::new();
    externals(&mut root, &mut pending);
    while let Some(file) = pending.pop() {
        let key = format!("external:{file}");
        if inlined.contains_key(&key) {
            continue;
        }
        let mut schema = load(&file).ok_or_else(|| format!("{file} is not bundled"))?;
        if let Value::Object(map) = &mut schema {
            map.remove("$schema");
            map.remove("$id");
        }
        rehome(&mut schema, &format!("/definitions/{}", escape(&key)));
        externals(&mut schema, &mut pending);
        inlined.insert(key, schema);
    }
    let Value::Object(map) = &mut root else { return Err("the schema is not an object".into()) };
    let definitions = map.entry("definitions").or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(definitions) = definitions else { return Err("`definitions` is not an object".into()) };
    definitions.extend(inlined);
    Ok(root)
}

/// Rewrites references to other files to their bundled copies, collecting the files.
fn externals(node: &mut Value, files: &mut Vec<String>) {
    match node {
        Value::Object(map) => {
            for (key, value) in map.iter_mut() {
                match value {
                    Value::String(target) if key == "$ref" && !target.starts_with('#') => {
                        let (file, pointer) = target.split_once('#').unwrap_or((target.as_str(), ""));
                        let file = file.to_owned();
                        *target = format!("#/definitions/{}{pointer}", escape(&format!("external:{file}")));
                        files.push(file);
                    }
                    _ => externals(value, files),
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|item| externals(item, files)),
        _ => {}
    }
}

/// FNV-1a of the bundled sources: the directory name, so a new bundle never mixes with an old one.
fn version() -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for (name, text) in SOURCES {
        for byte in name.bytes().chain(text.bytes()) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{hash:016x}")
}

/// Writes the schemas for taplo below `<data_dir>/pyidea/toml-schemas/` (once per bundle) and
/// returns their associations; `to_uri` turns a path into a `file://` URL.
pub fn install(data_dir: &Path, to_uri: &dyn Fn(&Path) -> String) -> IdeResult<TomlSchemas> {
    let base = data_dir.join("pyidea").join("toml-schemas");
    let dir = base.join(version());
    let mut associations = Vec::new();
    for (name, pattern, files) in WRITTEN {
        let path = dir.join(name);
        let url = to_uri(&path);
        if !path.is_file() {
            write_schema(&path, name, &url)?;
        }
        let files = files.iter().map(|f| (*f).to_owned()).collect();
        associations.push(TomlSchemaAssociation { pattern: (*pattern).to_owned(), schema: url, files });
    }
    remove_stale(&base, &dir);
    let mut prefix = to_uri(&base);
    if !prefix.ends_with('/') {
        prefix.push('/');
    }
    Ok(TomlSchemas { associations, prefix })
}

fn write_schema(path: &Path, name: &str, url: &str) -> IdeResult<()> {
    let schema = source(name).ok_or_else(|| IdeError::internal(format!("{name} is not bundled")))?;
    let mut schema =
        if name == "pyproject.json" { bundle(schema, &source).map_err(IdeError::internal)? } else { schema };
    if let Value::Object(map) = &mut schema {
        map.insert("$id".into(), Value::String(url.to_owned()));
    }
    let dir = path.parent().unwrap_or(path);
    std::fs::create_dir_all(dir).map_err(|e| IdeError::internal(e.to_string()))?;
    // Written whole, then renamed: taplo never reads a half-written schema.
    let tmp = dir.join(format!(".{name}.tmp"));
    std::fs::write(&tmp, schema.to_string()).map_err(|e| IdeError::internal(e.to_string()))?;
    std::fs::rename(&tmp, path).map_err(|e| IdeError::internal(e.to_string()))
}

/// Earlier bundles' directories.
fn remove_stale(base: &Path, current: &Path) {
    let Ok(entries) = std::fs::read_dir(base) else { return };
    let stale: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p != current && p.is_dir()).collect();
    for dir in stale {
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refs(node: &Value, out: &mut Vec<String>) {
        match node {
            Value::Object(map) => {
                for (key, value) in map {
                    match value {
                        Value::String(target) if key == "$ref" => out.push(target.clone()),
                        _ => refs(value, out),
                    }
                }
            }
            Value::Array(items) => items.iter().for_each(|item| refs(item, out)),
            _ => {}
        }
    }

    #[test]
    fn the_bundled_pyproject_schema_is_self_contained() {
        let bundled = bundle(source("pyproject.json").unwrap(), &source).unwrap();
        let mut all = Vec::new();
        refs(&bundled, &mut all);
        assert!(all.len() > 100, "{} references", all.len());
        for target in &all {
            let pointer = target.strip_prefix('#').unwrap_or_else(|| panic!("{target} points to another file"));
            assert!(bundled.pointer(pointer).is_some(), "{target} doesn't resolve");
        }
        let definitions = bundled["definitions"].as_object().unwrap();
        for file in ["project_metadata.schema.json", "uv.json", "ruff.json"] {
            assert!(definitions.contains_key(&format!("external:{file}")), "{file} is inlined");
        }
    }

    #[test]
    fn bundling_keeps_pointers_into_other_files() {
        let root = serde_json::json!({ "properties": { "a": { "$ref": "other.json#/definitions/x" } } });
        let other =
            serde_json::json!({ "definitions": { "x": { "$ref": "#/definitions/y" }, "y": { "type": "string" } } });
        let load = |name: &str| (name == "other.json").then(|| other.clone());
        let bundled = bundle(root, &load).unwrap();
        let a = bundled["properties"]["a"]["$ref"].as_str().unwrap();
        assert_eq!(a, "#/definitions/external:other.json/definitions/x");
        let x = bundled.pointer(&a[1..]).unwrap();
        assert_eq!(x["$ref"], "#/definitions/external:other.json/definitions/y");
        assert!(bundle(serde_json::json!({ "$ref": "missing.json" }), &load).is_err());
    }

    #[test]
    fn installs_once_per_bundle_with_file_ids() {
        let dir = tempfile::tempdir().unwrap();
        let stale = dir.path().join("pyidea/toml-schemas/old");
        std::fs::create_dir_all(&stale).unwrap();
        let to_uri = |p: &Path| format!("file://{}", p.display());
        let installed = install(dir.path(), &to_uri).unwrap();
        assert_eq!(installed.associations.len(), 3);
        assert!(!stale.exists());
        for association in &installed.associations {
            assert!(association.schema.starts_with(&installed.prefix));
            let path = association.schema.strip_prefix("file://").unwrap();
            let schema: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
            assert_eq!(schema["$id"], association.schema.as_str());
        }
        assert_eq!(install(dir.path(), &to_uri).unwrap(), installed);
    }
}
