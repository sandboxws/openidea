import { describe, expect, it } from "vitest";
import type { PythonTestResult } from "@/platform/ipc";
import { outputText, snapshotText } from "../ui/Details";
import { outputLinks } from "../ui/Output";

const result: PythonTestResult = {
  id: "tests/test_a.py::test_x",
  outcome: "failed",
  duration: 0.01,
  message: "assert 4 == 5",
  longrepr: 'tests/test_a.py:8: AssertionError\n  File "/p/src/a.py", line 3, in f',
  location: { file: "/p/tests/test_a.py", line: 8 },
  expected: "5",
  actual: "4",
  params: null,
  snapshot: { file: "/p/tests/test_a.py", start: 6, line: 8, lines: ["a", "b", "assert x == 5", "c"] },
  stdout: "hello",
  stderr: null,
  log: null,
};

describe("failure details", () => {
  it("lays a snapshot out at its original line numbers", () => {
    const snap = snapshotText(result)!;
    expect(snap.line).toBe(7);
    expect(snap.text.split("\n")[7]).toBe("assert x == 5");
    expect(snapshotText({ ...result, snapshot: null })).toBeNull();
  });

  it("shows the traceback, then captured output", () => {
    expect(outputText(result)).toBe(`${result.longrepr}\n\n--- Captured stdout ---\nhello`);
  });
});

describe("outputLinks", () => {
  it("links pytest and traceback locations, resolving relative paths", () => {
    const parts = outputLinks(result.longrepr!, "/p");
    const links = parts.filter((p) => typeof p !== "string");
    expect(links).toEqual([
      { text: "tests/test_a.py:8", path: "/p/tests/test_a.py", line: 8 },
      { text: 'File "/p/src/a.py", line 3', path: "/p/src/a.py", line: 3 },
    ]);
    expect(parts.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe(result.longrepr);
  });
});
