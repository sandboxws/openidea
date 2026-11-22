/**
 * Python Tests state: the collection, each test's status and last result, the active run, and
 * the panel's per-project preferences (framework, failures filter, related-test watch), which
 * are kept in localStorage by project root.
 */
import { create } from "zustand";
import type { PythonCollectedTest, PythonTestFramework, PythonTestResult } from "@/platform/ipc";
import type { TestStatus } from "./model";

export interface ActiveRun {
  ids: string[];
  debug: boolean;
  /** Run configuration id, to find and stop its process. */
  configId: string;
  /** The events stream's request id. */
  request: number;
}

export interface Prefs {
  framework: PythonTestFramework;
  failuresOnly: boolean;
  /** Related-test watch; on once the panel first opens. */
  watch: boolean;
}

export const DEFAULT_PREFS: Prefs = { framework: "pytest", failuresOnly: false, watch: true };

export interface PythonTestsState extends Prefs {
  root: string | null;
  tests: PythonCollectedTest[];
  errors: string[];
  interpreter: string | null;
  /** Never collected in this window yet. */
  fresh: boolean;
  collecting: boolean;
  collectError: string | null;
  status: Record<string, TestStatus>;
  results: Record<string, PythonTestResult>;
  run: ActiveRun | null;
  selected: string | null;
  /** Test files related to the active editor (revealed, not run). */
  related: string[];
  /** The last watch found nothing to run for these files. */
  noRelated: string[] | null;
}

export const usePythonTests = create<PythonTestsState>(() => ({
  ...DEFAULT_PREFS,
  root: null,
  tests: [],
  errors: [],
  interpreter: null,
  fresh: true,
  collecting: false,
  collectError: null,
  status: {},
  results: {},
  run: null,
  selected: null,
  related: [],
  noRelated: null,
}));

const PREFIX = "openidea.pythonTests.v1:";

export function readPrefs(root: string): Prefs {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(PREFIX + root) ?? "null") as Partial<Prefs> | null;
    const framework = raw?.framework;
    return {
      framework: framework === "unittest" || framework === "doctest" ? framework : "pytest",
      failuresOnly: raw?.failuresOnly === true,
      watch: raw?.watch !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setPrefs(patch: Partial<Prefs>) {
  usePythonTests.setState(patch);
  const s = usePythonTests.getState();
  if (!s.root) return;
  try {
    const prefs: Prefs = { framework: s.framework, failuresOnly: s.failuresOnly, watch: s.watch };
    globalThis.localStorage?.setItem(PREFIX + s.root, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: the preference lasts for this session.
  }
}

/** Switches to another project's state (or none). */
export function resetForRoot(root: string | null) {
  usePythonTests.setState({
    ...(root ? readPrefs(root) : DEFAULT_PREFS),
    root,
    tests: [],
    errors: [],
    interpreter: null,
    fresh: true,
    collecting: false,
    collectError: null,
    status: {},
    results: {},
    run: null,
    selected: null,
    related: [],
    noRelated: null,
  });
}

/** Marks the results of tests in `file` stale (the file was edited since they ran). */
export function markStale(file: string) {
  const s = usePythonTests.getState();
  let changed = false;
  const status = { ...s.status };
  for (const t of s.tests) {
    if (t.file !== file) continue;
    const current = status[t.id];
    if (current === "passed" || current === "failed") {
      status[t.id] = "stale";
      changed = true;
    }
  }
  if (changed) usePythonTests.setState({ status });
}
