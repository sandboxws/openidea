/**
 * The Python Tests tool window: the collected tests by directory, file, class and function
 * with pytest parameter cases, a toolbar to run, debug, rerun and watch them, and the selected
 * test's result. Double-click or Enter runs a group; on a single test it opens the source, as
 * F4 does anywhere.
 */
import { useEffect, useMemo, useRef } from "react";
import { revealRange } from "@/editor/api";
import { tx } from "@/platform/i18n";
import type { PythonTestFramework } from "@/platform/ipc";
import {
  IconButton,
  Select,
  Spinner,
  SplitGroup,
  SplitHandle,
  SplitPanel,
  T,
  Toolbar,
  Tree,
  type TreeHandle,
} from "@/ui";
import { useOccurrenceNavigator } from "@/workbench/contributions";
import { buildTree, filterTree, groupStatus, type TestNode, type TestStatus } from "../model";
import { collect, failedIds, idsInFiles, runTests, stopRun } from "../runner";
import { setPrefs, usePythonTests } from "../store";
import { Details } from "./Details";
import { TOOL_WINDOW } from "./toolWindow";
import styles from "./PythonTests.module.css";

const FRAMEWORKS: Array<{ value: PythonTestFramework; label: string }> = [
  { value: "pytest", label: "pytest" },
  { value: "unittest", label: "unittest" },
  { value: "doctest", label: "doctest" },
];

const ICON: Record<TestStatus, string> = {
  passed: "test-passed",
  failed: "test-failed",
  skipped: "test-ignored",
  running: "test-pending",
  queued: "test-pending",
  stale: "test-pending",
  idle: "test-ignored",
};

function nodeStatus(node: TestNode, status: Record<string, TestStatus>): TestStatus {
  return node.id && node.ids.length === 1
    ? (status[node.id] ?? "idle")
    : groupStatus(node.ids.map((id) => status[id] ?? "idle"));
}

function reveal(node: TestNode) {
  if (node.file) void revealRange(node.file, { start: { line: node.line ?? 0, col: 0 } }, { focus: true });
}

export function PythonTestsView() {
  const s = usePythonTests();
  const tree = useRef<TreeHandle>(null);

  useEffect(() => {
    if (s.root && s.fresh && !s.collecting) void collect();
  }, [s.root, s.fresh, s.collecting]);

  const roots = useMemo(() => buildTree(s.tests, s.root ?? ""), [s.tests, s.root]);
  const shown = useMemo(
    () => (s.failuresOnly ? filterTree(roots, (id) => s.status[id] === "failed") : roots),
    [roots, s.failuresOnly, s.status],
  );
  const byKey = useMemo(() => {
    const map = new Map<string, TestNode>();
    const walk = (nodes: readonly TestNode[]) => nodes.forEach((n) => (map.set(n.key, n), walk(n.children)));
    walk(roots);
    return map;
  }, [roots]);
  const selected = s.selected ? byKey.get(s.selected) : undefined;
  const selectedResult = selected?.id ? s.results[selected.id] : undefined;
  const running = !!s.run;

  useOccurrenceNavigator(TOOL_WINDOW, (dir) => tree.current?.selectOccurrence(dir) ?? null);

  // Reveal the tests related to the active editor.
  useEffect(() => {
    const file = s.related[0];
    if (!file) return;
    const node = [...byKey.values()].find((n) => n.kind === "file" && n.file === file);
    if (node) tree.current?.reveal(node.key);
  }, [s.related, byKey]);

  const counts = useMemo(() => {
    const c = { passed: 0, failed: 0, skipped: 0 };
    for (const t of s.tests) {
      const st = s.status[t.id];
      if (st === "passed") c.passed++;
      else if (st === "failed") c.failed++;
      else if (st === "skipped") c.skipped++;
    }
    return c;
  }, [s.tests, s.status]);

  const selectedIds = selected?.ids ?? [];
  const selectedFile = selected?.file;

  return (
    <div className={styles.view}>
      <Toolbar className={styles.toolbar} aria-label={tx("Python Tests")}>
        <IconButton
          icon="run"
          title={tx("Run Selected Tests")}
          disabled={running || !selectedIds.length}
          onClick={() => void runTests(selectedIds)}
        />
        <IconButton
          icon="debug"
          title={tx("Debug Selected Tests")}
          disabled={running || !selectedIds.length}
          onClick={() => void runTests(selectedIds, { debug: true })}
        />
        <IconButton
          icon="gutter-run"
          title={tx("Run Tests in File")}
          disabled={running || !selectedFile}
          onClick={() => selectedFile && void runTests(idsInFiles([selectedFile]))}
        />
        <IconButton
          icon="rerun-filled"
          title={tx("Run Related Tests")}
          disabled={running || !s.related.length}
          onClick={() => void runTests(idsInFiles(s.related))}
        />
        <IconButton
          icon="gutter-run-all"
          title={tx("Run All Tests")}
          disabled={running || !s.tests.length}
          onClick={() => void runTests([])}
        />
        <IconButton
          icon="rerun"
          title={tx("Rerun Failed Tests")}
          disabled={running || !counts.failed}
          onClick={() => void runTests(failedIds())}
        />
        <span className={styles.separator} />
        <IconButton
          icon="refresh"
          title={tx("Refresh Tests")}
          disabled={running || s.collecting}
          onClick={() => void collect()}
        />
        <IconButton icon="stop" title={tx("Stop")} tone="danger" disabled={!running} onClick={() => void stopRun()} />
        <span className={styles.separator} />
        <IconButton
          icon="filter"
          title={tx("Show Failed Tests Only")}
          pressed={s.failuresOnly}
          onClick={() => setPrefs({ failuresOnly: !s.failuresOnly })}
        />
        <IconButton
          icon="eye"
          title={tx("Watch Related Tests")}
          pressed={s.watch}
          onClick={() => setPrefs({ watch: !s.watch })}
        />
        <span className={styles.grow} />
        <Select
          value={s.framework}
          options={FRAMEWORKS}
          onChange={(framework) => {
            setPrefs({ framework });
            void collect();
          }}
          aria-label={tx("Test framework")}
        />
      </Toolbar>

      {s.collectError && <p className={styles.error}>{s.collectError}</p>}
      {s.errors.length > 0 && (
        <details className={styles.errors}>
          <summary>{tx`Collection errors: ${s.errors.length}`}</summary>
          {s.errors.map((e, i) => (
            <pre key={i}>{e}</pre>
          ))}
        </details>
      )}

      <SplitGroup orientation="vertical" id="python-tests-split" storageKey="openidea.pythonTests.split">
        <SplitPanel id="tests" minSize="25%" className={styles.panel}>
          {s.collecting && !s.tests.length ? (
            <div className={styles.empty}>
              <Spinner /> <T>Collecting tests…</T>
            </div>
          ) : (
            <Tree<TestNode>
              handleRef={tree}
              roots={shown}
              getKey={(n) => n.key}
              getLabel={(n) => n.label}
              getChildren={(n) => n.children}
              isExpandable={(n) => n.children.length > 0}
              getIcon={(n) => ICON[nodeStatus(n, s.status)]}
              getDetail={(n) => {
                const r = n.id ? s.results[n.id] : undefined;
                if (r?.duration != null && n.ids.length === 1) return `${Math.round(r.duration * 1000)} ms`;
                return n.ids.length > 1 ? String(n.ids.length) : undefined;
              }}
              defaultExpanded={new Set(roots.flatMap((r) => [r.key, ...r.children.map((c) => c.key)]))}
              selected={s.selected ? new Set([s.selected]) : new Set()}
              onSelectionChange={(_sel, lead) => usePythonTests.setState({ selected: lead?.key ?? null })}
              activateExpandable
              onActivate={(n) => (n.children.length ? void runTests(n.ids) : reveal(n))}
              onJumpToSource={(n) => reveal(n)}
              isOccurrence={(n) => !!n.id && n.ids.length === 1 && s.status[n.id] === "failed"}
              empty={
                <div className={styles.empty}>
                  {s.fresh ? (
                    <T>Collecting tests…</T>
                  ) : (
                    <T>No tests found. Check the framework and the project's interpreter.</T>
                  )}
                </div>
              }
            />
          )}
        </SplitPanel>
        {selected?.id && selectedResult && (
          <>
            <SplitHandle />
            <SplitPanel id="details" minSize="20%" className={styles.panel}>
              <Details key={selected.id} result={selectedResult} root={s.root} name={selected.label} />
            </SplitPanel>
          </>
        )}
      </SplitGroup>

      <div className={styles.summary}>
        {running ? (
          <>
            <Spinner /> <T>Running tests…</T>
          </>
        ) : s.noRelated ? (
          <T>No related tests found</T>
        ) : (
          <span>{tx`${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped of ${s.tests.length}`}</span>
        )}
      </div>
    </div>
  );
}
