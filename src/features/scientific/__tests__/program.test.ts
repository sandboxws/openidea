import { describe, expect, it } from "vitest";
import type { RunConfig } from "@/platform/ipc";
import { isPythonProgram, plotsLaunch, profileLaunch, programIndex, readPlots } from "../program";

const config = (over: Partial<RunConfig>): RunConfig => ({
  id: "c",
  name: "c",
  kind: "python",
  command: "python",
  args: ["-u", "app.py", "--n", "3"],
  cwd: null,
  env: {},
  detected: false,
  isTest: false,
  debugAdapter: "debugpy",
  ...over,
});

describe("Science launches", () => {
  it("finds the program in a Python configuration", () => {
    expect(programIndex(["-u", "app.py"])).toBe(1);
    expect(programIndex(["run", "python", "-m", "pkg"])).toBe(2);
    expect(isPythonProgram(config({}))).toBe(true);
    expect(isPythonProgram(config({ args: ["-c", "print(1)"] }))).toBe(false);
    expect(isPythonProgram(config({ kind: "pytest" }))).toBe(false);
  });

  it("puts the profiler between the interpreter's options and the program", () => {
    expect(profileLaunch(config({}), "/h", "/out").args).toEqual([
      "-u",
      "/h/openidea_science_profile.py",
      "/out",
      "app.py",
      "--n",
      "3",
    ]);
    expect(profileLaunch(config({ command: "uv", args: ["run", "python", "-m", "pkg"] }), "/h", "/o").args).toEqual([
      "run",
      "python",
      "/h/openidea_science_profile.py",
      "/o",
      "-m",
      "pkg",
    ]);
  });

  it("selects the capture backend and keeps the configuration's PYTHONPATH", () => {
    const env = plotsLaunch(config({ env: { PYTHONPATH: "src", A: "1" } }), "/h", "/out").env;
    expect(env).toEqual({
      PYTHONPATH: "/h:src",
      A: "1",
      MPLBACKEND: "module://openidea_mpl_backend",
      OPENIDEA_PLOTS_DIR: "/out",
    });
    expect(plotsLaunch(config({}), "/h", "/out", ";").env.PYTHONPATH).toBe("/h");
  });

  it("reads the capture's list, skipping what isn't an image", () => {
    const jsonl =
      '{"file": "0001-figure-1.png", "title": "Sine", "reason": "show"}\n{"skipped": "0002.png", "reason": "big"}\n{"fi';
    expect(readPlots(jsonl)).toEqual([{ file: "0001-figure-1.png", title: "Sine", reason: "show" }]);
  });
});
