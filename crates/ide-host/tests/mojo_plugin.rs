//! The fork's Mojo plugin (`plugins/mojo/`) installs through the real plugin host: its
//! language registers for `.mojo` and `.🔥`, and its fire icons survive the SVG sanitiser.

use ide_host::plugins::*;
use ide_plugin::Limits;
use std::path::PathBuf;
use std::sync::Arc;

fn plugin_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../plugins/mojo")
}

#[test]
fn mojo_installs_with_its_language_and_icons() {
    let tmp = tempfile::tempdir().unwrap();
    let sink = |_client: Option<&str>, _event: PluginEvent| {};
    let host = PluginHost::new(tmp.path().join("plugins"), Arc::new(sink), Limits::default()).unwrap();
    host.load_all();
    host.startup_finished();
    let info = host.install_from_dir(&plugin_dir(), &Consent::all()).unwrap();
    assert_eq!(info.status, PluginStatus::Static, "{:?}", info.error);

    let installed = host.info_of("mojo").unwrap().path.0;
    let language = std::fs::read_to_string(installed.join("languages/mojo.toml")).unwrap();
    assert!(language.contains("extensions = [\"mojo\", \"🔥\"]"));
    assert!(installed.join("NOTICE").is_file());

    let icons: Vec<_> = host.ui_items("fileIcons").into_iter().filter(|c| c.plugin_id == "mojo").collect();
    assert_eq!(icons.len(), 1);
    assert_eq!(icons[0].decl["patterns"], serde_json::json!(["*.mojo", "*.🔥"]));
}
