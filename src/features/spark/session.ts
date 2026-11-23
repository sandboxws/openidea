/**
 * Spark sessions: one bridge process per connection (`openidea_spark_bridge.py` on the
 * connection's interpreter, hidden from the Run tool window like the Python Console's), its
 * requests and replies, and what the workspace does with them: connect, catalog, SQL, Explain,
 * previews, counts, the Python console, Cancel.
 */
import { Channel } from "@tauri-apps/api/core";
import { windowLabel } from "@/platform/auxWindow";
import { tx } from "@/platform/i18n";
import { call, commands, onIdeEvent, type OutputChunk, type RunConfig, type RunId } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { AnsiStream, appendSpans, type Span } from "@/ui/ansi";
import {
  changesCatalog,
  connectRequest,
  DEFAULT_ROWS,
  isQuery,
  queryTitle,
  ReplyParser,
  type Catalog,
  type Column,
  type PreviewSource,
  type Rows,
  type SecretKind,
} from "./model";
import {
  addResult,
  idleSession,
  patchResult,
  patchSession,
  resultOf,
  sessionOf,
  useSpark,
  type SortSpec,
  type SparkResult,
} from "./store";

const PREFIX = `spark:${windowLabel()}:`;
const MAX_CONSOLE = 500_000;

type Reply = Record<string, unknown>;

class Bridge {
  runId: RunId | null = null;
  private seq = 1;
  private readonly pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
  private readonly parser = new ReplyParser();
  private readonly out = new AnsiStream();
  private readonly err = new AnsiStream();
  private markReady: () => void = () => {};
  private failReady: (e: Error) => void = () => {};
  readonly ready: Promise<void>;
  /** Requests in flight other than Cancel. */
  inFlight = 0;

  constructor(readonly connection: string) {
    this.ready = new Promise((resolve, reject) => {
      this.markReady = resolve;
      this.failReady = reject;
    });
    this.ready.catch(() => {});
  }

  async start(python: string, helpers: string, cwd: string | null) {
    const channel = new Channel<OutputChunk>();
    channel.onmessage = (chunk) => {
      if (chunk.kind === "stdout") {
        const { output, messages } = this.parser.push(chunk.text);
        if (output) appendConsole(this.connection, this.out.parse(output));
        messages.forEach((m) => this.onMessage(m));
      } else if (chunk.kind === "stderr") {
        // The JVM logs here; the program's errors come back in replies.
        appendConsole(
          this.connection,
          this.err.parse(chunk.text).map((s) => ({ ...s, dim: true })),
        );
      }
    };
    const config: RunConfig = {
      id: `${PREFIX}${this.connection}:${crypto.randomUUID()}`,
      name: "Spark",
      kind: "python",
      command: python,
      args: ["-u", "-B", `${helpers}/openidea_spark_bridge.py`],
      cwd,
      // gRPC (Spark Connect) logs each retry at info level otherwise.
      env: { GRPC_VERBOSITY: "ERROR" },
      detected: true,
      isTest: false,
      debugAdapter: null,
      emulateTerminal: false,
    };
    const info = await call(commands.runStart(config, channel, null));
    this.runId = info.id;
  }

  private onMessage(m: Reply) {
    if (m.event === "ready") {
      this.markReady();
      return;
    }
    const id = typeof m.id === "number" ? m.id : null;
    const waiter = id === null ? undefined : this.pending.get(id);
    if (!waiter) return;
    this.pending.delete(id!);
    if (m.ok) waiter.resolve(m);
    else waiter.reject(new Error(typeof m.error === "string" ? m.error : tx("The Spark request failed")));
  }

  private write(message: Reply) {
    if (this.runId === null) return Promise.reject(new Error(tx("The Spark session isn't running")));
    return call(commands.runStdin(this.runId, `${JSON.stringify(message)}\n`));
  }

  /** Sends `op`; the id is known at once (for Cancel), the reply later. */
  request(op: string, payload: Reply = {}): { id: number; reply: Promise<Reply> } {
    const id = this.seq++;
    this.inFlight++;
    sessionBusy(this.connection);
    const reply = new Promise<Reply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ ...payload, id, op }).catch((e: unknown) => {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    }).finally(() => {
      this.inFlight--;
      sessionBusy(this.connection);
    });
    return { id, reply };
  }

  ask(op: string, payload: Reply = {}) {
    return this.request(op, payload).reply;
  }

  /** Cancels request `target`, or whatever runs now. */
  cancel(target: number | null) {
    void this.write({ id: this.seq++, op: "cancel", target }).catch(() => {});
  }

  exited(code: number | null) {
    this.runId = null;
    const error = new Error(tx`The Spark session ended (exit code ${String(code ?? "?")})`);
    this.failReady(error);
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  close() {
    const id = this.runId;
    if (id === null) return;
    void this.write({ id: this.seq++, op: "close" }).catch(() => {});
    // Spark stops on its own; a session that doesn't is stopped.
    setTimeout(() => {
      if (this.runId === id) void call(commands.runStop(id)).catch(() => {});
    }, 8000);
  }
}

const bridges = new Map<string, Bridge>();
/** Exits that arrived before their start call returned. */
const earlyExits = new Map<RunId, number | null>();

function sessionBusy(connection: string) {
  const bridge = bridges.get(connection);
  const status = sessionOf(connection).status;
  if (!bridge || (status !== "ready" && status !== "busy")) return;
  patchSession(connection, { status: bridge.inFlight > 0 ? "busy" : "ready" });
}

function trimConsole(spans: Span[]): Span[] {
  let total = 0;
  let i = spans.length;
  while (i > 0 && total + spans[i - 1]!.text.length <= MAX_CONSOLE) total += spans[--i]!.text.length;
  return i === 0 ? spans : spans.slice(i);
}

export function appendConsole(connection: string, spans: Span[]) {
  if (!spans.length) return;
  patchSession(connection, { console: trimConsole(appendSpans(sessionOf(connection).console, spans)) });
}

const note = (connection: string, text: string) => appendConsole(connection, [{ text: `${text}\n`, dim: true }]);

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const connectionOf = (id: string | null) => useSpark.getState().connections.find((c) => c.id === id) ?? null;

async function secret(connection: string, kind: SecretKind): Promise<string | null> {
  return call(commands.pyideaSparkSecret(connection, kind));
}

function resolvePath(root: string | null, path: string) {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || !root) return path;
  return `${root.replace(/\/+$/, "")}/${path}`;
}

export const isConnected = (id: string | null) => {
  const status = sessionOf(id).status;
  return status === "ready" || status === "busy";
};

export async function connect(id: string): Promise<boolean> {
  const c = connectionOf(id);
  if (!c) return false;
  const status = sessionOf(id).status;
  if (status === "ready" || status === "busy") return true;
  if (status === "starting") return false;
  patchSession(id, { ...idleSession(), console: sessionOf(id).console, status: "starting" });
  note(id, tx`Connecting to ${c.name}…`);
  const root = useProject.getState().project?.root ?? null;
  let bridge: Bridge | null = null;
  try {
    const python = c.python.trim()
      ? resolvePath(root, c.python.trim())
      : await call(commands.sdkPythonEffective(null)).then((p) => (p ? String(p) : null));
    if (!python) throw new Error(tx("Select a Python interpreter for the project or for this connection"));
    const [helpers, token, conf] = await Promise.all([
      call(commands.pyideaSparkHelpers()).then(String),
      c.kind === "connect" ? secret(id, "token") : Promise.resolve(null),
      secret(id, "conf"),
    ]);
    bridge = new Bridge(id);
    bridges.set(id, bridge);
    await bridge.start(python, helpers, root);
    if (bridge.runId !== null && earlyExits.has(bridge.runId)) bridge.exited(earlyExits.get(bridge.runId)!);
    earlyExits.clear();
    await bridge.ready;
    const info = await bridge.ask("connect", connectRequest(c, { token, conf }));
    const version = String(info.version ?? "");
    patchSession(id, {
      status: "ready",
      version,
      connect: Boolean(info.connect),
      ui: typeof info.ui === "string" ? info.ui : null,
    });
    note(id, tx`Connected: Spark ${version}`);
    void refreshCatalog(id);
    return true;
  } catch (e) {
    const error = message(e);
    patchSession(id, { status: "failed", error });
    appendConsole(id, [{ text: `${error}\n`, fg: "var(--ansi-red)" }]);
    if (bridge && bridges.get(id) === bridge) {
      bridges.delete(id);
      bridge.close();
    }
    return false;
  }
}

export function disconnect(id: string) {
  const bridge = bridges.get(id);
  bridges.delete(id);
  bridge?.close();
  if (sessionOf(id).status !== "stopped") note(id, tx("Disconnected"));
  patchSession(id, { ...idleSession(), console: sessionOf(id).console });
  for (const r of useSpark.getState().results)
    if (r.connection === id && r.running) patchResult(r.id, { running: false, request: null });
}

export function disconnectAll() {
  for (const id of [...bridges.keys()]) disconnect(id);
}

/** The bridge of a connected session (connecting first when it isn't). */
async function bridgeFor(id: string): Promise<Bridge | null> {
  if (!isConnected(id) && !(await connect(id))) return null;
  return bridges.get(id) ?? null;
}

export async function refreshCatalog(id: string) {
  const bridge = bridges.get(id);
  if (!bridge || !isConnected(id)) return;
  try {
    const catalog = (await bridge.ask("catalog")) as unknown as Catalog;
    patchSession(id, { catalog, columns: {} });
  } catch (e) {
    note(id, message(e));
  }
}

export async function loadColumns(id: string, table: string): Promise<Column[]> {
  const cached = sessionOf(id).columns[table];
  if (cached) return cached;
  const bridge = bridges.get(id);
  if (!bridge || !isConnected(id)) return [];
  try {
    const reply = await bridge.ask("columns", { table });
    const columns = reply.columns as Column[];
    patchSession(id, { columns: { ...sessionOf(id).columns, [table]: columns } });
    return columns;
  } catch {
    return [];
  }
}

// ---- results --------------------------------------------------------------------------------

function newResult(connection: string, patch: Partial<SparkResult> & Pick<SparkResult, "title" | "kind">): SparkResult {
  return {
    id: crypto.randomUUID(),
    connection,
    sql: null,
    source: null,
    filter: "",
    sort: null,
    limit: DEFAULT_ROWS,
    rows: null,
    plan: null,
    count: null,
    error: null,
    running: false,
    request: null,
    took: null,
    ...patch,
  };
}

function track(
  result: SparkResult,
  bridge: Bridge,
  op: string,
  payload: Reply,
  done: (r: Reply) => Partial<SparkResult>,
) {
  const started = performance.now();
  const { id, reply } = bridge.request(op, payload);
  patchResult(result.id, { running: true, request: id, error: null });
  return reply.then(
    (r) => {
      if (resultOf(result.id)?.request !== id) return;
      patchResult(result.id, { ...done(r), running: false, request: null, took: performance.now() - started });
    },
    (e: unknown) => {
      if (resultOf(result.id)?.request !== id) return;
      patchResult(result.id, { error: message(e), running: false, request: null, took: performance.now() - started });
    },
  );
}

export async function runSql(id: string, sql: string, explain = false) {
  const bridge = await bridgeFor(id);
  if (!bridge) return;
  const result = newResult(id, { title: queryTitle(sql), kind: explain ? "plan" : "rows", sql });
  addResult(result);
  if (explain) {
    await track(result, bridge, "explain", { text: sql, mode: "formatted" }, (r) => ({ plan: String(r.plan ?? "") }));
    return;
  }
  await track(result, bridge, "sql", { text: sql, limit: result.limit }, (r) => ({ rows: r as unknown as Rows }));
  if (changesCatalog(sql)) void refreshCatalog(id);
}

export async function preview(id: string, source: PreviewSource, title: string) {
  const bridge = await bridgeFor(id);
  if (!bridge) return;
  const result = newResult(id, { title, kind: "rows", source });
  addResult(result);
  await track(result, bridge, "preview", { source, limit: result.limit }, (r) => ({ rows: r as unknown as Rows }));
}

/** The source a result's rows come from, when they can be read again. */
function sourceOf(r: SparkResult): PreviewSource | null {
  if (r.source) return r.source;
  if (r.sql && isQuery(r.sql)) return { kind: "sql", text: r.sql };
  return null;
}

export const canTransform = (r: SparkResult) => r.kind === "rows" && sourceOf(r) !== null;

/** Reads a result again under a new filter, sort or row limit. */
export async function requery(resultId: string, patch: { filter?: string; sort?: SortSpec | null; limit?: number }) {
  const r = resultOf(resultId);
  const source = r && sourceOf(r);
  if (!r || !source) return;
  patchResult(resultId, { ...patch, count: null });
  const bridge = await bridgeFor(r.connection);
  if (!bridge) return;
  const next = resultOf(resultId)!;
  await track(
    next,
    bridge,
    "preview",
    { source, filter: next.filter || undefined, sort: next.sort ?? undefined, limit: next.limit },
    (reply) => ({ rows: reply as unknown as Rows }),
  );
}

export async function countRows(resultId: string) {
  const r = resultOf(resultId);
  const source = r && sourceOf(r);
  if (!r || !source) return;
  const bridge = await bridgeFor(r.connection);
  if (!bridge) return;
  await track(r, bridge, "count", { source, filter: r.filter || undefined }, (reply) => ({
    count: Number(reply.count),
  }));
}

export function cancelResult(resultId: string) {
  const r = resultOf(resultId);
  if (!r || r.request === null) return;
  bridges.get(r.connection)?.cancel(r.request);
}

/** Cancels whatever the session runs now. */
export function cancelSession(id: string) {
  bridges.get(id)?.cancel(null);
}

// ---- the console ----------------------------------------------------------------------------

export async function runPython(id: string, code: string) {
  if (!code.trim()) return;
  const lines = code.replace(/\n+$/, "").split("\n");
  appendConsole(id, [{ text: `${lines.map((l, i) => (i ? "... " : ">>> ") + l).join("\n")}\n`, fg: "var(--accent)" }]);
  const bridge = await bridgeFor(id);
  if (!bridge) return;
  try {
    const reply = await bridge.ask("python", { code });
    const spans: Span[] = [];
    if (reply.output) spans.push({ text: String(reply.output) });
    if (reply.error) spans.push({ text: String(reply.error), fg: "var(--ansi-red)" });
    if (reply.value !== null && reply.value !== undefined) spans.push({ text: `${String(reply.value)}\n` });
    appendConsole(id, spans);
    // Definitions can add DataFrames and views.
    void refreshCatalog(id);
  } catch (e) {
    appendConsole(id, [{ text: `${message(e)}\n`, fg: "var(--ansi-red)" }]);
  }
}

export const clearConsole = (id: string) => patchSession(id, { console: [] });

/** Exit reporting; stray sessions of an earlier load are stopped. */
export function installSessions(): () => void {
  void commands
    .runList()
    .then((runs) => {
      const live = new Set([...bridges.values()].map((b) => b.runId));
      for (const r of runs)
        if (r.running && r.configId.startsWith(PREFIX) && !live.has(r.id)) void commands.runStop(r.id);
    })
    .catch(() => {});
  const offExit = onIdeEvent("runExited", (e) => {
    const bridge = [...bridges.values()].find((b) => b.runId === e.run);
    if (!bridge) {
      if ([...bridges.values()].some((b) => b.runId === null)) earlyExits.set(e.run, e.code);
      return;
    }
    bridge.exited(e.code);
    if (bridges.get(bridge.connection) === bridge) {
      bridges.delete(bridge.connection);
      const failed = sessionOf(bridge.connection).status === "starting";
      if (!failed) disconnect(bridge.connection);
      note(bridge.connection, tx`[Spark session finished with exit code ${String(e.code ?? "?")}]`);
    }
  });
  return () => {
    offExit();
    disconnectAll();
  };
}
