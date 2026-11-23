/**
 * Spark connections (`settings.plugins.spark.connections`, per project; their credentials and
 * Spark configuration live in the OS credential store), the bridge's wire format, SQL
 * statement splitting and CSV export.
 */

export const NAMESPACE = "spark";

export type ConnectionKind = "local" | "connect";

export interface SparkConnection {
  id: string;
  name: string;
  kind: ConnectionKind;
  /** Local: the master URL (`local[*]`, `local[2]`…). */
  master: string;
  /** Spark Connect: the `sc://host:port` endpoint. */
  remote: string;
  /** The interpreter with PySpark installed; blank: the project's. */
  python: string;
  /** The live Spark UI, for monitoring; blank for a local session's own. */
  uiUrl: string;
  historyUrl: string;
}

/** Credentials kept in the OS credential store, per connection. */
export type SecretKind = "token" | "authorization" | "conf";

export const blankConnection = (id: string): SparkConnection => ({
  id,
  name: "",
  kind: "local",
  master: "local[*]",
  remote: "sc://localhost:15002",
  python: "",
  uiUrl: "",
  historyUrl: "",
});

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function readConnections(raw: unknown): SparkConnection[] {
  const list = raw && typeof raw === "object" ? (raw as { connections?: unknown }).connections : undefined;
  if (!Array.isArray(list)) return [];
  const out: SparkConnection[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const id = text(c.id);
    if (!id || out.some((o) => o.id === id)) continue;
    out.push({
      id,
      name: text(c.name) || id,
      kind: c.kind === "connect" ? "connect" : "local",
      master: text(c.master) || "local[*]",
      remote: text(c.remote),
      python: text(c.python),
      uiUrl: text(c.uiUrl),
      historyUrl: text(c.historyUrl),
    });
  }
  return out;
}

export type ConnectionProblem = "name" | "master" | "remote" | "uiUrl" | "historyUrl";

const URL_RE = /^https?:\/\/[^\s/]+/i;

/** What's wrong with a connection, field by field (empty when it can be saved). */
export function connectionProblems(c: SparkConnection, others: SparkConnection[]): ConnectionProblem[] {
  const problems: ConnectionProblem[] = [];
  if (!c.name.trim() || others.some((o) => o.id !== c.id && o.name.trim() === c.name.trim())) problems.push("name");
  if (
    c.kind === "local" &&
    !/^local(\[(\*|\d+)(,\s*\d+)?\])?$|^(spark|k8s|mesos):\/\/\S+$|^yarn$/.test(c.master.trim())
  )
    problems.push("master");
  if (c.kind === "connect" && !/^sc:\/\/[^\s/]+/.test(c.remote.trim())) problems.push("remote");
  if (c.uiUrl.trim() && !URL_RE.test(c.uiUrl.trim())) problems.push("uiUrl");
  if (c.historyUrl.trim() && !URL_RE.test(c.historyUrl.trim())) problems.push("historyUrl");
  return problems;
}

export interface ConfProblem {
  line: number;
}

/** `key=value` lines (blank lines and `#` comments skipped) → Spark configuration. */
export function parseConf(textValue: string): { conf: Record<string, string>; problems: ConfProblem[] } {
  const conf: Record<string, string> = {};
  const problems: ConfProblem[] = [];
  textValue.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const at = line.indexOf("=");
    const key = at > 0 ? line.slice(0, at).trim() : "";
    if (!/^[A-Za-z][\w.-]*$/.test(key)) problems.push({ line: i + 1 });
    else conf[key] = line.slice(at + 1).trim();
  });
  return { conf, problems };
}

/** The bridge's `connect` request for `c`. */
export function connectRequest(c: SparkConnection, secrets: { token: string | null; conf: string | null }) {
  const { conf } = parseConf(secrets.conf ?? "");
  return c.kind === "connect"
    ? { app: `OpenIDEA · ${c.name}`, remote: c.remote.trim(), token: secrets.token || undefined, conf }
    : { app: `OpenIDEA · ${c.name}`, master: c.master.trim(), conf };
}

// ---- the bridge's replies -------------------------------------------------------------------

export interface Column {
  name: string;
  type: string;
}

export interface Rows {
  columns: Column[];
  rows: Array<Array<string | null>>;
  /** More rows exist past the limit. */
  more: boolean;
  omittedColumns: number;
  /** Rows were dropped to keep the message under 8 MiB. */
  truncated?: boolean;
}

export interface CatalogTable {
  name: string;
  database: string | null;
  type: string;
  temporary: boolean;
}

export interface Catalog {
  current: string;
  databases: string[];
  tables: CatalogTable[];
  dataFrames: string[];
}

export type PreviewSource =
  | { kind: "table"; name: string }
  | { kind: "variable"; name: string }
  | { kind: "sql"; text: string }
  | { kind: "last" };

export const DEFAULT_ROWS = 100;
export const MAX_ROWS = 1000;

/** Splits the bridge's stdout into replies (lines starting with U+001E) and the program's output. */
export class ReplyParser {
  private pending = "";

  push(chunk: string): { output: string; messages: Array<Record<string, unknown>> } {
    const lines = (this.pending + chunk).split("\n");
    this.pending = lines.pop() ?? "";
    const messages: Array<Record<string, unknown>> = [];
    let output = "";
    for (const line of lines) {
      if (line.startsWith("\x1e")) {
        try {
          messages.push(JSON.parse(line.slice(1)) as Record<string, unknown>);
        } catch {
          output += `${line.slice(1)}\n`;
        }
      } else output += `${line}\n`;
    }
    // Output without a newline yet shows at once; a reply waits for its line to end.
    if (this.pending && !this.pending.startsWith("\x1e")) {
      output += this.pending;
      this.pending = "";
    }
    return { output, messages };
  }
}

// ---- SQL ------------------------------------------------------------------------------------

export interface Statement {
  from: number;
  to: number;
  text: string;
}

/** The statements of `sql`, split at `;` outside strings, quoted names and comments. */
export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = [];
  let start = 0;
  let i = 0;
  const push = (end: number) => {
    const raw = sql.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (body && !/^(--[^\n]*\n?\s*|\/\*[\s\S]*?\*\/\s*)+$/.test(body))
      out.push({ from: start + lead, to: start + lead + body.length, text: body });
  };
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl + 1;
    } else if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      i++;
      while (i < sql.length && sql[i] !== ch) i += sql[i] === "\\" ? 2 : 1;
      i++;
    } else if (ch === ";") {
      push(i);
      start = ++i;
    } else i++;
  }
  push(sql.length);
  return out;
}

/** The statement at `offset`: the one containing it, else the nearest before it. */
export function statementAt(sql: string, offset: number): Statement | null {
  const all = splitStatements(sql);
  let best: Statement | null = null;
  for (const s of all) {
    if (s.from <= offset) best = s;
    if (offset <= s.to) return s.from <= offset ? s : (best ?? s);
  }
  return best;
}

const LEADING_COMMENTS = /^(\s*(--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/))+/;
const QUERY_RE = /^\s*(\(|select\b|with\b|from\b|table\b|values\b|show\b|describe\b|desc\b)/i;
const CATALOG_CHANGE_RE = /^\s*(create|drop|alter|use|cache|uncache|refresh|msck|truncate)\b/i;

const withoutComments = (sql: string) => sql.replace(LEADING_COMMENTS, "");

/** A statement whose rows can be filtered and sorted by running it again. */
export const isQuery = (sql: string) => QUERY_RE.test(withoutComments(sql));

/** A statement after which the catalog may have changed. */
export const changesCatalog = (sql: string) => CATALOG_CHANGE_RE.test(withoutComments(sql));

/** A result tab's title: the statement on one line, without its leading comments. */
export function queryTitle(sql: string): string {
  const line = withoutComments(sql).replace(/\s+/g, " ").trim();
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

// ---- export ---------------------------------------------------------------------------------

const csvCell = (v: string | null) => (v === null ? "" : /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows: Rows): string {
  const lines = [rows.columns.map((c) => csvCell(c.name)).join(",")];
  for (const r of rows.rows) lines.push(r.map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}
