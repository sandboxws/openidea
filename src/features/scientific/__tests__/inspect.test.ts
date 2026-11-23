import { describe, expect, it } from "vitest";
import { DEFAULT_SPEC, PageCache, heat, inspectExpression, parseFixed, parseInspect, unrepr } from "../values/inspect";
import { PageLoader } from "../values/loader";

describe("Inspect Large Value helpers", () => {
  it("reads the helper's reply from a Python string repr", () => {
    expect(unrepr(String.raw`'{"a": "it\'s", "b": "x\\"y"}'`)).toBe(String.raw`{"a": "it's", "b": "x\"y"}`);
    expect(unrepr("plain")).toBe("plain");
    const reply = String.raw`'{"kind": "array", "shape": [2, 2], "rows": 2, "columns": 2, "dtypes": ["int64"], "headers": ["0", "1"], "index": ["0", "1"], "cells": [["1", "2"], ["3", "4"]], "ranges": [[1.0, 3.0], null]}'`;
    const parsed = parseInspect(reply);
    expect("page" in parsed && parsed.page.cells[1]).toEqual(["3", "4"]);
    expect(parseInspect(`'{"error": "NameError: x"}'`)).toEqual({ error: "NameError: x" });
    expect(parseInspect("Traceback…")).toEqual({ error: "Traceback…" });
  });

  it("passes the value as an argument and the page in the spec", () => {
    const expr = inspectExpression("df.iloc[:10]", { ...DEFAULT_SPEC, sort: { column: 1, descending: true } }, 2, 1);
    expect(expr.endsWith("({}, (df.iloc[:10]))")).toBe(true);
    expect(expr).toContain(String.raw`\"page\":[60,30,30,30]`);
    expect(expr).toContain(String.raw`\"sort\":{\"column\":1,\"descending\":true}`);
  });

  it("reads fixed axes", () => {
    expect(parseFixed("0=2, 3=-1")).toEqual({ "0": 2, "3": -1 });
    expect(parseFixed("")).toEqual({});
    expect(parseFixed("a=1")).toBeNull();
  });

  it("keeps the most recently used pages", () => {
    const cache = new PageCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect([cache.has("a"), cache.has("b"), cache.has("c")]).toEqual([true, false, true]);
  });

  it("colors by position in the column's range", () => {
    expect(heat(5, [0, 10])).toContain("32%");
    expect(heat(Number("n/a"), [0, 10])).toBeUndefined();
    expect(heat(1, null)).toBeUndefined();
  });
});

describe("PageLoader", () => {
  const page = (r: number) =>
    `'{"kind": "array", "shape": [100, 1], "rows": 100, "columns": 1, "dtypes": ["f8"], "headers": ["0"], "index": ["${r}"], "cells": [["${r}"]], "ranges": [null]}'`;

  it("reads one page at a time, newest first when the queue overflows, and drops stale replies", async () => {
    const calls: string[] = [];
    const pending: Array<(v: string) => void> = [];
    const loader = new PageLoader(
      (expr) =>
        new Promise((resolve) => {
          calls.push(/\\"page\\":\[(\d+)/.exec(expr)![1]!);
          pending.push(resolve);
        }),
      2,
    );
    loader.reset("a", DEFAULT_SPEC);
    loader.need(1, 0);
    loader.need(2, 0);
    loader.need(3, 0); // the queue keeps the newest two: pages 2 and 3
    expect(calls).toEqual(["0"]);
    pending.shift()!(page(0));
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["0", "60"]);
    expect(loader.getSnapshot().meta?.rows).toBe(100);
    loader.reset("b", DEFAULT_SPEC); // a new target: the reply on its way is dropped
    pending.shift()!(page(2));
    await Promise.resolve();
    expect(loader.getSnapshot().pages.size).toBe(0);
    expect(calls.at(-1)).toBe("0");
  });
});
