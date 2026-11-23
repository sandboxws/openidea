/**
 * Spark Results: the selected connection's console (Python in the shared session) and a tab per
 * query, Explain or preview. Rows are a bounded sample read once; scrolling reads nothing more.
 * Filter, sort and row limit run the query (or preview) again; Count runs a count job.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { save } from "@/platform/dialog";
import { tx } from "@/platform/i18n";
import { call, commands } from "@/platform/ipc";
import { useConsoleFont } from "@/platform/consoleFont";
import { IconButton, Input, Select, Spinner, T, Tabs } from "@/ui";
import { spanStyle } from "@/ui/ansi";
import { notifications } from "@/workbench/contributions";
import { MAX_ROWS, toCsv, type Rows } from "../model";
import {
  cancelResult,
  cancelSession,
  canTransform,
  clearConsole,
  connectionOf,
  countRows,
  message,
  requery,
  runPython,
} from "../session";
import { closeResult, CONSOLE_TAB, idleSession, useSpark, type SparkResult } from "../store";
import styles from "./Spark.module.css";

const ROW_H = 22;
const COL_W = 140;
const INDEX_W = 56;
const LIMITS = [100, 500, MAX_ROWS].map((n) => ({ value: String(n), label: String(n) }));

export function ResultsView() {
  const results = useSpark((s) => s.results);
  const tab = useSpark((s) => s.tab);
  const result = results.find((r) => r.id === tab) ?? null;
  return (
    <div className={styles.view}>
      <Tabs
        variant="compact"
        items={[
          { id: CONSOLE_TAB, label: tx("Console"), icon: "db-console" },
          ...results.map((r) => ({
            id: r.id,
            label: r.title,
            text: r.title,
            icon: r.kind === "plan" ? "db-plan" : "db-table",
            closable: true,
          })),
        ]}
        activeId={result ? result.id : CONSOLE_TAB}
        onSelect={(id) => useSpark.setState({ tab: id })}
        onClose={closeResult}
      />
      {result ? <ResultPane key={result.id} result={result} /> : <ConsolePane />}
    </div>
  );
}

// ---- console --------------------------------------------------------------------------------

function ConsolePane() {
  const selected = useSpark((s) => s.selected);
  const session = useSpark((s) => (s.selected && s.sessions[s.selected]) || null) ?? idleSession();
  const font = useConsoleFont();
  const connection = connectionOf(selected);
  const fontStyle: CSSProperties = { fontFamily: font.family, fontSize: font.size, lineHeight: `${font.rowHeight}px` };
  if (!connection)
    return (
      <div className={styles.empty}>
        <T>Add a Spark connection in the Spark tool window to use its console.</T>
      </div>
    );
  return (
    <div className={styles.console}>
      <div className={styles.toolbar}>
        <IconButton
          icon="stop"
          size="small"
          title={tx("Cancel the Running Spark Job")}
          disabled={session.status !== "busy"}
          onClick={() => cancelSession(connection.id)}
        />
        <IconButton icon="trash" size="small" title={tx("Clear")} onClick={() => clearConsole(connection.id)} />
        <span className={styles.muted}>{connection.name}</span>
        {session.status === "busy" && <Spinner size={12} />}
      </div>
      <ConsoleOutput spans={session.console} style={fontStyle} />
      <ConsoleInput connection={connection.id} style={fontStyle} />
    </div>
  );
}

function ConsoleOutput({ spans, style }: { spans: ReturnType<typeof idleSession>["console"]; style: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [spans]);
  return (
    <div
      ref={ref}
      className={styles.output}
      style={style}
      role="log"
      aria-label={tx("Spark console output")}
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
      }}
    >
      {spans.map((s, i) => (
        <span key={i} style={spanStyle(s)}>
          {s.text}
        </span>
      ))}
    </div>
  );
}

const history: string[] = [];

/** Enter runs the input in the session; Shift+Enter adds a line; ↑/↓ recall. */
function ConsoleInput({ connection, style }: { connection: string; style: CSSProperties }) {
  const [text, setText] = useState("");
  const browse = useRef<number | null>(null);
  return (
    <textarea
      className={styles.input}
      style={style}
      rows={Math.min(8, text.split("\n").length)}
      value={text}
      spellCheck={false}
      aria-label={tx("Spark console input")}
      placeholder={tx("Python with spark: Enter runs, Shift+Enter adds a line")}
      onChange={(e) => {
        browse.current = null;
        setText(e.target.value);
      }}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          if (!text.trim()) return;
          if (history[history.length - 1] !== text) history.push(text);
          browse.current = null;
          setText("");
          void runPython(connection, text);
          return;
        }
        const up = e.key === "ArrowUp" && !el.value.slice(0, el.selectionStart).includes("\n");
        const down = e.key === "ArrowDown" && !el.value.slice(el.selectionEnd).includes("\n");
        if ((!up && !down) || !history.length) return;
        e.preventDefault();
        const next = Math.max(0, Math.min(history.length, (browse.current ?? history.length) + (up ? -1 : 1)));
        browse.current = next;
        setText(history[next] ?? "");
      }}
    />
  );
}

// ---- results --------------------------------------------------------------------------------

async function exportCsv(result: SparkResult) {
  if (!result.rows) return;
  const path = await save({ defaultPath: `${result.title.replace(/[^\w.-]+/g, "_").slice(0, 40) || "spark"}.csv` });
  if (!path) return;
  try {
    await call(commands.dbExportFile(path, toCsv(result.rows)));
  } catch (e) {
    notifications().notify({ group: "spark", level: "error", title: tx("Couldn't export the rows"), body: message(e) });
  }
}

function summary(result: SparkResult, rows: Rows): string {
  const parts = [rows.more ? tx`first ${rows.rows.length} rows` : tx`${rows.rows.length} rows`];
  if (rows.omittedColumns) parts.push(tx`${rows.omittedColumns} more columns not shown`);
  if (rows.truncated) parts.push(tx("rows dropped to fit 8 MiB"));
  if (result.count !== null) parts.push(tx`${result.count} rows in all`);
  if (result.took !== null) parts.push(`${(result.took / 1000).toFixed(1)} s`);
  return parts.join(" · ");
}

function ResultPane({ result }: { result: SparkResult }) {
  const [filter, setFilter] = useState(result.filter);
  const transform = canTransform(result);
  return (
    <div className={styles.result}>
      <div className={styles.toolbar}>
        {result.kind === "rows" && (
          <>
            <Input
              mono
              className={styles.filter}
              value={filter}
              disabled={!transform}
              placeholder={
                transform ? tx("Filter: a SQL condition, Enter applies") : tx("Only a query's rows can be filtered")
              }
              aria-label={tx("Filter")}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void requery(result.id, { filter: filter.trim() })}
            />
            <Select
              value={String(result.limit)}
              options={LIMITS}
              disabled={!transform}
              aria-label={tx("Rows")}
              onChange={(v) => void requery(result.id, { limit: Number(v) })}
            />
            <IconButton
              icon="db-sort"
              size="small"
              title={tx("Count Rows")}
              disabled={!transform || result.running}
              onClick={() => void countRows(result.id)}
            />
            <IconButton
              icon="export"
              size="small"
              title={tx("Export Shown Rows as CSV")}
              disabled={!result.rows?.rows.length}
              onClick={() => void exportCsv(result)}
            />
          </>
        )}
        <IconButton
          icon="stop"
          size="small"
          title={tx("Cancel")}
          disabled={!result.running}
          onClick={() => cancelResult(result.id)}
        />
        {result.running && <Spinner size={12} />}
        <span className={styles.muted}>{result.rows && !result.running ? summary(result, result.rows) : ""}</span>
      </div>
      {result.sql && <div className={styles.query}>{result.sql}</div>}
      {result.error && <div className={styles.error}>{result.error}</div>}
      {result.kind === "plan" ? (
        result.plan !== null && <pre className={styles.plan}>{result.plan}</pre>
      ) : result.rows && result.rows.columns.length ? (
        <Grid result={result} rows={result.rows} sortable={transform && !result.running} />
      ) : (
        result.rows &&
        !result.error && (
          <div className={styles.empty}>
            <T>The statement ran; it returns no rows.</T>
          </div>
        )
      )}
    </div>
  );
}

function Grid({ result, rows, sortable }: { result: SparkResult; rows: Rows; sortable: boolean }) {
  const [view, setView] = useState({ top: 0, height: 480 });
  const first = Math.max(0, Math.floor(view.top / ROW_H) - 4);
  const last = Math.min(rows.rows.length, Math.ceil((view.top + view.height) / ROW_H) + 4);
  const width = INDEX_W + rows.columns.length * COL_W;
  const sortBy = (column: string) => {
    const sort = result.sort;
    const next =
      sort?.column !== column ? { column, descending: false } : sort.descending ? null : { column, descending: true };
    void requery(result.id, { sort: next });
  };
  return (
    <div
      className={styles.grid}
      role="grid"
      aria-label={tx("Rows")}
      aria-rowcount={rows.rows.length + 1}
      aria-colcount={rows.columns.length + 1}
      onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      ref={(el) => {
        if (!el) return;
        const observer = new ResizeObserver(() => setView({ top: el.scrollTop, height: el.clientHeight }));
        observer.observe(el);
        return () => observer.disconnect();
      }}
    >
      <div className={styles.gridHeader} role="row" aria-rowindex={1} style={{ width }}>
        <span className={styles.indexCell} role="columnheader" style={{ width: INDEX_W }} />
        {rows.columns.map((c) => {
          const sorted =
            result.sort?.column === c.name ? (result.sort.descending ? "descending" : "ascending") : "none";
          return (
            <span
              key={c.name}
              role="columnheader"
              aria-sort={sorted}
              className={styles.headerCell}
              style={{ width: COL_W }}
            >
              <button
                type="button"
                className={styles.headerButton}
                disabled={!sortable}
                title={tx`${c.name}: ${c.type}`}
                onClick={() => sortBy(c.name)}
              >
                <span className={styles.columnName}>{c.name}</span>
                <span className={styles.columnType}>
                  {c.type}
                  {sorted === "ascending" ? " ▲" : sorted === "descending" ? " ▼" : ""}
                </span>
              </button>
            </span>
          );
        })}
      </div>
      <div style={{ height: rows.rows.length * ROW_H, width, position: "relative" }}>
        {rows.rows.slice(first, last).map((row, i) => {
          const index = first + i;
          return (
            <div
              key={index}
              role="row"
              aria-rowindex={index + 2}
              className={styles.gridRow}
              style={{ top: index * ROW_H, height: ROW_H, width }}
            >
              <span className={styles.indexCell} role="rowheader" style={{ width: INDEX_W }}>
                {index + 1}
              </span>
              {row.map((value, j) => (
                <span
                  key={j}
                  role="gridcell"
                  className={value === null ? `${styles.cell} ${styles.null}` : styles.cell}
                  style={{ width: COL_W }}
                  title={value ?? "null"}
                >
                  {value ?? "null"}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
