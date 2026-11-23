/**
 * Reads pages of an inspected value one `evaluate` at a time: a bounded queue (the newest
 * reads win while scrolling far), a least recently used cache, and a generation that drops
 * replies of an earlier expression, transform or frame. Renders read its snapshot.
 */
import { PageCache, inspectExpression, parseInspect, type InspectPage, type InspectSpec } from "./inspect";

export interface LoaderSnapshot {
  /** The first page read for the current target: shape, rows, columns, kind. */
  meta: InspectPage | null;
  error: string | null;
  pages: ReadonlyMap<string, InspectPage>;
  /** A page of each column band (its headers, dtypes and value ranges). */
  bands: ReadonlyMap<number, InspectPage>;
}

const EMPTY: LoaderSnapshot = { meta: null, error: null, pages: new Map(), bands: new Map() };

export const pageKey = (row: number, column: number) => `${row}:${column}`;

export class PageLoader {
  private readonly evaluate: (expression: string) => Promise<string>;
  private readonly queueLimit: number;
  private readonly listeners = new Set<() => void>();
  private snapshot: LoaderSnapshot = EMPTY;
  private readonly cache = new PageCache<InspectPage>(128);
  private readonly bands = new Map<number, InspectPage>();
  private queue: Array<[number, number]> = [];
  private readonly inflight = new Set<string>();
  private generation = 0;
  private busy = false;
  private target: { expression: string; spec: InspectSpec } | null = null;

  constructor(evaluate: (expression: string) => Promise<string>, queueLimit = 32) {
    this.evaluate = evaluate;
    this.queueLimit = queueLimit;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private publish(patch: Partial<LoaderSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, pages: this.cache.copy(), bands: new Map(this.bands) };
    for (const l of this.listeners) l();
  }

  /** Starts over for `expression` under `spec` (also after the frame changed). */
  reset(expression: string, spec: InspectSpec) {
    this.generation++;
    this.target = { expression, spec };
    this.cache.clear();
    this.bands.clear();
    this.queue = [];
    this.inflight.clear();
    this.busy = false;
    this.snapshot = EMPTY;
    this.publish({ meta: null, error: null });
    this.need(0, 0);
  }

  /** Reads page (`row`, `column`) unless it's cached or on its way. */
  need(row: number, column: number) {
    const key = pageKey(row, column);
    if (!this.target || this.cache.has(key) || this.inflight.has(key)) return;
    this.inflight.add(key);
    this.queue.push([row, column]);
    while (this.queue.length > this.queueLimit) {
      const [r, c] = this.queue.shift()!;
      this.inflight.delete(pageKey(r, c));
    }
    this.pump();
  }

  private pump() {
    if (this.busy || !this.target) return;
    const next = this.queue.shift();
    if (!next) return;
    const [row, column] = next;
    const gen = this.generation;
    const { expression, spec } = this.target;
    this.busy = true;
    const done = () => {
      if (gen !== this.generation) return;
      this.inflight.delete(pageKey(row, column));
      this.busy = false;
      this.pump();
    };
    this.evaluate(inspectExpression(expression, spec, row, column)).then(
      (text) => {
        if (gen !== this.generation) return;
        const result = parseInspect(text);
        if ("error" in result) this.publish({ error: result.error });
        else {
          this.cache.set(pageKey(row, column), result.page);
          if (!this.bands.has(column)) this.bands.set(column, result.page);
          this.publish({ meta: this.snapshot.meta ?? result.page, error: null });
        }
        done();
      },
      (e: unknown) => {
        if (gen === this.generation) this.publish({ error: e instanceof Error ? e.message : String(e) });
        done();
      },
    );
  }
}
