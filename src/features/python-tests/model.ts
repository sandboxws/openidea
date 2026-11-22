/**
 * The Python Tests tree: collected tests grouped by directory, file, class and function, with
 * pytest parameter cases under their function, and each group's status from its cases.
 */
import type { PythonCollectedTest, PythonTestOutcome } from "@/platform/ipc";

export type TestStatus = "idle" | "queued" | "running" | "passed" | "failed" | "skipped" | "stale";

export type NodeKind = "dir" | "file" | "class" | "function" | "case";

export interface TestNode {
  /** Unique within the tree: the path of labels. */
  key: string;
  kind: NodeKind;
  label: string;
  /** Absolute file of a file node and everything below it. */
  file?: string;
  /** 0-based line of a test or its function. */
  line?: number;
  /** The runner id of a single test (functions without cases, cases, doctests). */
  id?: string;
  /** Every test id below (or of) this node, in tree order. */
  ids: string[];
  children: TestNode[];
}

/** `outcome` → the status shown; xfail counts as passing, xpass as failing, as pytest does. */
export function statusOf(outcome: PythonTestOutcome): TestStatus {
  switch (outcome) {
    case "passed":
    case "xfailed":
      return "passed";
    case "skipped":
      return "skipped";
    default:
      return "failed";
  }
}

const RANK: Record<TestStatus, number> = {
  failed: 6,
  running: 5,
  queued: 4,
  stale: 3,
  passed: 2,
  skipped: 1,
  idle: 0,
};

/** A group's status: its worst case, but passing only when every case ran and passed or skipped. */
export function groupStatus(statuses: readonly TestStatus[]): TestStatus {
  if (!statuses.length) return "idle";
  let worst: TestStatus = "idle";
  for (const s of statuses) if (RANK[s] > RANK[worst]) worst = s;
  if (worst === "passed" || worst === "skipped") {
    if (statuses.some((s) => s === "idle")) return "idle";
    return statuses.every((s) => s === "skipped") ? "skipped" : "passed";
  }
  return worst;
}

function relative(file: string, root: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

/** `test_total[a-1]` → [`test_total`, `[a-1]`]. */
function splitCase(name: string): [string, string | null] {
  const bracket = name.indexOf("[");
  return bracket > 0 && name.endsWith("]") ? [name.slice(0, bracket), name.slice(bracket)] : [name, null];
}

export function buildTree(tests: readonly PythonCollectedTest[], root: string): TestNode[] {
  const top: TestNode[] = [];
  const byKey = new Map<string, TestNode>();
  const child = (
    parent: TestNode[] | TestNode,
    key: string,
    make: () => Omit<TestNode, "key" | "ids" | "children">,
  ) => {
    let node = byKey.get(key);
    if (!node) {
      node = { key, ids: [], children: [], ...make() };
      byKey.set(key, node);
      (Array.isArray(parent) ? parent : parent.children).push(node);
    }
    return node;
  };
  for (const test of tests) {
    const rel = relative(test.file, root);
    const parts = rel.split("/");
    const fileName = parts.pop()!;
    let level: TestNode[] | TestNode = top;
    const chain: TestNode[] = [];
    let path = "";
    for (const dir of parts) {
      path = path ? `${path}/${dir}` : dir;
      const node = child(level, `d:${path}`, () => ({ kind: "dir", label: dir }));
      chain.push(node);
      level = node;
    }
    const fileNode = child(level, `f:${rel}`, () => ({ kind: "file", label: fileName, file: test.file }));
    chain.push(fileNode);
    // The symbol without the parameter case: `TestCart.test_total`.
    const symbol = (test.symbol || test.name).split("[")[0]!;
    const names = symbol ? symbol.split(".") : [test.name];
    let parent: TestNode = fileNode;
    let key = fileNode.key;
    names.forEach((name, i) => {
      key = `${key}::${name}`;
      const last = i === names.length - 1;
      parent = child(parent, key, () => ({
        kind: last ? "function" : "class",
        label: name,
        file: test.file,
        line: last ? test.line : undefined,
      }));
      chain.push(parent);
    });
    const [, testCase] = splitCase(test.name.split("::").pop() ?? test.name);
    if (testCase) {
      const caseNode = child(parent, `${key}${testCase}`, () => ({
        kind: "case",
        label: testCase,
        file: test.file,
        line: test.line,
        id: test.id,
      }));
      caseNode.ids.push(test.id);
    } else {
      parent.id = test.id;
    }
    for (const node of chain) node.ids.push(test.id);
  }
  return top;
}

/** Depth-first nodes, for lookups and keyboard order. */
export function flatten(nodes: readonly TestNode[], out: TestNode[] = []): TestNode[] {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

/** The tree with only nodes leading to `keep` test ids (the failures-only filter). */
export function filterTree(nodes: readonly TestNode[], keep: (id: string) => boolean): TestNode[] {
  const out: TestNode[] = [];
  for (const n of nodes) {
    if (!n.ids.some(keep)) continue;
    out.push({ ...n, children: filterTree(n.children, keep) });
  }
  return out;
}
