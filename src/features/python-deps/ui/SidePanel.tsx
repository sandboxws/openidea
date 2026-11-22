import { Fragment } from "react";
import { activeEditor } from "@/editor/api";
import { tx } from "@/platform/i18n";
import { Button, IconButton, Spinner, T, Tabs } from "@/ui";
import { editorService } from "@/workbench/contributions";
import {
  cancelPreview,
  discardEdits,
  previewChanges,
  retrySync,
  applyAndSync,
  unstage,
  viewFileDiffs,
} from "../controller";
import { changeKind, editLabel, formatGroups, groupLabel } from "../model";
import { useDeps } from "../store";
import { versionText, type DepsNode } from "../tree";
import styles from "./Deps.module.css";

/** Selects a requirement's string in the editor. */
async function openDeclaration(path: string, from: number, to: number) {
  await editorService().openFile(path);
  const editor = activeEditor();
  if (editor?.ctx.path !== path) return;
  editor.view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  editor.view.focus();
}

export function SidePanel({ node }: { node: DepsNode | null }) {
  const tab = useDeps((s) => s.tab);
  const edits = useDeps((s) => s.edits.length);
  return (
    <div className={styles.side}>
      <Tabs
        activeId={tab}
        onSelect={(t) => useDeps.setState({ tab: t as "details" | "changes" })}
        items={[
          { id: "details", label: tx("Details") },
          { id: "changes", label: edits ? tx`Changes (${edits})` : tx("Changes") },
        ]}
      />
      <div className={styles.sideBody}>{tab === "details" ? <Details node={node} /> : <Changes />}</div>
    </div>
  );
}

function Details({ node }: { node: DepsNode | null }) {
  const path = useDeps((s) => s.path);
  if (!node || node.kind === "group" || node.kind === "transitive")
    return (
      <p className={styles.empty}>
        <T>Select a requirement or package to see its versions and why it is installed.</T>
      </p>
    );
  const r = node.requirement;
  const p = node.package;
  return (
    <>
      <dl className={styles.facts}>
        <dt>
          <T>Package</T>
        </dt>
        <dd>{p?.name ?? r?.package ?? node.label}</dd>
        {r && (
          <>
            <dt>
              <T>Requirement</T>
            </dt>
            <dd>{r.text}</dd>
          </>
        )}
        {node.group && (
          <>
            <dt>
              <T>Declared in</T>
            </dt>
            <dd>{groupLabel(node.group)}</dd>
          </>
        )}
        <dt>
          <T>Versions</T>
        </dt>
        <dd>{versionText(p) ?? tx("Not locked or installed")}</dd>
      </dl>
      {p && p.why.length > 1 && (
        <>
          <div className={styles.section}>
            <T>Why installed?</T>
          </div>
          <div className={styles.chain} aria-label={tx("Dependency path")}>
            {p.why.map((name, i) => (
              <Fragment key={`${i}:${name}`}>
                {i > 0 && <span aria-hidden="true">→</span>}
                <span>{name}</span>
              </Fragment>
            ))}
          </div>
        </>
      )}
      {r?.from != null && r.to != null && path && (
        <div className={styles.actions}>
          <Button onClick={() => void openDeclaration(path, r.from!, r.to!)}>Open Declaration</Button>
        </div>
      )}
    </>
  );
}

function Changes() {
  const s = useDeps();
  const extras = s.selection.allExtras ? tx("all") : s.selection.extras.join(", ") || tx("none");
  const groups = formatGroups(s.selection.groups) || tx("uv defaults");
  return (
    <>
      {s.edits.length ? (
        <ul className={styles.list}>
          {s.edits.map((e, i) => (
            <li key={`${i}:${editLabel(e)}`}>
              <IconButton icon="undo" title={tx("Unstage")} onClick={() => unstage(i)} />
              <span>{editLabel(e)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>
          <T>No staged changes. A preview still shows what a sync would change in the environment.</T>
        </p>
      )}
      <p className={styles.status}>
        {tx`Extras: ${extras}`} · {tx`Groups: ${groups}`}
        {s.selection.inexact && <> · {tx("keeps packages the lock doesn't list")}</>}
      </p>
      <div className={styles.actions}>
        {s.previewing ? (
          <>
            <Spinner /> <T>Resolving in a copy of the project…</T>
            <Button onClick={() => cancelPreview()}>Cancel</Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => void previewChanges()}>
            Preview Changes
          </Button>
        )}
        <Button disabled={!s.edits.length || s.previewing} onClick={() => discardEdits()}>
          Discard All
        </Button>
        <Button disabled={s.syncing || s.previewing} onClick={() => void retrySync()}>
          Retry Sync
        </Button>
      </div>
      {s.previewError && <p className={styles.error}>{s.previewError}</p>}
      {s.syncing && (
        <p>
          <Spinner /> <T>Synchronizing the environment…</T>
        </p>
      )}
      {s.synced === "failed" && (
        <p className={styles.warning}>
          <T>The sync did not finish. Use Retry Sync after fixing the problem shown in the Run tool window.</T>
        </p>
      )}
      {s.preview && <PreviewResult />}
    </>
  );
}

function PreviewResult() {
  const preview = useDeps((s) => s.preview)!;
  const stale = useDeps((s) => s.stale);
  const syncing = useDeps((s) => s.syncing);
  return (
    <>
      {stale && (
        <p className={styles.warning}>
          <T>Files, staged changes or the selection changed since this preview. Preview again before applying.</T>
        </p>
      )}
      <div className={styles.section}>
        <T>Lock changes</T>
      </div>
      {preview.lockChanges.length ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>
                <T>Package</T>
              </th>
              <th>
                <T>Before</T>
              </th>
              <th>
                <T>After</T>
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.lockChanges.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.before.join(" | ") || "—"}</td>
                <td>{c.after.join(" | ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.empty}>
          <T>The lock doesn't change.</T>
        </p>
      )}
      <div className={styles.section}>
        <T>Environment changes</T>
      </div>
      {preview.environmentChanges.length ? (
        <table className={styles.table}>
          <tbody>
            {preview.environmentChanges.map((c) => {
              const kind = changeKind(c);
              return (
                <tr key={c.name}>
                  <td className={styles[kind]}>{CHANGE_LABEL[kind]()}</td>
                  <td>{c.name}</td>
                  <td>{c.before ?? "—"}</td>
                  <td>{c.after ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className={styles.empty}>
          <T>The environment is already in sync.</T>
        </p>
      )}
      <div className={styles.actions}>
        <Button onClick={() => viewFileDiffs()}>View File Diffs</Button>
        <Button variant="primary" disabled={stale || syncing} onClick={() => void applyAndSync()}>
          Apply and Sync
        </Button>
      </div>
      <details className={styles.output}>
        <summary>
          <T>uv output</T>
        </summary>
        <pre>{preview.output}</pre>
      </details>
    </>
  );
}

const CHANGE_LABEL = {
  install: () => tx("install"),
  remove: () => tx("remove"),
  upgrade: () => tx("upgrade"),
  downgrade: () => tx("downgrade"),
  reinstall: () => tx("reinstall"),
} as const;
