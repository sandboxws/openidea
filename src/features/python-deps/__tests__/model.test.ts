import { describe, expect, it } from "vitest";
import type { PythonDependencyModel } from "@/platform/ipc";
import { changeKind, compareVersions, editLabel, formatGroups, groupLabel, parseGroups } from "../model";
import { buildTree, findNode, versionText } from "../tree";

describe("labels", () => {
  it("names groups and staged edits", () => {
    expect(groupLabel({ kind: "extra", name: "docs" })).toBe("Extra: docs");
    expect(groupLabel({ kind: "runtime", name: "" })).toBe("Runtime");
    expect(editLabel({ op: "add", group: { kind: "group", name: "test" }, requirement: "pytest>=8" })).toBe(
      "Add pytest>=8 to Group: test",
    );
    expect(editLabel({ op: "upgrade", package: "flask" })).toBe("Upgrade flask");
    expect(editLabel({ op: "replace", group: { kind: "runtime", name: "" }, requirement: "a>=1", with: "a>=2" })).toBe(
      "Change a>=1 to a>=2",
    );
  });
});

describe("sync selection", () => {
  it("reads groups like PyIdea: blank for defaults, - for none", () => {
    expect(parseGroups("  ")).toBeNull();
    expect(parseGroups("-")).toEqual([]);
    expect(parseGroups("test, lint docs")).toEqual(["test", "lint", "docs"]);
    expect(formatGroups(null)).toBe("");
    expect(formatGroups([])).toBe("-");
    expect(formatGroups(["a", "b"])).toBe("a, b");
  });
});

describe("environment changes", () => {
  it("tells upgrades from downgrades", () => {
    expect(compareVersions("0.165.0", "0.163.1")).toBeGreaterThan(0);
    expect(compareVersions("1.10", "1.9")).toBeGreaterThan(0);
    expect(changeKind({ name: "a", before: null, after: "1" })).toBe("install");
    expect(changeKind({ name: "a", before: "1", after: null })).toBe("remove");
    expect(changeKind({ name: "a", before: "0.165.0", after: "0.163.1" })).toBe("downgrade");
    expect(changeKind({ name: "a", before: "1.0", after: "1.0" })).toBe("reinstall");
  });
});

describe("tree", () => {
  const model: PythonDependencyModel = {
    path: "/p/pyproject.toml",
    projectName: "p",
    groups: [
      {
        group: { kind: "runtime", name: "" },
        requirements: [
          { text: "flask>=3", package: "flask", from: 10, to: 18, staged: false },
          { text: "httpx", package: "httpx", from: null, to: null, staged: true },
        ],
        includes: [],
      },
      {
        group: { kind: "build", name: "" },
        requirements: [{ text: "hatchling", package: "hatchling", from: 40, to: 49, staged: false }],
        includes: [],
      },
    ],
    editError: null,
    packages: [
      { name: "flask", locked: ["3.1.3"], installed: "3.1.3", direct: true, why: ["p", "flask"] },
      { name: "werkzeug", locked: ["3.1.3"], installed: null, direct: false, why: ["p", "flask", "werkzeug"] },
    ],
    lock: "/p/uv.lock",
    interpreter: null,
    environment: null,
    uv: null,
  };

  it("lists groups, staged requirements and transitive packages", () => {
    const roots = buildTree(model);
    expect(roots.map((r) => [r.label, r.detail])).toEqual([
      ["Runtime", "2"],
      ["Build requirements", "1"],
      ["Transitive packages", "1"],
    ]);
    const [flask, httpx] = roots[0]!.children;
    expect(flask!.detail).toBe("locked 3.1.3 · installed 3.1.3");
    expect([httpx!.detail, httpx!.icon]).toEqual(["staged", "plus"]);
    expect(roots[1]!.children[0]!.detail).toBeUndefined();
    const werkzeug = findNode(roots, "pkg:werkzeug");
    expect(werkzeug?.package?.why).toEqual(["p", "flask", "werkzeug"]);
    expect(versionText(werkzeug?.package)).toBe("locked 3.1.3 · not installed");
  });
});
