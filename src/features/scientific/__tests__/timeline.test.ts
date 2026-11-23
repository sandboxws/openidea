import { describe, expect, it } from "vitest";
import type { RunConfig } from "@/platform/ipc";
import { timelineLaunch } from "../program";
import { functionColor, readTimeline, topFunction } from "../timeline";

const JSONL = [
  '{"t": 0, "threads": [{"id": 1, "name": "MainThread", "frames": [["/p/a.py", 3, "select"]]}], "tasks": []}',
  '{"t": 20, "threads": [{"id": 1, "name": "MainThread", "frames": [["/p/a.py", 3, "select"]]}, {"id": 2, "name": "worker", "frames": [["/p/a.py", 9, "crunch"], ["/p/a.py", 12, "worker"]]}], "tasks": [{"id": 7, "name": "Task-2", "coro": "fetch", "thread": "MainThread", "frames": [["/p/a.py", 15, "fetch"]]}]}',
  "{broken",
  '{"t": 40, "threads": [{"id": 2, "name": "worker", "frames": []}]}',
].join("\n");

describe("thread timeline", () => {
  it("arranges samples in thread lanes, then task lanes", () => {
    const t = readTimeline(JSONL);
    expect(t.times).toEqual([0, 20, 40]);
    expect(t.lanes.map((l) => [l.kind, l.label, l.first, l.last, l.observations.size])).toEqual([
      ["thread", "MainThread", 0, 1, 2],
      ["thread", "worker", 1, 2, 2],
      ["task", "Task-2", 1, 1, 1],
    ]);
    expect(t.lanes[2]!.detail).toBe("fetch · MainThread");
    expect(topFunction(t.lanes[1]!.observations.get(1))).toBe("crunch");
    expect(topFunction(t.lanes[1]!.observations.get(2))).toBe("");
  });

  it("colors a function the same way every time", () => {
    expect(functionColor("crunch")).toBe(functionColor("crunch"));
    expect(functionColor("crunch")).toMatch(/^color-mix\(in srgb, var\(--ansi-[a-z]+\) 55%, transparent\)$/);
  });

  it("runs the program under the timeline helper", () => {
    const config = {
      kind: "python",
      command: "python",
      args: ["-X", "dev", "app.py", "--n"],
      env: {},
    } as unknown as RunConfig;
    expect(timelineLaunch(config, "/h", "/o").args).toEqual([
      "-X",
      "dev",
      "/h/openidea_science_timeline.py",
      "/o",
      "app.py",
      "--n",
    ]);
  });
});
