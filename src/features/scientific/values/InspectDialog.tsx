/**
 * Inspect Large Value: a NumPy array or pandas DataFrame / Series of the paused frame, loaded
 * in 30 × 30 cell pages as the grid scrolls (at most 128 pages kept, 32 reads queued). An
 * expression views a slice or transform; rows can be limited, filtered and sorted by column,
 * values with more than two dimensions get two display axes and fixed indexes for the others,
 * and numeric columns are colored by value.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type UIEvent } from "react";
import { tx } from "@/platform/i18n";
import { Button, Checkbox, Dialog, Input, Select, T } from "@/ui";
import type { DebugValue } from "@/workbench/contributions";
import { DEFAULT_SPEC, PAGE, SCAN_LIMIT, heat, parseFixed, type InspectSpec } from "./inspect";
import { PageLoader, pageKey } from "./loader";
import { closeInspect, useInspect } from "./store";
import styles from "./Inspect.module.css";

const ROW_H = 24;
const COL_W = 120;
const INDEX_W = 88;

function sortTitle(column: number): string {
  return tx`Sort by column ${column}`;
}

function scanNote(): string {
  const limit = SCAN_LIMIT;
  return tx`Coloring scans at most ${limit} values per column; view a smaller slice to color it`;
}

export function InspectDialog() {
  const value = useInspect((s) => s.value);
  return value ? <Inspector key={value.expression} value={value} /> : null;
}

function Inspector({ value }: { value: DebugValue }) {
  const [expression, setExpression] = useState(value.expression);
  const [draft, setDraft] = useState(value.expression);
  const [spec, setSpec] = useState<InspectSpec>(DEFAULT_SPEC);
  const [view, setView] = useState({ top: 0, left: 0, width: 800, height: 400 });
  const [frame, setFrame] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [loader] = useState(() => new PageLoader(value.evaluate));
  const snap = useSyncExternalStore(loader.subscribe, loader.getSnapshot);

  // Form fields (applied with Apply / Enter).
  const [first, setFirst] = useState("");
  const [end, setEnd] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [condition, setCondition] = useState("");
  const [fixedText, setFixedText] = useState("");
  const [jumpRow, setJumpRow] = useState("");
  const [jumpColumn, setJumpColumn] = useState("");

  useEffect(() => value.onChange(() => setFrame((n) => n + 1)), [value]);
  // A new expression, transform or frame: start over.
  useEffect(() => loader.reset(expression, spec), [loader, expression, spec, frame]);
  // The grid's size, as it changes (the dialog resizes).
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setView({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const page = snap.meta;
  const error = formError ?? snap.error;
  const rows = page?.rows ?? 0;
  const columns = page?.columns ?? 0;
  const firstRow = Math.floor(view.top / ROW_H);
  const lastRow = Math.min(rows - 1, Math.ceil((view.top + view.height) / ROW_H));
  const firstCol = Math.floor(view.left / COL_W);
  const lastCol = Math.min(columns - 1, Math.ceil((view.left + view.width) / COL_W));

  useEffect(() => {
    if (!page) return;
    for (let pr = Math.floor(firstRow / PAGE); pr <= Math.floor(lastRow / PAGE); pr++)
      for (let pc = Math.floor(firstCol / PAGE); pc <= Math.floor(lastCol / PAGE); pc++) loader.need(pr, pc);
  }, [loader, page, firstRow, lastRow, firstCol, lastCol]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setView({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight });
  };
  const ndim = page?.shape.length ?? 0;
  const axes = spec.axes ?? [0, 1];
  const numeric = (c: number) => {
    const band = snap.bands.get(Math.floor(c / PAGE));
    const dtype = page?.kind === "array" ? page.dtypes[0] : band?.dtypes[c % PAGE];
    return !!dtype && /^(u?int|float|Int|UInt|Float)\d*$/.test(dtype);
  };

  const apply = () => {
    const num = (t: string) => (t.trim() === "" ? null : Number(t));
    const column = num(filterColumn);
    const fixed = parseFixed(fixedText);
    if (fixed === null) {
      setFormError(tx("Fixed axes read like 0=2, 3=1"));
      return;
    }
    setFormError(null);
    const next = draft.trim() || value.expression;
    // Sorting and axes are by position: they belong to the value they were chosen for.
    const changed = next !== expression;
    setExpression(next);
    setSpec((s) => ({
      ...s,
      sort: changed ? null : s.sort,
      axes: changed ? null : s.axes,
      first: num(first),
      end: num(end),
      filter: column !== null && condition.trim() ? { column, condition: condition.trim() } : null,
      fixed,
    }));
  };
  const sortBy = (c: number) =>
    setSpec((s) => ({
      ...s,
      sort:
        s.sort?.column !== c
          ? { column: c, descending: false }
          : s.sort.descending
            ? null
            : { column: c, descending: true },
    }));
  const jump = () => {
    const el = grid.current;
    if (!el) return;
    const r = Number(jumpRow || 0);
    const c = Number(jumpColumn || 0);
    el.scrollTo({ top: Math.max(0, r) * ROW_H, left: Math.max(0, c) * COL_W });
  };

  const axisOptions = useMemo(
    () => Array.from({ length: ndim }, (_, axis) => ({ value: String(axis), label: tx`Axis ${axis}` })),
    [ndim],
  );
  const scanLimited = !!page && spec.scan && rows > SCAN_LIMIT;
  const shape = page?.shape.join(" × ") ?? "";
  const dtype = page?.kind === "array" ? page.dtypes[0] : null;

  const cells = [];
  if (page)
    for (let r = Math.max(0, firstRow); r <= lastRow; r++) {
      for (let c = Math.max(0, firstCol); c <= lastCol; c++) {
        const p = snap.pages.get(pageKey(Math.floor(r / PAGE), Math.floor(c / PAGE)));
        const text = p?.cells[r % PAGE]?.[c % PAGE];
        const range = spec.scan ? (p?.ranges[c % PAGE] ?? null) : null;
        cells.push(
          <div
            key={`${r}:${c}`}
            className={`${styles.cell} ${numeric(c) ? styles.numeric : ""} ${text === undefined ? styles.pending : ""}`}
            style={{
              top: (r + 1) * ROW_H,
              left: INDEX_W + c * COL_W,
              width: COL_W,
              height: ROW_H,
              background: text !== undefined ? heat(Number(text), range) : undefined,
            }}
            title={text}
          >
            {text ?? "…"}
          </div>,
        );
      }
    }
  const heads = [];
  const indexCells = [];
  if (page) {
    for (let c = Math.max(0, firstCol); c <= lastCol; c++) {
      const band = snap.bands.get(Math.floor(c / PAGE));
      const label = band?.headers[c % PAGE] ?? String(c);
      const sorted = spec.sort?.column === c ? (spec.sort.descending ? " ↓" : " ↑") : "";
      heads.push(
        <div
          key={`h${c}`}
          className={styles.head}
          style={{ top: view.top, left: INDEX_W + c * COL_W, width: COL_W, height: ROW_H }}
        >
          <button type="button" className={styles.headButton} title={sortTitle(c)} onClick={() => sortBy(c)}>
            {label}
            {sorted}
          </button>
        </div>,
      );
    }
    for (let r = Math.max(0, firstRow); r <= lastRow; r++) {
      const p = snap.pages.get(pageKey(Math.floor(r / PAGE), Math.floor(firstCol / PAGE)));
      indexCells.push(
        <div
          key={`i${r}`}
          className={styles.index}
          style={{ top: (r + 1) * ROW_H, left: view.left, width: INDEX_W, height: ROW_H }}
        >
          {p?.index[r % PAGE] ?? r}
        </div>,
      );
    }
  }

  return (
    <Dialog
      open
      title={tx`Inspect ${value.expression}`}
      onClose={closeInspect}
      width={980}
      minWidth={520}
      minHeight={420}
      resizable="both"
      buttons={[{ label: "Close", role: "cancel" }]}
    >
      <div className={styles.dialog}>
        <div className={styles.row}>
          <Input
            className={styles.grow}
            mono
            value={draft}
            aria-label={tx("Expression")}
            placeholder={tx("A slice or transform, such as df.iloc[1000:2000]")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
          />
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>
            <T>Rows</T>
          </span>
          <Input
            className={styles.small}
            mono
            value={first}
            placeholder="0"
            aria-label={tx("First row")}
            onChange={(e) => setFirst(e.target.value)}
          />
          <Input
            className={styles.small}
            mono
            value={end}
            placeholder="∞"
            aria-label={tx("End row")}
            onChange={(e) => setEnd(e.target.value)}
          />
          <span className={styles.label}>
            <T>Filter column</T>
          </span>
          <Input
            className={styles.small}
            mono
            value={filterColumn}
            aria-label={tx("Filter column")}
            onChange={(e) => setFilterColumn(e.target.value)}
          />
          <Input
            className={styles.medium}
            mono
            value={condition}
            placeholder="> 0.5"
            aria-label={tx("Condition")}
            onChange={(e) => setCondition(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
          />
          <Checkbox
            checked={spec.scan}
            onChange={(scan) => setSpec((s) => ({ ...s, scan }))}
            label={tx("Color by value")}
          />
          <span className={styles.label}>
            <T>Go to</T>
          </span>
          <Input
            className={styles.small}
            mono
            value={jumpRow}
            placeholder="0"
            aria-label={tx("Row")}
            onChange={(e) => setJumpRow(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && jump()}
          />
          <Input
            className={styles.small}
            mono
            value={jumpColumn}
            placeholder="0"
            aria-label={tx("Column")}
            onChange={(e) => setJumpColumn(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && jump()}
          />
        </div>
        {ndim > 2 && (
          <div className={styles.row}>
            <span className={styles.label}>
              <T>Rows from</T>
            </span>
            <Select
              value={String(axes[0])}
              options={axisOptions}
              aria-label={tx("Row axis")}
              onChange={(v) => setSpec((s) => ({ ...s, axes: [Number(v), (s.axes ?? [0, 1])[1]] }))}
            />
            <span className={styles.label}>
              <T>Columns from</T>
            </span>
            <Select
              value={String(axes[1])}
              options={axisOptions}
              aria-label={tx("Column axis")}
              onChange={(v) => setSpec((s) => ({ ...s, axes: [(s.axes ?? [0, 1])[0], Number(v)] }))}
            />
            <span className={styles.label}>
              <T>Other axes</T>
            </span>
            <Input
              className={styles.medium}
              mono
              value={fixedText}
              placeholder="0=2"
              aria-label={tx("Other axes")}
              onChange={(e) => setFixedText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && apply()}
            />
          </div>
        )}
        <div className={styles.status}>
          {page ? (
            <>
              {tx`Shape ${shape}`}
              {dtype ? ` · ${dtype}` : ""}
              {spec.filter || spec.first !== null || spec.end !== null ? ` · ${tx`${rows} rows shown`}` : ""}
              {scanLimited ? ` · ${scanNote()}` : ""}
            </>
          ) : error ? null : (
            <T>Reading…</T>
          )}
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <div ref={grid} className={styles.grid} onScroll={onScroll} role="grid" aria-label={tx("Value")}>
          {page && (
            <div style={{ position: "relative", width: INDEX_W + columns * COL_W, height: (rows + 1) * ROW_H }}>
              <div
                className={styles.corner}
                style={{ top: view.top, left: view.left, width: INDEX_W, height: ROW_H }}
              />
              {heads}
              {indexCells}
              {cells}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
