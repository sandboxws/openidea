import { describe, expect, it } from "vitest";
import type { PythonCollectedTest } from "@/platform/ipc";
import { buildTree, filterTree, flatten, groupStatus, statusOf } from "../model";

const t = (id: string, file: string, symbol: string, line = 0): PythonCollectedTest => ({
  id,
  file,
  name: id.split("::").slice(1).join("::") || symbol,
  line,
  symbol,
  params: null,
});

const TESTS = [
  t("tests/test_pricing.py::test_discounted[100-10-90]", "/p/tests/test_pricing.py", "test_discounted", 6),
  t("tests/test_pricing.py::test_discounted[80-25-60]", "/p/tests/test_pricing.py", "test_discounted", 6),
  t(
    "tests/test_pricing.py::TestRounding::test_rounds_to_cents",
    "/p/tests/test_pricing.py",
    "TestRounding.test_rounds_to_cents",
    11,
  ),
  t("tests/api/test_users.py::test_list", "/p/tests/api/test_users.py", "test_list", 2),
];

describe("buildTree", () => {
  const tree = buildTree(TESTS, "/p");

  it("groups by directory, file, class and function, with parameter cases", () => {
    const tests = tree[0]!;
    expect(tests).toMatchObject({ kind: "dir", label: "tests" });
    expect(tests.children.map((c) => c.label)).toEqual(["test_pricing.py", "api"]);
    const pricing = tests.children[0]!;
    expect(pricing.children.map((c) => [c.kind, c.label])).toEqual([
      ["function", "test_discounted"],
      ["class", "TestRounding"],
    ]);
    const discounted = pricing.children[0]!;
    expect(discounted.children.map((c) => [c.kind, c.label, c.id])).toEqual([
      ["case", "[100-10-90]", "tests/test_pricing.py::test_discounted[100-10-90]"],
      ["case", "[80-25-60]", "tests/test_pricing.py::test_discounted[80-25-60]"],
    ]);
    expect(discounted.id).toBeUndefined();
    const method = pricing.children[1]!.children[0]!;
    expect(method).toMatchObject({ kind: "function", label: "test_rounds_to_cents", line: 11 });
    expect(method.id).toBe("tests/test_pricing.py::TestRounding::test_rounds_to_cents");
  });

  it("collects every test id below each group", () => {
    expect(tree[0]!.ids).toHaveLength(4);
    expect(tree[0]!.children[0]!.ids).toHaveLength(3);
    expect(flatten(tree).filter((n) => n.ids.length === 1 && n.id)).toHaveLength(4);
  });

  it("keeps only branches with matching tests when filtered", () => {
    const failed = new Set(["tests/api/test_users.py::test_list"]);
    const only = filterTree(tree, (id) => failed.has(id));
    expect(flatten(only).map((n) => n.label)).toEqual(["tests", "api", "test_users.py", "test_list"]);
  });
});

describe("status", () => {
  it("maps outcomes like pytest", () => {
    expect(statusOf("xfailed")).toBe("passed");
    expect(statusOf("xpassed")).toBe("failed");
    expect(statusOf("error")).toBe("failed");
  });

  it("gives a group its worst status, passing only when every case ran", () => {
    expect(groupStatus(["passed", "failed", "running"])).toBe("failed");
    expect(groupStatus(["passed", "running"])).toBe("running");
    expect(groupStatus(["passed", "idle"])).toBe("idle");
    expect(groupStatus(["passed", "skipped"])).toBe("passed");
    expect(groupStatus(["skipped", "skipped"])).toBe("skipped");
    expect(groupStatus(["passed", "stale"])).toBe("stale");
    expect(groupStatus([])).toBe("idle");
  });
});
