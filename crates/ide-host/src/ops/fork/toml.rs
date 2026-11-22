//! PyIdea's TOML Workbench in the editor: bundled schemas for taplo, PyPI version completion
//! and the locked / installed version of each `pyproject.toml` requirement.

use crate::Host;
use ide_command::command;
use ide_core::{CancellationToken, DocId, IdeError, IdeResult, RequestId};
use ide_pyidea::toml::PythonVersionHint;
use ide_pyidea::toml::lock::{locked_versions, normalize, uv_lock};
use ide_pyidea::toml::pep440::newest_first;
use ide_pyidea::toml::pypi::pypi_versions;
use ide_pyidea::toml::schemas::{TomlSchemas, install};
use ide_sdk::python::PythonPackage;
use ide_workspace::dependencies::{DependencyVersionSource, DependencyVersions, python};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant, SystemTime};

/// The bundled schemas, written to the data directory, and the document patterns taplo
/// associates them with.
#[command(trust = always)]
pub async fn pyidea_toml_schemas(host: &Host) -> IdeResult<TomlSchemas> {
    let data_dir = host.local_data_dir.clone();
    tokio::task::spawn_blocking(move || install(&data_dir, &|p: &Path| ide_lsp::path_to_uri_string(p)))
        .await
        .map_err(|e| IdeError::internal(e.to_string()))?
}

/// PyPI's simple index (PEP 691 JSON with PEP 700's version list).
struct PyPi;

impl DependencyVersionSource for PyPi {
    fn id(&self) -> &'static str {
        "pypi"
    }

    fn cache_key(&self, package: &str) -> Option<String> {
        let name = normalize(package);
        (!name.is_empty() && name.len() <= 100 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
            .then(|| format!("pypi-{name}"))
    }

    fn fetch(&self, package: &str, cancel: &CancellationToken) -> IdeResult<Vec<String>> {
        let search_path = std::env::var_os("PATH").unwrap_or_default();
        let text = ide_tools::Http::new(&search_path)?
            .https_only()
            .accept("application/vnd.pypi.simple.v1+json")
            .get_text_limited(
                &format!("https://pypi.org/simple/{}/", normalize(package)),
                Some(32 * 1024 * 1024),
                cancel,
            )?;
        let mut versions = pypi_versions(&text).ok_or_else(|| IdeError::internal("unreadable PyPI index"))?;
        newest_first(&mut versions);
        Ok(versions)
    }
}

/// PyPI versions for the `pyproject.toml` requirement at `offset` (completion inside its string).
#[command(trust = trusted)]
pub async fn pyidea_toml_versions(
    host: &Host,
    window: &str,
    doc: DocId,
    offset: u32,
    request: RequestId,
) -> IdeResult<Vec<DependencyVersions>> {
    let project = host.project(window)?;
    let cache = host.dependency_versions.clone();
    let cancel = host.begin_project_read_request(window, request);
    let result = host
        .blocking(move || {
            let snap = project.documents.snapshot(doc)?;
            if snap.large || snap.path.file_name().is_none_or(|n| n != "pyproject.toml") {
                return Ok(Vec::new());
            }
            let Some(dependency) = python::requirements("pyproject.toml", &snap.text)
                .into_iter()
                .find(|d| d.from <= offset && offset <= d.to)
            else {
                return Ok(Vec::new());
            };
            let versions = cache.versions(&PyPi, &dependency.package, &cancel)?;
            Ok(vec![DependencyVersions { dependency, versions, update: None }])
        })
        .await;
    host.end_request(request);
    result
}

/// Installed packages by interpreter, with what they were listed at: the site-packages
/// directory's modification time, which an install or removal changes.
type Installed = (Option<SystemTime>, Instant, Vec<PythonPackage>);
static INSTALLED: LazyLock<Mutex<HashMap<PathBuf, Installed>>> = LazyLock::new(Default::default);

fn site_packages_stamp(python: &Path) -> Option<SystemTime> {
    let prefix = python.parent()?.parent()?;
    let mut candidates = vec![prefix.join("Lib").join("site-packages")];
    if let Ok(entries) = std::fs::read_dir(prefix.join("lib")) {
        candidates.extend(entries.flatten().map(|e| e.path().join("site-packages")));
    }
    candidates.into_iter().filter_map(|dir| dir.metadata().and_then(|m| m.modified()).ok()).max()
}

fn installed_packages(python: &Path, cancel: &CancellationToken) -> IdeResult<Vec<PythonPackage>> {
    let stamp = site_packages_stamp(python);
    if let Some((cached, listed, packages)) = INSTALLED.lock().get(python)
        && *cached == stamp
        && (stamp.is_some() || listed.elapsed() < Duration::from_secs(60))
    {
        return Ok(packages.clone());
    }
    let packages = ide_sdk::python::list_packages(python, cancel)?;
    INSTALLED.lock().insert(python.to_path_buf(), (stamp, Instant::now(), packages.clone()));
    Ok(packages)
}

/// The locked (`uv.lock`) and installed (project interpreter) version of each requirement of
/// a `pyproject.toml`; empty for other files.
#[command(trust = trusted)]
pub async fn pyidea_toml_hints(
    host: &Host,
    window: &str,
    doc: DocId,
    request: RequestId,
) -> IdeResult<Vec<PythonVersionHint>> {
    let project = host.project(window)?;
    let config_dir = host.config_dir.clone();
    let cancel = host.begin_project_read_request(window, request);
    let result = host
        .blocking(move || {
            let snap = project.documents.snapshot(doc)?;
            if snap.large || snap.path.file_name().is_none_or(|n| n != "pyproject.toml") {
                return Ok(Vec::new());
            }
            let requirements = python::requirements("pyproject.toml", &snap.text);
            if requirements.is_empty() {
                return Ok(Vec::new());
            }
            let dir = snap.path.parent().unwrap_or(&project.root).to_path_buf();
            let locked = uv_lock(&dir, &project.root)
                .and_then(|p| std::fs::read_to_string(p).ok())
                .map(|text| locked_versions(&text))
                .unwrap_or_default();
            // Listing packages runs the interpreter, which runs project code (.pth files).
            let installed: HashMap<String, String> = match project.require_trust() {
                Ok(()) => crate::ops::sdk::effective_python(&config_dir, &project, Some(&dir))
                    .and_then(|python| installed_packages(&python, &cancel).ok())
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| (normalize(&p.name), p.version))
                    .collect(),
                Err(_) => HashMap::new(),
            };
            if cancel.is_cancelled() {
                return Err(IdeError::cancelled());
            }
            Ok(requirements
                .into_iter()
                .map(|r| {
                    let name = normalize(&r.package);
                    PythonVersionHint {
                        locked: locked.get(&name).cloned().unwrap_or_default(),
                        installed: installed.get(&name).cloned(),
                        package: r.package,
                        from: r.from,
                        to: r.to,
                    }
                })
                .collect())
        })
        .await;
    host.end_request(request);
    result
}

ide_command::domain!(fork_toml: pyidea_toml_schemas, pyidea_toml_versions, pyidea_toml_hints);
