/**
 * Inspect Large Value: pages of a NumPy array or pandas DataFrame / Series read from a paused
 * debugpy frame. Each page is one `evaluate` of an expression that defines the helper in a
 * fresh namespace and calls it; the helper keeps the last few transformed values (row range,
 * filter, sort, display axes) in the debuggee so the next pages don't transform again.
 */

export const PAGE = 30;
/** Columns scanned for the heatmap only up to this many values (PyIdea's limit). */
export const SCAN_LIMIT = 10_000;

export interface InspectSpec {
  /** Row and column axes of a value with more than two dimensions. */
  axes: [number, number] | null;
  /** Index of each other axis (`{ "0": 2 }`); unlisted axes take 0. */
  fixed: Record<string, number>;
  /** Rows kept before filtering and sorting: `first <= row < end` (null: open). */
  first: number | null;
  end: number | null;
  /** Rows where `x <condition>` holds for column `column` (`> 0.5`, `== 'a'`, `.isna()`). */
  filter: { column: number; condition: string } | null;
  sort: { column: number; descending: boolean } | null;
  /** Value ranges of numeric columns, for coloring. */
  scan: boolean;
}

export const DEFAULT_SPEC: InspectSpec = {
  axes: null,
  fixed: {},
  first: null,
  end: null,
  filter: null,
  sort: null,
  scan: true,
};

export interface InspectPage {
  kind: "frame" | "series" | "array";
  /** The value's own shape. */
  shape: number[];
  /** Rows and columns after the transform. */
  rows: number;
  columns: number;
  dtypes: string[];
  headers: string[];
  index: string[];
  cells: string[][];
  /** Per shown column: `[min, max]` of a numeric column within the scan limit, else null. */
  ranges: Array<[number, number] | null>;
}

export type InspectResult = { page: InspectPage } | { error: string };

// Runs in the debuggee. Cells are cut at 200 characters; JSON stays ASCII so its repr only
// escapes backslashes and single quotes.
const HELPER = `
def f(o, spec):
    import json, builtins
    sp = json.loads(spec)
    s = lambda v: str(v)[:200]
    if hasattr(o, 'iloc') and hasattr(o, 'columns'):
        k = 'frame'
    elif hasattr(o, 'iloc'):
        k = 'series'
    elif hasattr(o, 'ndim') and hasattr(o, 'dtype') and hasattr(o, 'shape'):
        k = 'array'
    else:
        return json.dumps({'error': 'This value is a %s, not an array, DataFrame or Series' % type(o).__name__})
    try:
        cache = builtins.__dict__.setdefault('_openidea_inspect', {})
        key = json.dumps([id(o), sp['axes'], sp['fixed'], sp['first'], sp['end'], sp['filter'], sp['sort']])
        hit = cache.get(key)
        if hit is not None and hit[0] is o:
            d, labels = hit[1], hit[2]
        else:
            first, end, flt, srt = sp['first'], sp['end'], sp['filter'], sp['sort']
            if k == 'array':
                import numpy as np
                a = np.asarray(o)
                if a.ndim == 0:
                    a = a.reshape(1, 1)
                elif a.ndim == 1:
                    a = a.reshape(-1, 1)
                elif a.ndim > 2:
                    ra, ca = sp['axes'] or [0, 1]
                    a = a[tuple(slice(None) if x in (ra, ca) else int(sp['fixed'].get(str(x), 0)) for x in range(a.ndim))]
                    if ra > ca:
                        a = a.T
                labels = np.arange(a.shape[0])
                a, labels = a[first:end], labels[first:end]
                if flt:
                    m = np.asarray(eval('x ' + flt['condition'], {'np': np}, {'x': a[:, flt['column']]}), dtype=bool)
                    a, labels = a[m], labels[m]
                if srt:
                    order = np.argsort(a[:, srt['column']], kind='stable')
                    if srt['descending']:
                        order = order[::-1]
                    a, labels = a[order], labels[order]
                d = a
            else:
                d = o.to_frame() if k == 'series' else o
                d = d.iloc[first:end]
                if flt:
                    d = d[eval('x ' + flt['condition'], {}, {'x': d.iloc[:, flt['column']]})]
                if srt:
                    d = d.sort_values(by=d.columns[srt['column']], ascending=not srt['descending'], kind='stable')
                labels = None
            while len(cache) >= 4:
                cache.pop(next(iter(cache)))
            cache[key] = (o, d, labels)
        r0, c0, nr, nc = sp['page']
        R, C = d.shape[0], (d.shape[1] if len(d.shape) > 1 else 1)
        ranges = []
        if k == 'array':
            p = d[r0:r0 + nr, c0:c0 + nc]
            cells = [[s(v) for v in row] for row in p.tolist()]
            heads, idx, dt = [str(c0 + j) for j in range(p.shape[1])], [str(int(i)) for i in labels[r0:r0 + nr]], [str(d.dtype)]
            for j in range(p.shape[1]):
                col = d[:, c0 + j]
                ok = sp['scan'] and R <= ${SCAN_LIMIT} and d.dtype.kind in 'iuf' and R > 0
                ranges.append([float(col.min()), float(col.max())] if ok else None)
        else:
            p = d.iloc[r0:r0 + nr, c0:c0 + nc]
            cells = [[s(v) for v in row] for row in p.itertuples(index=False, name=None)]
            heads, idx, dt = [s(c) for c in p.columns], [s(i) for i in p.index], [str(t) for t in p.dtypes]
            for j in range(p.shape[1]):
                col = d.iloc[:, c0 + j]
                ok = sp['scan'] and R <= ${SCAN_LIMIT} and getattr(col.dtype, 'kind', '') in 'iuf' and R > 0
                ranges.append([float(col.min()), float(col.max())] if ok else None)
        return json.dumps({'kind': k, 'shape': [int(x) for x in getattr(o, 'shape', ())], 'rows': int(R), 'columns': int(C),
                           'dtypes': dt, 'headers': heads, 'index': idx, 'cells': cells, 'ranges': ranges})
    except Exception as e:
        return json.dumps({'error': '%s: %s' % (type(e).__name__, e)})
`;

/** The `evaluate` expression reading page (`row`, `column` of pages) of `expression` under `spec`. */
export function inspectExpression(expression: string, spec: InspectSpec, row: number, column: number): string {
  const payload = JSON.stringify({ ...spec, page: [row * PAGE, column * PAGE, PAGE, PAGE] });
  return (
    `(lambda g, o: (exec(${JSON.stringify(HELPER)}, g), g['f'](o, ${JSON.stringify(payload)}))[1])` +
    `({}, (${expression}))`
  );
}

/** A Python string literal's text (`'…'` / `"…"` with escapes); other text as it is. */
export function unrepr(value: string): string {
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value.length < 2 || value[value.length - 1] !== quote) return value;
  let out = "";
  for (let i = 1; i < value.length - 1; i++) {
    const c = value[i]!;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = value[++i] ?? "";
    const hex = (len: number) => {
      const code = parseInt(value.slice(i + 1, i + 1 + len), 16);
      i += len;
      return String.fromCodePoint(code);
    };
    out +=
      n === "n"
        ? "\n"
        : n === "t"
          ? "\t"
          : n === "r"
            ? "\r"
            : n === "x"
              ? hex(2)
              : n === "u"
                ? hex(4)
                : n === "U"
                  ? hex(8)
                  : n;
  }
  return out;
}

export function parseInspect(value: string): InspectResult {
  try {
    const data = JSON.parse(unrepr(value)) as Record<string, unknown>;
    if (typeof data.error === "string") return { error: data.error };
    return { page: data as unknown as InspectPage };
  } catch {
    return { error: value };
  }
}

/** `0=2, 3=1` → `{ "0": 2, "3": 1 }`; null when it doesn't read. */
export function parseFixed(text: string): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)=(-?\d+)$/.exec(part);
    if (!m) return null;
    out[m[1]!] = Number(m[2]);
  }
  return out;
}

/** A least recently used page cache. */
export class PageCache<V> {
  private map = new Map<string, V>();
  readonly limit: number;
  constructor(limit = 128) {
    this.limit = limit;
  }
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value!);
  }
  has(key: string) {
    return this.map.has(key);
  }
  clear() {
    this.map.clear();
  }
  /** A snapshot of the entries. */
  copy(): Map<string, V> {
    return new Map(this.map);
  }
  get size() {
    return this.map.size;
  }
}

/** A heat color for `value` within `[min, max]`: a mix of the accent from transparent. */
export function heat(value: number, range: [number, number] | null): string | undefined {
  if (!range || !Number.isFinite(value)) return undefined;
  const [min, max] = range;
  const t = max > min ? (value - min) / (max - min) : 0.5;
  return `color-mix(in srgb, var(--accent) ${Math.round(8 + t * 47)}%, transparent)`;
}
