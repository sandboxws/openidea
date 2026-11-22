import { describe, expect, it } from "vitest";
import type { PythonVersionHint } from "@/platform/ipc";
import { hintPosition, hintText, stringBefore } from "../hints";
import { typedVersion, versionOptions } from "../versions";

describe("version completion", () => {
  it("completes only after a comparison operator", () => {
    expect(typedVersion('  "flask>=3.')).toBe("3.");
    expect(typedVersion('"requests[socks] == ')).toBe("");
    expect(typedVersion('"numpy~=2.2,<')).toBe("");
    expect(typedVersion('"flask')).toBeNull();
    expect(typedVersion('"flask; python_version')).toBeNull();
  });

  it("keeps the given order and filters by what's typed", () => {
    const options = versionOptions(["3.1.3", "3.1.2", "3.0.0", "2.3.3"], "3.1", (v) =>
      v === "3.1.3" ? "latest" : undefined,
    );
    expect(options.map((o) => [o.label, o.detail])).toEqual([
      ["3.1.3", "latest"],
      ["3.1.2", undefined],
    ]);
    expect(options[0]!.boost).toBeGreaterThan(options[1]!.boost!);
  });
});

describe("hintText", () => {
  const hint = (over: Partial<PythonVersionHint>): PythonVersionHint => ({
    package: "flask",
    from: 0,
    to: 5,
    locked: [],
    installed: null,
    ...over,
  });

  it("shows the lock and the installed version, flagging a difference", () => {
    expect(hintText(hint({ locked: ["3.1.3"], installed: "3.1.3" }))).toEqual({
      text: "locked 3.1.3 · installed 3.1.3",
      mismatch: false,
    });
    expect(hintText(hint({ locked: ["3.1.3"], installed: "3.0.0" }))?.mismatch).toBe(true);
    expect(hintText(hint({ locked: ["3.1.3"] }))).toEqual({ text: "locked 3.1.3 · not installed", mismatch: true });
    expect(hintText(hint({ installed: "1.0" }))).toEqual({ text: "installed 1.0", mismatch: false });
    expect(hintText(hint({}))).toBeNull();
  });
});

describe("hint placement", () => {
  it("goes to the line's end after a trailing comma, else right after the string", () => {
    const line = '    "flask>=3.0",';
    expect(hintPosition(line, 100, 100 + line.indexOf(","))).toBe(100 + line.length);
    const inline = 'deps = ["a>=1", "b"]';
    expect(hintPosition(inline, 0, inline.indexOf(","))).toBe(inline.indexOf(","));
  });

  it("finds the requirement string before a hint", () => {
    const line = '    "flask>=3.0",';
    expect(stringBefore(line, line.length)).toEqual({ from: 5, to: 15 });
    expect(line.slice(5, 15)).toBe("flask>=3.0");
    expect(stringBefore("no quotes", 9)).toBeNull();
  });
});
