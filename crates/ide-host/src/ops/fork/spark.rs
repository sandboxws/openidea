//! PyIdea's Spark workspace: the session process's helper and the connections' credentials
//! (Spark Connect tokens) in the OS credential store.

use crate::Host;
use ide_command::command;
use ide_core::{IdeError, IdeResult, IpcPath};
use ide_db::secrets::SecretStore;
use ide_pyidea::tests::helpers;

/// Where the session process's helper (`openidea_spark_bridge.py`) is installed.
#[command(trust = trusted)]
pub async fn pyidea_spark_helpers(host: &Host) -> IdeResult<IpcPath> {
    let data_dir = host.local_data_dir.clone();
    tokio::task::spawn_blocking(move || helpers::install(&data_dir).map(Into::into))
        .await
        .map_err(|e| IdeError::internal(e.to_string()))?
}

fn store(host: &Host, window: &str) -> IdeResult<SecretStore> {
    let project = host.project(window)?;
    Ok(SecretStore::new(host.config_dir.join("pyidea-spark-secrets.json"), &project.root))
}

fn key(connection: &str, kind: &str) -> IdeResult<String> {
    if !matches!(kind, "token" | "authorization" | "conf") || connection.is_empty() {
        return Err(IdeError::invalid("unknown Spark credential"));
    }
    Ok(format!("{connection}#{kind}"))
}

/// A connection's saved credential, if any: `token` (the Connect token), `authorization` (the
/// monitoring Authorization header) or `conf` (its Spark configuration, which can hold keys).
#[command(trust = trusted)]
pub async fn pyidea_spark_secret(
    host: &Host,
    window: &str,
    connection: String,
    kind: String,
) -> IdeResult<Option<String>> {
    let key = key(&connection, &kind)?;
    let store = store(host, window)?;
    tokio::task::spawn_blocking(move || store.get(&key)).await.map_err(|e| IdeError::internal(e.to_string()))
}

/// Saves (or with none, forgets) a connection's credential.
#[command(trust = trusted)]
pub async fn pyidea_spark_set_secret(
    host: &Host,
    window: &str,
    connection: String,
    kind: String,
    value: Option<String>,
) -> IdeResult<()> {
    let key = key(&connection, &kind)?;
    let store = store(host, window)?;
    tokio::task::spawn_blocking(move || match value.filter(|v| !v.is_empty()) {
        Some(secret) => store.set(&key, &secret),
        None => {
            store.delete(&key);
            Ok(())
        }
    })
    .await
    .map_err(|e| IdeError::internal(e.to_string()))?
}

ide_command::domain!(fork_spark: pyidea_spark_helpers, pyidea_spark_secret, pyidea_spark_set_secret);
