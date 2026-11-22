//! Ruff for Python save actions and suppression-comment completion: the arguments of safe-fix
//! and format runs over a document's text, the version, and the rule catalog
//! (`ruff rule --all`), cached per Ruff version.

use ide_core::{IdeError, IdeResult};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// One lint rule, as `ruff rule --all --output-format json` describes it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuffRule {
    /// `F401`.
    pub code: String,
    /// `unused-import`: the rule's documentation page name.
    pub name: String,
    /// `Pyflakes`.
    pub linter: String,
    pub summary: String,
    #[serde(default)]
    pub preview: bool,
}

/// `ruff 0.13.5` → `0.13.5`.
pub fn parse_version(stdout: &str) -> Option<String> {
    let version = stdout.trim().strip_prefix("ruff ")?.split_whitespace().next()?;
    version.chars().next().is_some_and(|c| c.is_ascii_digit()).then(|| version.to_owned())
}

/// Arguments of `ruff check` applying safe fixes to `file`'s text read from stdin and printing
/// the result: the project's configuration (or `config`) and exclusions apply, and a file the
/// configuration excludes comes back unchanged.
pub fn fix_args(file: &Path, config: Option<&Path>) -> Vec<OsString> {
    let mut args: Vec<OsString> =
        ["check", "--fix-only", "--exit-zero", "--quiet", "--force-exclude"].into_iter().map(OsString::from).collect();
    if let Some(config) = config {
        args.extend([OsString::from("--config"), config.as_os_str().to_owned()]);
    }
    args.extend([OsString::from("--stdin-filename"), file.as_os_str().to_owned(), OsString::from("-")]);
    args
}

/// Arguments of `ruff format` formatting `file`'s text read from stdin; an excluded file comes
/// back unchanged.
pub fn format_args(file: &Path, config: Option<&Path>) -> Vec<OsString> {
    let mut args: Vec<OsString> = ["format", "--quiet", "--force-exclude"].into_iter().map(OsString::from).collect();
    if let Some(config) = config {
        args.extend([OsString::from("--config"), config.as_os_str().to_owned()]);
    }
    args.extend([OsString::from("--stdin-filename"), file.as_os_str().to_owned(), OsString::from("-")]);
    args
}

/// Arguments that print the rule catalog.
pub fn rules_args() -> Vec<OsString> {
    ["rule", "--all", "--output-format", "json"].into_iter().map(OsString::from).collect()
}

/// A rule as Ruff prints it: rules that aren't tied to a code yet print `null` for it.
#[derive(Deserialize)]
struct RawRule {
    name: String,
    code: Option<String>,
    linter: Option<String>,
    summary: Option<String>,
    #[serde(default)]
    preview: bool,
}

/// Rules with a code (the ones a `# noqa` comment can name), sorted by code.
pub fn parse_rules(json: &str) -> IdeResult<Vec<RuffRule>> {
    let raw: Vec<RawRule> =
        serde_json::from_str(json).map_err(|e| IdeError::invalid(format!("unexpected `ruff rule` output: {e}")))?;
    let mut rules: Vec<RuffRule> = raw
        .into_iter()
        .filter_map(|r| {
            let code = r.code.filter(|c| !c.is_empty())?;
            Some(RuffRule {
                code,
                name: r.name,
                linter: r.linter.unwrap_or_default(),
                summary: r.summary.unwrap_or_default(),
                preview: r.preview,
            })
        })
        .collect();
    rules.sort_by(|a, b| a.code.cmp(&b.code));
    Ok(rules)
}

/// Where the catalog of Ruff `version` is cached under `dir`.
pub fn rules_cache_file(dir: &Path, version: &str) -> PathBuf {
    let safe: String =
        version.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect();
    dir.join(format!("ruff-rules-{safe}.json"))
}

/// The rule catalog of Ruff `version`: from the cache in `dir`, else from `load` (the output of
/// [`rules_args`]), which is then cached. A cache that doesn't parse is reloaded.
pub fn rules_cached(dir: &Path, version: &str, load: impl FnOnce() -> IdeResult<String>) -> IdeResult<Vec<RuffRule>> {
    let file = rules_cache_file(dir, version);
    if let Ok(cached) = std::fs::read_to_string(&file)
        && let Ok(rules) = serde_json::from_str::<Vec<RuffRule>>(&cached)
    {
        return Ok(rules);
    }
    let rules = parse_rules(&load()?)?;
    if std::fs::create_dir_all(dir).is_ok()
        && let Ok(json) = serde_json::to_string(&rules)
    {
        let tmp = file.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &file);
        }
    }
    Ok(rules)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULES: &str = r#"[
      {"name":"unused-import","code":"F401","linter":"Pyflakes","summary":"`{name}` imported but unused","message_formats":[],"fix":"Fix is sometimes available.","explanation":"…","preview":false},
      {"name":"line-too-long","code":"E501","linter":"pycodestyle","summary":"Line too long ({width} > {limit})","fix":"Fix is not available.","preview":false},
      {"name":"x","code":"","linter":"","summary":""},
      {"name":"pytest-fixture-autouse","code":null,"linter":null,"summary":"Avoid `autouse=True`","preview":true}
    ]"#;

    #[test]
    fn versions_come_from_the_first_word_after_ruff() {
        assert_eq!(parse_version("ruff 0.13.5\n").as_deref(), Some("0.13.5"));
        assert_eq!(parse_version("ruff 0.9.0+dev (abc 2025-01-01)").as_deref(), Some("0.9.0+dev"));
        assert_eq!(parse_version("black 24.1"), None);
        assert_eq!(parse_version("ruff"), None);
    }

    #[test]
    fn fix_arguments_read_stdin_as_the_file_and_honour_exclusions() {
        let args = fix_args(Path::new("/p/src/a.py"), Some(Path::new("/p/ruff.toml")));
        let args: Vec<_> = args.iter().map(|a| a.to_str().unwrap()).collect();
        assert_eq!(
            args,
            [
                "check",
                "--fix-only",
                "--exit-zero",
                "--quiet",
                "--force-exclude",
                "--config",
                "/p/ruff.toml",
                "--stdin-filename",
                "/p/src/a.py",
                "-"
            ]
        );
        assert!(!fix_args(Path::new("a.py"), None).iter().any(|a| a == "--config"));
        let format: Vec<_> =
            format_args(Path::new("a.py"), None).iter().map(|a| a.to_str().unwrap().to_owned()).collect();
        assert_eq!(format, ["format", "--quiet", "--force-exclude", "--stdin-filename", "a.py", "-"]);
    }

    #[test]
    fn the_catalog_is_parsed_sorted_and_cached_per_version() {
        let dir = tempfile::tempdir().unwrap();
        let rules = rules_cached(dir.path(), "0.13.5", || Ok(RULES.to_owned())).unwrap();
        assert_eq!(rules.iter().map(|r| r.code.as_str()).collect::<Vec<_>>(), ["E501", "F401"]);
        assert_eq!(rules[1].name, "unused-import");
        assert!(rules_cache_file(dir.path(), "0.13.5").is_file());
        // A cached catalog is used without running Ruff again.
        let again = rules_cached(dir.path(), "0.13.5", || panic!("not cached")).unwrap();
        assert_eq!(again, rules);
        // Another version loads its own.
        let other = rules_cached(dir.path(), "0.14.0", || Ok("[]".to_owned())).unwrap();
        assert!(other.is_empty());
        assert!(parse_rules("not json").is_err());
    }

    /// `RUFF=/path/to/ruff cargo test -p ide-pyidea -- --ignored`: the installed Ruff's catalog
    /// parses, and its fix and format arguments run.
    #[test]
    #[ignore = "needs Ruff (RUFF or PATH)"]
    fn real_ruff_catalog_fix_and_format() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let ruff = std::env::var("RUFF").unwrap_or_else(|_| "ruff".into());
        let out = Command::new(&ruff).args(rules_args()).output().expect("ruff runs");
        let rules = parse_rules(&String::from_utf8(out.stdout).unwrap()).unwrap();
        assert!(rules.iter().any(|r| r.code == "F401" && r.name == "unused-import"), "{} rules", rules.len());

        let run = |args: Vec<OsString>, input: &str| {
            let mut child =
                Command::new(&ruff).args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().expect("ruff runs");
            child.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
            String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap()
        };
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.py");
        let fixed = run(fix_args(&file, None), "import os\nimport sys\nprint(sys.argv)\n");
        assert!(
            !fixed.contains("import os") && fixed.starts_with("import sys\n") && fixed.ends_with("print(sys.argv)\n"),
            "{fixed:?}"
        );
        assert_eq!(run(format_args(&file, None), "x=1\n"), "x = 1\n");
    }

    #[test]
    fn cache_file_names_are_safe() {
        assert_eq!(rules_cache_file(Path::new("/c"), "0.9/../x"), Path::new("/c/ruff-rules-0.9_.._x.json"));
    }
}
