//! The Mojo SDK (PyIdea's Mojo support): where it is, its tools and environment, and the
//! command lines of the compiler, the language server and the LLDB debug adapter.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MojoToolchain {
    /// The environment holding `bin/mojo` (a venv, a pixi or conda environment).
    pub root: PathBuf,
    pub compiler: PathBuf,
    pub language_server: PathBuf,
    /// LLDB's DAP adapter of the SDK (it matches the SDK's LLDB plugin).
    pub adapter: PathBuf,
    pub debugger_plugin: Option<PathBuf>,
    pub visualizers: Option<PathBuf>,
    /// A conda-style install's `share/max`: `MODULAR_HOME`.
    pub modular_home: Option<PathBuf>,
}

fn bin(root: &Path, name: &str) -> PathBuf {
    root.join("bin").join(name)
}

impl MojoToolchain {
    /// The SDK installed in `root`, when it has `bin/mojo`.
    pub fn from_root(root: &Path) -> Option<Self> {
        if !bin(root, "mojo").is_file() {
            return None;
        }
        let config = root.join("share").join("max").join("modular.cfg");
        if config.is_file() {
            return Some(Self::from_config(root, &config));
        }
        // A pip install keeps the LLDB plugin and visualizers in the `modular` package.
        let modular = std::fs::read_dir(root.join("lib"))
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("python")))
            .map(|p| p.join("site-packages").join("modular").join("lib"))
            .find(|p| p.is_dir());
        let adapter = modular
            .as_ref()
            .and_then(|lib| lib.parent())
            .map(|m| m.join("bin").join("lldb-dap"))
            .filter(|p| p.is_file())
            .unwrap_or_else(|| bin(root, "lldb-dap"));
        Some(Self {
            root: root.to_path_buf(),
            compiler: bin(root, "mojo"),
            language_server: bin(root, "mojo-lsp-server"),
            adapter,
            debugger_plugin: modular.as_ref().map(|lib| lib.join("libMojoLLDB.dylib")).filter(|p| p.is_file()),
            visualizers: modular.as_ref().map(|lib| lib.join("lldb-visualizers")).filter(|p| p.is_dir()),
            modular_home: None,
        })
    }

    /// A conda-style install: tool paths from `share/max/modular.cfg`'s `[mojo-max]` section.
    fn from_config(root: &Path, config: &Path) -> Self {
        let mut section = String::new();
        let mut values = BTreeMap::new();
        for line in std::fs::read_to_string(config).unwrap_or_default().lines() {
            let text = line.trim();
            if let Some(name) = text.strip_prefix('[').and_then(|t| t.strip_suffix(']')) {
                section = name.to_owned();
            } else if section == "mojo-max"
                && !text.starts_with(['#', ';'])
                && let Some((key, value)) = text.split_once('=')
            {
                values.insert(key.trim().to_owned(), value.trim().trim_matches('"').to_owned());
            }
        }
        let path =
            |key: &str, fallback: &str| values.get(key).map(|v| root.join(v)).unwrap_or_else(|| root.join(fallback));
        Self {
            root: root.to_path_buf(),
            compiler: path("driver_path", "bin/mojo"),
            language_server: path("lsp_server_path", "bin/mojo-lsp-server"),
            adapter: path("lldb_vscode_path", "bin/lldb-dap"),
            debugger_plugin: values.get("lldb_plugin_path").map(|v| root.join(v)),
            visualizers: values.get("lldb_visualizers_path").map(|v| root.join(v)),
            modular_home: config.parent().map(Path::to_path_buf),
        }
    }

    /// What every SDK tool runs with: its `bin` first on `PATH`, telemetry off, the LLDB plugin.
    pub fn environment(&self, path: Option<&str>) -> BTreeMap<String, String> {
        let bin = self.root.join("bin").to_string_lossy().into_owned();
        let separator = if cfg!(windows) { ";" } else { ":" };
        let mut env = BTreeMap::from([
            (
                "PATH".to_owned(),
                match path.filter(|p| !p.is_empty()) {
                    Some(rest) => format!("{bin}{separator}{rest}"),
                    None => bin,
                },
            ),
            ("VIRTUAL_ENV".to_owned(), self.root.to_string_lossy().into_owned()),
            ("MODULAR_TELEMETRY_ENABLED".to_owned(), "false".to_owned()),
        ]);
        if let Some(plugin) = &self.debugger_plugin {
            env.insert("MODULAR_MOJO_MAX_LLDB_PLUGIN_PATH".into(), plugin.to_string_lossy().into_owned());
        }
        if let Some(visualizers) = &self.visualizers {
            env.insert("MODULAR_MOJO_MAX_LLDB_VISUALIZERS_PATH".into(), visualizers.to_string_lossy().into_owned());
        }
        if let Some(home) = &self.modular_home {
            env.insert("MODULAR_HOME".into(), home.to_string_lossy().into_owned());
            env.insert("CONDA_PREFIX".into(), self.root.to_string_lossy().into_owned());
        }
        env
    }

    /// Tools the SDK lacks (`debug`: with the debugger's).
    pub fn missing(&self, debug: bool) -> Vec<String> {
        let name = |p: &Path| p.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_owned();
        let mut missing: Vec<String> =
            [&self.compiler, &self.language_server].into_iter().filter(|p| !p.is_file()).map(|p| name(p)).collect();
        if debug {
            if !self.adapter.is_file() {
                missing.push(name(&self.adapter));
            }
            if !self.debugger_plugin.as_deref().is_some_and(Path::is_file) {
                missing.push("libMojoLLDB".into());
            }
        }
        missing
    }
}

/// The SDK to use: `explicit` (a directory holding `bin/mojo`, relative to the project) when
/// set, else the project's `.venv`, its `.pixi/envs/default`, then the interpreter's environment.
/// An explicit directory without the SDK is an error rather than a reason to look elsewhere.
pub fn discover(
    explicit: &str,
    project_root: &Path,
    interpreter: Option<&Path>,
) -> Result<Option<MojoToolchain>, String> {
    let explicit = explicit.trim();
    if !explicit.is_empty() {
        let root = project_root.join(explicit);
        return MojoToolchain::from_root(&root).map(Some).ok_or_else(|| {
            format!("{} has no bin/mojo: choose the environment the Mojo SDK is installed in", root.display())
        });
    }
    let mut candidates = vec![project_root.join(".venv"), project_root.join(".pixi").join("envs").join("default")];
    candidates.extend(interpreter.and_then(Path::parent).and_then(Path::parent).map(Path::to_path_buf));
    Ok(candidates.iter().find_map(|root| MojoToolchain::from_root(root)))
}

/// Compiler arguments the IDE manages itself (the output, the source, fix-its).
pub fn managed_argument(compiler_args: &[String]) -> Option<&str> {
    compiler_args.iter().map(String::as_str).find(|a| {
        *a == "-o"
            || a.starts_with("-o=")
            || *a == "--emit"
            || a.starts_with("--emit=")
            || *a == "--"
            || *a == "--experimental-fixit"
            || a.starts_with("--experimental-export-fixit")
            || (!a.starts_with('-') && (a.ends_with(".mojo") || a.ends_with(".🔥")))
    })
}

fn includes(paths: &[PathBuf]) -> Vec<String> {
    paths.iter().flat_map(|p| ["-I".to_owned(), p.to_string_lossy().into_owned()]).collect()
}

/// `mojo build`: debug builds are unoptimized with debug info.
pub fn build_args(
    import_paths: &[PathBuf],
    compiler_args: &[String],
    source: &Path,
    output: &Path,
    debug: bool,
) -> Vec<String> {
    let mut args = vec!["build".to_owned()];
    args.extend(includes(import_paths));
    args.extend(compiler_args.iter().cloned());
    if debug {
        args.extend(["-O0".to_owned(), "-g".to_owned()]);
    }
    args.extend([source.to_string_lossy().into_owned(), "-o".to_owned(), output.to_string_lossy().into_owned()]);
    args
}

pub fn language_server_args(import_paths: &[PathBuf]) -> Vec<String> {
    includes(import_paths)
}

/// POSIX shell quoting.
pub fn shell_quote(s: &str) -> String {
    if !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"/._-+=:,@%".contains(&b)) {
        return s.to_owned();
    }
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// `env K=V … program args…` as one shell command line.
pub fn shell_line(env: &BTreeMap<String, String>, program: &Path, args: &[String]) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !env.is_empty() {
        parts.push("env".into());
        parts.extend(env.iter().map(|(k, v)| shell_quote(&format!("{k}={v}"))));
    }
    parts.push(shell_quote(&program.to_string_lossy()));
    parts.extend(args.iter().map(|a| shell_quote(a)));
    parts.join(" ")
}

/// A launcher for the SDK's `lldb-dap` that loads the Mojo LLDB plugin and the SDK's data
/// formatters before LLDB starts, and (macOS) uses Xcode's `debugserver`, which has the
/// permission to attach to the program.
pub fn adapter_script(toolchain: &MojoToolchain, debugserver: Option<&Path>) -> String {
    let mut lines = vec![
        "#!/bin/sh".to_owned(),
        "# The OpenIDEA fork's Mojo debug adapter (FORK.md): the Mojo SDK's lldb-dap with its LLDB plugin.".to_owned(),
    ];
    for (key, value) in toolchain.environment(None) {
        if key != "PATH" {
            lines.push(format!("export {key}={}", shell_quote(&value)));
        }
    }
    if let Some(server) = debugserver {
        lines.push(format!(
            "[ -n \"$LLDB_DEBUGSERVER_PATH\" ] || export LLDB_DEBUGSERVER_PATH={}",
            shell_quote(&server.to_string_lossy())
        ));
    }
    let mut command = vec!["exec".to_owned(), shell_quote(&toolchain.adapter.to_string_lossy())];
    if let Some(plugin) = &toolchain.debugger_plugin {
        command
            .extend(["--pre-init-command".to_owned(), shell_quote(&format!("plugin load \"{}\"", plugin.display()))]);
    }
    if let Some(dir) = &toolchain.visualizers {
        for name in ["lldbDataFormatters.py", "mlirDataFormatters.py"] {
            let script = dir.join(name);
            if script.is_file() {
                command.extend([
                    "--pre-init-command".to_owned(),
                    shell_quote(&format!("?command script import \"{}\"", script.display())),
                ]);
            }
        }
    }
    command.push("\"$@\"".to_owned());
    lines.push(command.join(" "));
    lines.join("\n") + "\n"
}

/// 0-based lines declaring `main` (`def main(` / `fn main(` at the top level).
pub fn main_lines(text: &str) -> Vec<u32> {
    text.lines()
        .enumerate()
        .filter(|(_, l)| {
            let l = l.trim_end();
            (l.starts_with("def main(") || l.starts_with("fn main(")) && !l.starts_with(' ')
        })
        .map(|(i, _)| i as u32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sdk(root: &Path, pip: bool) {
        std::fs::create_dir_all(root.join("bin")).unwrap();
        for tool in ["mojo", "mojo-lsp-server", "lldb-dap"] {
            std::fs::write(root.join("bin").join(tool), "").unwrap();
        }
        if pip {
            let lib = root.join("lib/python3.13/site-packages/modular/lib");
            std::fs::create_dir_all(lib.join("lldb-visualizers")).unwrap();
            std::fs::write(lib.join("libMojoLLDB.dylib"), "").unwrap();
            std::fs::write(lib.join("lldb-visualizers/lldbDataFormatters.py"), "").unwrap();
            std::fs::create_dir_all(root.join("lib/python3.13/site-packages/modular/bin")).unwrap();
            std::fs::write(root.join("lib/python3.13/site-packages/modular/bin/lldb-dap"), "").unwrap();
        }
    }

    #[test]
    fn finds_the_sdk_in_project_order() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(discover("", root, None).unwrap(), None);
        sdk(&root.join(".pixi/envs/default"), false);
        assert_eq!(discover("", root, None).unwrap().unwrap().root, root.join(".pixi/envs/default"));
        sdk(&root.join(".venv"), true);
        let found = discover("", root, None).unwrap().unwrap();
        assert_eq!(found.root, root.join(".venv"));
        assert!(found.debugger_plugin.is_some() && found.visualizers.is_some());
        assert!(found.adapter.ends_with("modular/bin/lldb-dap"));
        assert!(found.missing(true).is_empty());
        let err = discover("nowhere", root, None).unwrap_err();
        assert!(err.contains("has no bin/mojo"), "{err}");
        assert_eq!(discover(".pixi/envs/default", root, None).unwrap().unwrap().root, root.join(".pixi/envs/default"));
    }

    #[test]
    fn reads_a_conda_style_config() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        sdk(root, false);
        std::fs::create_dir_all(root.join("share/max")).unwrap();
        std::fs::write(
            root.join("share/max/modular.cfg"),
            "[other]\ndriver_path = x\n[mojo-max]\n# comment\nlsp_server_path = \"bin/mojo-lsp-server\"\nlldb_plugin_path = lib/libMojoLLDB.dylib\n",
        )
        .unwrap();
        let sdk = MojoToolchain::from_root(root).unwrap();
        assert_eq!(sdk.compiler, root.join("bin/mojo"));
        assert_eq!(sdk.debugger_plugin, Some(root.join("lib/libMojoLLDB.dylib")));
        assert_eq!(sdk.environment(Some("/usr/bin"))["MODULAR_HOME"], root.join("share/max").to_string_lossy());
        assert!(sdk.environment(Some("/usr/bin"))["PATH"].ends_with(":/usr/bin"));
    }

    #[test]
    fn builds_command_lines() {
        let includes = [PathBuf::from("/p/src")];
        let args = build_args(&includes, &["--warn".into()], Path::new("/p/a.mojo"), Path::new("/p/out/a"), true);
        assert_eq!(args, ["build", "-I", "/p/src", "--warn", "-O0", "-g", "/p/a.mojo", "-o", "/p/out/a"]);
        assert_eq!(managed_argument(&["-o".into()]), Some("-o"));
        assert_eq!(managed_argument(&["other.mojo".into()]), Some("other.mojo"));
        assert_eq!(managed_argument(&["-D".into(), "X=1".into()]), None);
        let env = BTreeMap::from([("A".to_owned(), "b c".to_owned())]);
        assert_eq!(
            shell_line(&env, Path::new("/s d/mojo"), &["build".into(), "it's".into()]),
            "env 'A=b c' '/s d/mojo' build 'it'\\''s'"
        );
    }

    #[test]
    fn writes_an_adapter_launcher() {
        let dir = tempfile::tempdir().unwrap();
        sdk(dir.path(), true);
        let sdk = MojoToolchain::from_root(dir.path()).unwrap();
        let script = adapter_script(&sdk, Some(Path::new("/Xcode/debugserver")));
        assert!(script.starts_with("#!/bin/sh\n"));
        assert!(script.contains("--pre-init-command 'plugin load \""), "{script}");
        assert!(script.contains("?command script import"), "{script}");
        assert!(script.contains("LLDB_DEBUGSERVER_PATH=/Xcode/debugserver"));
        assert!(script.trim_end().ends_with("\"$@\""));
    }

    #[test]
    fn finds_main() {
        assert_eq!(
            main_lines("def greet():\n    pass\n\ndef main():\n    greet()\n    def main(x): pass\nfn main():\n"),
            [3, 6]
        );
    }
}
