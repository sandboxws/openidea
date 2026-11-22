/**
 * A test's result: the Failure tab (message, parameter values, the source around the failure
 * with its original line numbers and the reported line marked), the Compare tab (expected and
 * actual values, and the diff viewer) and the Output tab (traceback and captured output).
 */
import { useState } from "react";
import { revealRange } from "@/editor/api";
import { previewColors } from "@/editor/lineTokens";
import { executeAction } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import type { PythonTestResult } from "@/platform/ipc";
import { Button, IconButton, SourcePreview, T, Tabs, copyText } from "@/ui";
import { runTests } from "../runner";
import { Output } from "./Output";
import styles from "./PythonTests.module.css";

type Tab = "failure" | "compare" | "output";

/** The snapshot as a document whose line numbers are the file's: blank lines before it. */
export function snapshotText(result: PythonTestResult): { text: string; line: number } | null {
  const s = result.snapshot;
  if (!s) return null;
  return { text: "\n".repeat(Math.max(0, s.start - 1)) + s.lines.join("\n"), line: s.line - 1 };
}

export function outputText(result: PythonTestResult): string {
  const parts: string[] = [];
  if (result.longrepr) parts.push(result.longrepr);
  for (const [label, text] of [
    ["Captured stdout", result.stdout],
    ["Captured stderr", result.stderr],
    ["Captured log", result.log],
  ] as const)
    if (text) parts.push(`--- ${label} ---\n${text}`);
  return parts.join("\n\n");
}

export function Details({ result, root, name }: { result: PythonTestResult; root: string | null; name: string }) {
  const comparable = result.expected != null && result.actual != null;
  const failed = result.outcome === "failed" || result.outcome === "error" || result.outcome === "xpassed";
  const [tab, setTab] = useState<Tab>(failed ? "failure" : "output");
  const snapshot = snapshotText(result);
  const items = [
    { id: "failure", label: tx("Failure") },
    ...(comparable ? [{ id: "compare", label: tx("Compare") }] : []),
    { id: "output", label: tx("Output") },
  ];
  const active: Tab = tab === "compare" && !comparable ? "failure" : tab;
  const location = result.location;

  return (
    <div className={styles.details}>
      <div className={styles.detailsBar}>
        <Tabs items={items} activeId={active} onSelect={(id) => setTab(id as Tab)} />
        <div className={styles.detailsActions}>
          {location && (
            <IconButton
              icon="edit-source"
              size="small"
              title={tx("Open Source")}
              onClick={() =>
                void revealRange(location.file, { start: { line: location.line - 1, col: 0 } }, { focus: true })
              }
            />
          )}
          <IconButton icon="rerun" size="small" title={tx("Rerun")} onClick={() => void runTests([result.id])} />
          <IconButton
            icon="debug"
            size="small"
            title={tx("Debug")}
            onClick={() => void runTests([result.id], { debug: true })}
          />
          <IconButton
            icon="copy"
            size="small"
            title={tx("Copy")}
            onClick={() => void copyText(outputText(result) || result.message || "")}
          />
        </div>
      </div>
      <div className={styles.detailsBody}>
        {active === "failure" && (
          <div className={styles.failure}>
            <p className={styles.message}>{result.message ?? (failed ? "" : tx(outcomeText(result.outcome)))}</p>
            {result.params && (
              <table className={styles.params} aria-label={tx("Parameter values")}>
                <tbody>
                  {Object.entries(result.params).map(([key, value]) => (
                    <tr key={key}>
                      <th>{key}</th>
                      <td>
                        <code>{value}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {snapshot && result.snapshot && (
              <SourcePreview
                className={styles.snapshot}
                path={result.snapshot.file}
                line={snapshot.line}
                highlights={[
                  {
                    line: snapshot.line,
                    ranges: [[0, result.snapshot.lines[snapshot.line - (result.snapshot.start - 1)]?.length ?? 0]],
                  },
                ]}
                load={() => Promise.resolve(snapshot.text)}
                version={result.snapshot.start * 100_000 + result.snapshot.line}
                colorize={previewColors}
              />
            )}
          </div>
        )}
        {active === "compare" && comparable && (
          <div className={styles.compare}>
            <div className={styles.compareSide}>
              <h4>
                <T>Expected</T>
              </h4>
              <pre>{result.expected}</pre>
            </div>
            <div className={styles.compareSide}>
              <h4>
                <T>Actual</T>
              </h4>
              <pre>{result.actual}</pre>
            </div>
            <div className={styles.compareActions}>
              <Button
                size="small"
                onClick={() =>
                  void executeAction("diff.compareTexts", {
                    path: `${name}.txt`,
                    title: tx`Comparison of ${name}`,
                    left: { text: result.expected ?? "", label: tx("Expected") },
                    right: { text: result.actual ?? "", label: tx("Actual") },
                  })
                }
              >
                Show Diff
              </Button>
            </div>
          </div>
        )}
        {active === "output" && <Output text={outputText(result) || result.message || ""} root={root} />}
      </div>
    </div>
  );
}

function outcomeText(outcome: PythonTestResult["outcome"]): string {
  switch (outcome) {
    case "passed":
      return "Passed";
    case "skipped":
      return "Skipped";
    case "xfailed":
      return "Expected failure";
    default:
      return "Failed";
  }
}
