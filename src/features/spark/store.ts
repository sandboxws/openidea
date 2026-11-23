import { create } from "zustand";
import type { Span } from "@/ui/ansi";
import type { Catalog, Column, PreviewSource, Rows, SparkConnection } from "./model";

export type SessionStatus = "stopped" | "starting" | "ready" | "busy" | "failed";

export interface SessionState {
  status: SessionStatus;
  /** Spark's version once connected. */
  version: string | null;
  connect: boolean;
  /** A local session's own Spark UI. */
  ui: string | null;
  error: string | null;
  catalog: Catalog | null;
  /** Columns of the tables expanded so far (also completion's). */
  columns: Record<string, Column[]>;
  console: Span[];
}

export const idleSession = (): SessionState => ({
  status: "stopped",
  version: null,
  connect: false,
  ui: null,
  error: null,
  catalog: null,
  columns: {},
  console: [],
});

export interface SortSpec {
  column: string;
  descending: boolean;
}

export interface SparkResult {
  id: string;
  connection: string;
  title: string;
  /** `rows`: a query or a preview; `plan`: Explain. */
  kind: "rows" | "plan";
  /** The query, for results of one (filter and sort run it again). */
  sql: string | null;
  source: PreviewSource | null;
  filter: string;
  sort: SortSpec | null;
  limit: number;
  rows: Rows | null;
  plan: string | null;
  count: number | null;
  error: string | null;
  running: boolean;
  /** The bridge request in flight, for Cancel. */
  request: number | null;
  /** Milliseconds the last request took. */
  took: number | null;
}

interface SparkState {
  connections: SparkConnection[];
  selected: string | null;
  sessions: Record<string, SessionState>;
  results: SparkResult[];
  /** The Spark Results tab shown: `console` or a result's id. */
  tab: string;
  /** The connection dialog: a connection being edited (a new one has no saved entry yet). */
  editing: SparkConnection | null;
}

export const CONSOLE_TAB = "console";

export const useSpark = create<SparkState>(() => ({
  connections: [],
  selected: null,
  sessions: {},
  results: [],
  tab: CONSOLE_TAB,
  editing: null,
}));

export const sessionOf = (id: string | null): SessionState => (id && useSpark.getState().sessions[id]) || idleSession();

export function patchSession(id: string, patch: Partial<SessionState>) {
  useSpark.setState((s) => ({ sessions: { ...s.sessions, [id]: { ...(s.sessions[id] ?? idleSession()), ...patch } } }));
}

export function patchResult(id: string, patch: Partial<SparkResult>) {
  useSpark.setState((s) => ({ results: s.results.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
}

export const resultOf = (id: string) => useSpark.getState().results.find((r) => r.id === id) ?? null;

const MAX_RESULTS = 20;

export function addResult(result: SparkResult) {
  useSpark.setState((s) => ({ results: [...s.results, result].slice(-MAX_RESULTS), tab: result.id }));
}

export function closeResult(id: string) {
  useSpark.setState((s) => {
    const at = s.results.findIndex((r) => r.id === id);
    const results = s.results.filter((r) => r.id !== id);
    const tab = s.tab !== id ? s.tab : (results[Math.min(at, results.length - 1)]?.id ?? CONSOLE_TAB);
    return { results, tab };
  });
}
