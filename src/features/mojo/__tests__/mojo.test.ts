import { describe, expect, it } from "vitest";
import type { RunConfig } from "@/platform/ipc";
import { mainLines } from "../gutter";
import { keywordRanges } from "../keywords";
import { defaultOutput, relative, resolve, stem } from "../paths";
import { minimalChange } from "../runner";
import { readMojo } from "../settings";
import { sameJson, serverDiffers } from "../setup";
import { buildsBeforeLaunch, mojoPaths, mojoType } from "../types";

describe("paths", () => {
  it("derives the binary from the source", () => {
    expect(stem("src/app.mojo")).toBe("app");
    expect(stem("fire.🔥")).toBe("fire");
    expect(defaultOutput("src/app.mojo")).toBe(".openidea/mojo/bin/app");
    expect(resolve("/p/sub", "../out/x")).toBe("/p/out/x");
    expect(resolve("/p", "/abs/x")).toBe("/abs/x");
    expect(relative("/p/a/b.mojo", "/p")).toBe("a/b.mojo");
  });
});

describe("keywords", () => {
  it("marks Mojo's own words outside skipped ranges", () => {
    const text = 'struct Point:\n    var x: Int  # var in a comment\n    def f(mut self): pass\nname = "struct"';
    const skip = (pos: number) => pos > text.indexOf("#") && pos < text.indexOf("\n", text.indexOf("#"));
    const words = keywordRanges(text, 0, skip).map(([a, b]) => text.slice(a, b));
    expect(words).toEqual(["struct", "var", "mut", "struct"]);
    expect(keywordRanges("def main(): pass", 0, () => false)).toEqual([]);
  });
});

describe("main", () => {
  it("finds top-level main declarations", () => {
    expect(mainLines("def greet():\n    pass\n\ndef main():\n    def main(): pass\nfn main():")).toEqual([3, 5]);
  });
});

describe("setup", () => {
  it("compares settings structurally and leaves the user's own keys alone", () => {
    expect(sameJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameJson({ a: [1] }, { a: { 0: 1 } })).toBe(false);
    const server = { command: "/sdk/bin/mojo-lsp-server", args: ["-I", "/p/src"] };
    expect(serverDiffers({ ...server, enabled: false }, server)).toBe(false);
    expect(serverDiffers({ command: "/old/bin/mojo-lsp-server", args: [] }, server)).toBe(true);
    expect(serverDiffers(undefined, server)).toBe(true);
  });

  it("reads settings leniently", () => {
    expect(readMojo({ sdkDirectory: ".venv", importPaths: 3 })).toEqual({ sdkDirectory: ".venv", importPaths: "" });
    expect(readMojo(null)).toEqual({ sdkDirectory: "", importPaths: "" });
  });
});

describe("formatting", () => {
  it("applies only what changed", () => {
    const before = "def f():\n  pass\n";
    const after = "def f():\n    pass\n";
    const c = minimalChange(before, after)!;
    expect(before.slice(0, c.from) + c.insert + before.slice(c.to)).toBe(after);
    expect(c.insert).toBe("  ");
    expect(minimalChange("same", "same")).toBeNull();
  });
});

describe("Mojo Application", () => {
  const config = (over: Partial<RunConfig>): RunConfig => ({
    id: "m",
    name: "m",
    kind: "mojo-application",
    command: "",
    args: [],
    cwd: null,
    env: {},
    detected: false,
    isTest: false,
    debugAdapter: "lldb-dap",
    ...over,
  });

  it("runs the built binary with the program arguments", () => {
    expect(mojoType.commandLine({ source: "src/app.mojo", programArgs: "--n 3" })).toEqual({
      command: ".openidea/mojo/bin/app",
      args: ["--n", "3"],
    });
    expect(mojoType.commandLine({ source: " " })).toBeNull();
  });

  it("resolves its paths against the working directory", () => {
    expect(mojoPaths(config({ cwd: "sub", params: { source: "a.mojo" } }), "/p")).toEqual({
      cwd: "/p/sub",
      source: "/p/sub/a.mojo",
      output: "/p/sub/.openidea/mojo/bin/a",
    });
  });

  it("knows when a Before Launch task builds it", () => {
    expect(
      buildsBeforeLaunch(
        config({ beforeLaunch: [{ kind: "command", target: "env A=1 /sdk/bin/mojo build -O0 -g a.mojo" }] }),
      ),
    ).toBe(true);
    expect(buildsBeforeLaunch(config({ beforeLaunch: [{ kind: "run", target: "other" }] }))).toBe(false);
    expect(buildsBeforeLaunch(config({}))).toBe(false);
  });
});
