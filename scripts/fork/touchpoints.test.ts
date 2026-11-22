import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify, duplicateKeys, globToRegExp, missingContracts, parseNumstat, type Config } from "./touchpoints.ts";

const config: Config = {
  owned: ["FORK.md", "src/features/gruvppuccin/**", "plugins/gruvppuccin/**"],
  generated: ["src/bindings.ts"],
  shared: { "src/features/index.ts": 3 },
  catalogs: [],
  contracts: [],
};

describe("globToRegExp", () => {
  it("lets ** span directories and * stay within one segment", () => {
    expect(globToRegExp("src/features/gruvppuccin/**").test("src/features/gruvppuccin/ui/Page.tsx")).toBe(true);
    expect(globToRegExp("plugins/*/plugin.toml").test("plugins/gruvppuccin/plugin.toml")).toBe(true);
    expect(globToRegExp("plugins/*/plugin.toml").test("plugins/official/x/plugin.toml")).toBe(false);
    expect(globToRegExp("crates/**/tests/*.rs").test("crates/tests/a.rs")).toBe(true);
    expect(globToRegExp("FORK.md").test("FORKxmd")).toBe(false);
  });
});

describe("parseNumstat", () => {
  it("reads plain, binary and renamed entries", () => {
    const out = "3\t1\tsrc/a.ts\0-\t-\ticon.png\0" + "2\t0\t\0old/b.ts\0new/b.ts\0";
    expect(parseNumstat(out)).toEqual([
      { path: "src/a.ts", lines: 4 },
      { path: "icon.png", lines: null },
      { path: "new/b.ts", lines: 2 },
    ]);
  });
});

describe("classify", () => {
  it("accepts owned and generated files and shared files within budget", () => {
    const changes = [
      { path: "FORK.md", lines: 400 },
      { path: "src/features/gruvppuccin/index.ts", lines: 90 },
      { path: "src/bindings.ts", lines: 800 },
      { path: "src/features/index.ts", lines: 3 },
    ];
    expect(classify(changes, config)).toEqual([]);
  });

  it("flags unlisted upstream files and shared files over budget", () => {
    const changes = [
      { path: "src/styles/tokens.css", lines: 2 },
      { path: "src/features/index.ts", lines: 5 },
      { path: "src/features/index.ts", lines: null },
    ];
    expect(classify(changes, config)).toEqual([
      { kind: "unlisted", path: "src/styles/tokens.css", lines: 2 },
      { kind: "over-budget", path: "src/features/index.ts", lines: 5, budget: 3 },
      { kind: "over-budget", path: "src/features/index.ts", lines: Infinity, budget: 3 },
    ]);
  });
});

describe("duplicateKeys", () => {
  it("finds top-level keys added twice", () => {
    const json = '{\n  "Run": "Run",\n  "Say \\"hi\\"": "x",\n  "Stop": "Stop",\n  "Run": "Run"\n}\n';
    expect(duplicateKeys(json)).toEqual(["Run"]);
  });

  it("finds none in the shipped catalogs", () => {
    for (const path of ["src/platform/locales/text/en.json", "src/platform/locales/text/zh.json"])
      expect(duplicateKeys(readFileSync(path, "utf8"))).toEqual([]);
  });
});

describe("missingContracts", () => {
  it("lists ids no longer registered", () => {
    expect(missingContracts(["run.pluginStart", "gone.action"], (id) => id === "run.pluginStart")).toEqual([
      "gone.action",
    ]);
  });
});

describe("touchpoints.json", () => {
  it("is a valid config", () => {
    const json = JSON.parse(readFileSync("scripts/fork/touchpoints.json", "utf8")) as Config;
    expect(Array.isArray(json.owned) && Array.isArray(json.generated) && Array.isArray(json.contracts)).toBe(true);
    for (const budget of Object.values(json.shared)) expect(Number.isInteger(budget) && budget > 0).toBe(true);
  });
});
