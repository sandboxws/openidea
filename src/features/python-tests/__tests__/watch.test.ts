import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WatchScheduler, type WatchDeps } from "../watch";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function deps(overrides: Partial<WatchDeps> = {}) {
  const calls: string[] = [];
  let release: (() => void) | null = null;
  const d: WatchDeps = {
    relate: vi.fn(async (changed: string[]) => {
      calls.push(`relate ${changed.join(",")}`);
      return { files: changed.map((c) => c.replace("src/", "tests/test_")), refresh: false };
    }),
    collect: vi.fn(async () => void calls.push("collect")),
    run: vi.fn(
      (files: string[]) =>
        new Promise<void>((resolve) => {
          calls.push(`run ${files.join(",")}`);
          release = resolve;
        }),
    ),
    nothingRelated: vi.fn((changed: string[]) => void calls.push(`none ${changed.join(",")}`)),
    ...overrides,
  };
  return { d, calls, finishRun: () => release?.() };
}

describe("WatchScheduler", () => {
  it("waits 400 ms for more changes, then runs the related tests once", async () => {
    const { d, calls } = deps();
    const w = new WatchScheduler(d);
    w.changed(["src/a.py"]);
    await vi.advanceTimersByTimeAsync(300);
    w.changed(["src/b.py"]);
    await vi.advanceTimersByTimeAsync(399);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["relate src/a.py,src/b.py", "run tests/test_a.py,tests/test_b.py"]);
  });

  it("merges changes during a run into one follow-up run", async () => {
    const { d, calls, finishRun } = deps();
    const w = new WatchScheduler(d);
    w.changed(["src/a.py"]);
    await vi.advanceTimersByTimeAsync(400);
    w.changed(["src/b.py"]);
    await vi.advanceTimersByTimeAsync(400);
    w.changed(["src/c.py"]);
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toEqual(["relate src/a.py", "run tests/test_a.py"]);
    finishRun();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.slice(2)).toEqual(["relate src/b.py,src/c.py", "run tests/test_b.py,tests/test_c.py"]);
    expect(w.active).toBe(true);
    finishRun();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.active).toBe(false);
  });

  it("collects first when changes can alter collection, and reports when nothing is related", async () => {
    const { d, calls } = deps({
      relate: async (changed) =>
        changed[0] === "pyproject.toml" ? { files: [], refresh: true } : { files: [], refresh: false },
    });
    const w = new WatchScheduler(d);
    w.changed(["pyproject.toml"]);
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toEqual(["collect", "none pyproject.toml"]);
  });

  it("drops pending work on stop", async () => {
    const { d, calls } = deps();
    const w = new WatchScheduler(d);
    w.changed(["src/a.py"]);
    w.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([]);
  });
});
