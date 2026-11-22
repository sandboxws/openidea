/**
 * The Project Dependencies tool window: the declared groups (runtime, extras, dependency groups,
 * uv's dev dependencies, build requirements) with each requirement's locked and installed
 * version, the transitive packages of the lock, and the staged changes with their preview.
 */
import { useEffect, useMemo } from "react";
import { tx } from "@/platform/i18n";
import { IconButton, Spinner, SplitGroup, SplitHandle, SplitPanel, T, Toolbar, Tree } from "@/ui";
import { applyAndSync, openDependencies, previewChanges, refresh, stage } from "../controller";
import { useDeps } from "../store";
import { buildTree, findNode, type DepsNode } from "../tree";
import { DepsDialogs } from "./Dialogs";
import { SidePanel } from "./SidePanel";
import styles from "./Deps.module.css";

export function DependenciesView() {
  const s = useDeps();
  useEffect(() => {
    if (!s.path) void openDependencies();
  }, [s.path]);
  const roots = useMemo(() => (s.model ? buildTree(s.model) : []), [s.model]);
  const selected = findNode(roots, s.selected);
  const requirement = selected?.kind === "requirement" && !selected.requirement?.staged ? selected : null;
  const editable = requirement && requirement.group?.kind !== "build" ? requirement : null;
  const busy = s.previewing || s.syncing;

  return (
    <div className={styles.view}>
      <Toolbar className={styles.toolbar} aria-label={tx("Project Dependencies")}>
        <IconButton
          icon="plus"
          title={tx("Add Package")}
          disabled={!s.model}
          onClick={() => useDeps.setState({ dialog: { kind: "add" } })}
        />
        <IconButton
          icon="edit"
          title={tx("Edit Requirement")}
          disabled={!requirement}
          onClick={() =>
            requirement?.group &&
            useDeps.setState({
              dialog: { kind: "edit", group: requirement.group, requirement: requirement.requirement!.text },
            })
          }
        />
        <IconButton
          icon="minus"
          title={tx("Remove")}
          disabled={!requirement}
          onClick={() =>
            requirement?.group &&
            stage({ op: "remove", group: requirement.group, requirement: requirement.requirement!.text })
          }
        />
        <IconButton
          icon="arrow-right"
          title={tx("Move to Group")}
          disabled={!editable}
          onClick={() =>
            editable?.group &&
            useDeps.setState({
              dialog: { kind: "move", group: editable.group, requirement: editable.requirement!.text },
            })
          }
        />
        <IconButton
          icon="arrow-up"
          title={tx("Stage Upgrade")}
          disabled={!selected?.package?.locked.length || selected.requirement?.staged}
          onClick={() => selected?.package && stage({ op: "upgrade", package: selected.package.name })}
        />
        <span className={styles.separator} />
        <IconButton
          icon="filter"
          title={tx("Select Groups and Extras")}
          disabled={!s.model}
          onClick={() => useDeps.setState({ dialog: { kind: "groups" } })}
        />
        <IconButton icon="refresh" title={tx("Refresh")} disabled={s.loading} onClick={() => void refresh()} />
        <span className={styles.grow} />
        <IconButton
          icon="eye"
          title={tx("Preview Changes")}
          disabled={!s.model || busy}
          onClick={() => void previewChanges()}
        />
        <IconButton
          icon="download"
          title={tx("Apply and Sync")}
          disabled={!s.preview || s.stale || busy}
          onClick={() => void applyAndSync()}
        />
      </Toolbar>

      {s.model && <Status />}
      {s.error && <p className={styles.error}>{s.error}</p>}
      {s.model?.editError && (
        <p className={styles.error}>{tx`The staged changes no longer apply: ${s.model.editError}`}</p>
      )}

      <SplitGroup orientation="horizontal" id="python-deps-split" storageKey="openidea.pythonDeps.split">
        <SplitPanel id="tree" minSize="30%" className={styles.panel}>
          {!s.model && s.loading ? (
            <div className={styles.empty}>
              <Spinner /> <T>Loading dependencies…</T>
            </div>
          ) : (
            <Tree<DepsNode>
              roots={roots}
              getKey={(n) => n.key}
              getLabel={(n) => n.label}
              getChildren={(n) => n.children}
              isExpandable={(n) => n.kind === "group" || n.kind === "transitive"}
              getIcon={(n) => n.icon}
              getDetail={(n) => n.detail}
              defaultExpanded={new Set(roots.filter((r) => r.kind === "group").map((r) => r.key))}
              selected={s.selected ? new Set([s.selected]) : new Set()}
              onSelectionChange={(_sel, lead) => useDeps.setState({ selected: lead?.key ?? null, tab: "details" })}
              empty={
                <div className={styles.empty}>
                  <T>No pyproject.toml dependencies to show.</T>
                </div>
              }
            />
          )}
        </SplitPanel>
        <SplitHandle />
        <SplitPanel id="side" minSize="30%" className={styles.panel}>
          <SidePanel node={selected} />
        </SplitPanel>
      </SplitGroup>
      <DepsDialogs />
    </div>
  );
}

function Status() {
  const model = useDeps((s) => s.model)!;
  const root = String(model.path).replace(/\/pyproject\.toml$/, "");
  const relative = (p: string) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p);
  const environment = model.environment ? relative(String(model.environment)) : null;
  const lock = model.lock ? String(model.lock) : null;
  return (
    <>
      <div className={styles.status}>
        <span>{model.projectName ?? relative(String(model.path))}</span>
        <span>{environment ? tx`Environment: ${environment}` : tx("No virtual environment")}</span>
        <span>{lock ? relative(lock) : tx("No uv.lock yet")}</span>
      </div>
      {!model.uv && (
        <div className={styles.warning}>
          <T>uv was not found. Install uv to preview and apply changes.</T>
        </div>
      )}
    </>
  );
}
