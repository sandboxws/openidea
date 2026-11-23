/**
 * The Spark tool window's Workspace: the project's connections, the selected one's session
 * (connect, disconnect, its Spark UI) and its catalog — tables and views with their columns,
 * and the console's DataFrames — each previewable in Spark Results.
 */
import { useState } from "react";
import { executeAction } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { openExternalUrl } from "@/platform/openUrl";
import { IconButton, Select, Spinner, T, Toolbar, Tree } from "@/ui";
import { selectConnection } from "../connections";
import { blankConnection, type Column } from "../model";
import { connect, connectionOf, disconnect, loadColumns, preview, refreshCatalog } from "../session";
import { idleSession, useSpark } from "../store";
import styles from "./Spark.module.css";

interface CatalogNode {
  key: string;
  kind: "group" | "table" | "frame" | "column";
  label: string;
  detail?: string;
  icon: string;
  name?: string;
  children?: CatalogNode[];
}

function catalogTree(
  catalog: NonNullable<ReturnType<typeof idleSession>["catalog"]>,
  columns: Record<string, Column[]>,
): CatalogNode[] {
  const columnNodes = (table: string) =>
    columns[table]?.map((c) => ({
      key: `column:${table}.${c.name}`,
      kind: "column" as const,
      label: c.name,
      detail: c.type,
      icon: "db-column",
    }));
  return [
    {
      key: "tables",
      kind: "group",
      label: tx`Tables in ${catalog.current}`,
      icon: "db-schema",
      children: catalog.tables.map((t) => {
        const name = t.database ? `${t.database}.${t.name}` : t.name;
        return {
          key: `table:${name}`,
          kind: "table",
          label: t.name,
          name,
          detail: t.temporary ? tx("temporary view") : t.type.toLowerCase(),
          icon: t.type === "VIEW" || t.temporary ? "db-view" : "db-table",
          children: columnNodes(name),
        };
      }),
    },
    {
      key: "frames",
      kind: "group",
      label: tx("Console DataFrames"),
      icon: "db-console",
      children: catalog.dataFrames.map((name) => ({
        key: `frame:${name}`,
        kind: "frame",
        label: name,
        name,
        icon: "db-matview",
      })),
    },
  ];
}

function findNode(nodes: CatalogNode[], key: string | null): CatalogNode | null {
  if (!key) return null;
  for (const n of nodes) {
    if (n.key === key) return n;
    const found = n.children ? findNode(n.children, key) : null;
    if (found) return found;
  }
  return null;
}

function previewNode(connection: string, node: CatalogNode | null) {
  if (!node?.name) return;
  if (node.kind === "table") void preview(connection, { kind: "table", name: node.name }, node.label);
  else if (node.kind === "frame") void preview(connection, { kind: "variable", name: node.name }, node.label);
}

export function SparkView() {
  const connections = useSpark((s) => s.connections);
  const selected = useSpark((s) => s.selected);
  const session = useSpark((s) => (s.selected && s.sessions[s.selected]) || null) ?? idleSession();
  const connection = connectionOf(selected);
  const live = session.status === "ready" || session.status === "busy";
  const version = session.version ?? "";
  const uiUrl = connection?.uiUrl.trim() || session.ui;
  const endpoint = connection?.kind === "connect" ? connection.remote : (connection?.master ?? "");
  const roots = session.catalog ? catalogTree(session.catalog, session.columns) : [];
  const [leadKey, setLeadKey] = useState<string | null>(null);
  const lead = findNode(roots, leadKey);
  const addConnection = () => useSpark.setState({ editing: blankConnection(crypto.randomUUID()) });
  return (
    <div className={styles.view}>
      <Toolbar className={styles.toolbar} aria-label={tx("Spark")}>
        <Select
          value={selected ?? ""}
          options={connections.map((c) => ({ value: c.id, label: c.name }))}
          placeholder={tx("No connections")}
          aria-label={tx("Connection")}
          disabled={!connections.length}
          onChange={selectConnection}
        />
        <IconButton icon="plus" title={tx("Add Connection")} onClick={addConnection} />
        <IconButton
          icon="edit"
          title={tx("Edit Connection")}
          disabled={!connection}
          onClick={() => connection && useSpark.setState({ editing: connection })}
        />
        <span className={styles.separator} />
        {live || session.status === "starting" ? (
          <IconButton
            icon="db-disconnect"
            title={tx("Disconnect")}
            disabled={!selected}
            onClick={() => selected && disconnect(selected)}
          />
        ) : (
          <IconButton
            icon="run"
            title={tx("Connect")}
            disabled={!selected}
            onClick={() => selected && void connect(selected)}
          />
        )}
        <IconButton
          icon="refresh"
          title={tx("Refresh Catalog")}
          disabled={!live}
          onClick={() => selected && void refreshCatalog(selected)}
        />
        <IconButton
          icon="query"
          title={tx("New Spark SQL File")}
          onClick={() => void executeAction("spark.newSqlFile")}
        />
        <IconButton
          icon="db-console"
          title={tx("Open Spark Console")}
          onClick={() => void executeAction("spark.openConsole")}
        />
      </Toolbar>
      {connection && (
        <div className={styles.status}>
          {session.status === "starting" && <Spinner size={12} />}
          <span>
            {session.status === "starting"
              ? tx("Connecting…")
              : live
                ? tx`Spark ${version} · ${endpoint}`
                : session.status === "failed"
                  ? tx("Couldn't connect")
                  : tx("Not connected")}
          </span>
          {live && uiUrl && (
            <button type="button" className={styles.linkButton} onClick={() => void openExternalUrl(uiUrl)}>
              <T>Spark UI</T>
            </button>
          )}
        </div>
      )}
      {session.status === "failed" && session.error && <div className={styles.error}>{session.error}</div>}
      <div className={styles.body}>
        {!connections.length ? (
          <div className={styles.empty}>
            <p>
              <T>
                Add a connection to a local Spark or a Spark Connect server. PySpark must be installed in its
                interpreter.
              </T>
            </p>
            <button type="button" className={styles.linkButton} onClick={addConnection}>
              <T>Add Connection…</T>
            </button>
          </div>
        ) : !live ? (
          <div className={styles.empty}>
            <T>Connect to browse the catalog.</T>
          </div>
        ) : (
          <Tree<CatalogNode>
            roots={roots}
            getKey={(n) => n.key}
            getLabel={(n) => n.label}
            getChildren={(n) => n.children}
            isExpandable={(n) => n.kind === "group" || n.kind === "table"}
            loadChildren={async (n) => {
              if (n.kind === "table" && n.name && selected) await loadColumns(selected, n.name);
            }}
            getIcon={(n) => n.icon}
            getDetail={(n) => n.detail}
            defaultExpanded={["tables", "frames"]}
            selected={leadKey ? new Set([leadKey]) : new Set()}
            onSelectionChange={(_sel, node) => setLeadKey(node?.key ?? null)}
            onActivate={(node) => selected && previewNode(selected, node)}
            activateExpandable={(n) => n.kind === "table"}
            empty={
              <div className={styles.empty}>
                <T>The catalog is empty.</T>
              </div>
            }
          />
        )}
      </div>
      {live && (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => selected && previewNode(selected, lead)}
            title={tx("Preview the selected table or DataFrame (or double-click it)")}
          >
            <T>Preview</T>
          </button>
          {session.status === "busy" && <Spinner size={12} />}
        </div>
      )}
    </div>
  );
}
