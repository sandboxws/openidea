/**
 * Collects and runs Python tests. Runs start as ordinary run configurations (output in the Run
 * tool window, Debug through debugpy); the reporting helper streams each result back here.
 * pytest runs are `pytest` test configurations, so the Run tool window's test tree and the
 * editor gutter show their results too.
 */
import { Channel } from "@tauri-apps/api/core";
import { executeAction } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import {
  call,
  commands,
  isTauri,
  nextRequestId,
  type RunConfig,
  type PythonTestFramework,
  type PythonTestEvent,
} from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { showStatusInfo } from "@/workbench/contributions";
import { statusOf, type TestStatus } from "./model";
import { usePythonTests } from "./store";

const CONFIG_ID = "python-tests";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Collects the project's tests with the panel's framework. pytest missing falls back to unittest. */
export async function collect(): Promise<void> {
  const s = usePythonTests.getState();
  if (!isTauri() || !s.root || s.collecting) return;
  usePythonTests.setState({ collecting: true, collectError: null });
  const request = nextRequestId();
  try {
    const result = await call(
      commands.pyideaTestsCollect({ framework: s.framework, interpreter: null, args: [], env: {} }, request),
    );
    if (usePythonTests.getState().root !== s.root) return;
    const noPytest =
      s.framework === "pytest" && !result.tests.length && result.errors.some((e) => /No module named '?pytest/.test(e));
    const ids = new Set(result.tests.map((t) => t.id));
    const status: Record<string, TestStatus> = {};
    for (const [id, st] of Object.entries(usePythonTests.getState().status)) if (ids.has(id)) status[id] = st;
    usePythonTests.setState({
      tests: result.tests,
      errors: result.errors,
      interpreter: result.interpreter,
      fresh: false,
      status,
      collecting: false,
    });
    if (noPytest) {
      usePythonTests.setState({ framework: "unittest", collecting: false });
      return collect();
    }
  } catch (e) {
    if (usePythonTests.getState().root === s.root)
      usePythonTests.setState({ collecting: false, fresh: false, collectError: message(e) });
  }
}

function handle(event: PythonTestEvent) {
  usePythonTests.setState((s) => {
    switch (event.event) {
      case "started":
        return { status: { ...s.status, [event.id]: "running" } };
      case "result":
        return {
          status: { ...s.status, [event.id]: statusOf(event.outcome) },
          results: { ...s.results, [event.id]: event },
        };
      default:
        return {};
    }
  });
}

export interface RunOptions {
  debug?: boolean;
  framework?: PythonTestFramework;
  /** One doctest example: its file and the 1-based line of its `>>>` prompt. */
  example?: { file: string; line: number };
}

/** Runs `ids` (every collected test when empty); resolves when the run ends. */
export async function runTests(ids: readonly string[], opts: RunOptions = {}): Promise<void> {
  const s = usePythonTests.getState();
  const root = useProject.getState().project?.root;
  if (!isTauri() || !root || s.run) return;
  const framework = opts.framework ?? s.framework;
  let prepared;
  try {
    prepared = await call(
      commands.pyideaTestsPrepare({
        framework,
        interpreter: s.interpreter,
        ids: [...ids],
        args: [],
        env: {},
        cwd: null,
        example: opts.example ?? null,
      }),
    );
  } catch (e) {
    showStatusInfo(tx`Cannot run Python tests: ${message(e)}`);
    return;
  }
  const request = nextRequestId();
  const targets = ids.length ? [...ids] : opts.example ? [] : s.tests.map((t) => t.id);
  usePythonTests.setState((st) => {
    const status = { ...st.status };
    for (const id of targets) status[id] = "queued";
    return { run: { ids: targets, debug: !!opts.debug, configId: CONFIG_ID, request }, status, noRelated: null };
  });
  const config: RunConfig = {
    id: CONFIG_ID,
    name: "Python Tests",
    kind: framework === "pytest" ? "pytest" : "python",
    command: prepared.interpreter,
    args: prepared.args,
    cwd: prepared.cwd,
    env: prepared.env,
    detected: false,
    isTest: framework === "pytest",
    debugAdapter: "debugpy",
  };
  const channel = new Channel<PythonTestEvent>();
  channel.onmessage = handle;
  const stream = call(commands.pyideaTestsEvents(prepared.events, request, channel)).catch(() => {});
  // The stream also ends once the process exits, with whatever it reported.
  const endStream = () => setTimeout(() => void commands.cancelRequest(request), 300);
  const started = opts.debug
    ? await executeAction("run.debugConfig", { config, temporary: true, show: true })
    : await executeAction("run.runConfig", { config, onExit: endStream });
  if (!started) endStream();
  await stream;
  usePythonTests.setState((st) => {
    // Tests the run never reached keep no result.
    const status = { ...st.status };
    for (const id of targets) if (status[id] === "queued" || status[id] === "running") status[id] = "idle";
    return { run: null, status };
  });
}

export function runDoctestExample(file: string, line: number, debug = false): Promise<void> {
  return runTests([], { framework: "doctest", example: { file, line }, debug });
}

/** Stops the active run and its result stream. */
export async function stopRun(): Promise<void> {
  const run = usePythonTests.getState().run;
  if (!run || !isTauri()) return;
  const runs = await commands.runList();
  for (const r of runs) if (r.running && r.configId === run.configId) await executeAction("run.stopProcess", r.id);
  void commands.cancelRequest(run.request);
}

/** Ids of the collected tests in `files`. */
export function idsInFiles(files: readonly string[]): string[] {
  const wanted = new Set(files);
  return usePythonTests
    .getState()
    .tests.filter((t) => wanted.has(t.file))
    .map((t) => t.id);
}

/** The failed tests of the last runs. */
export function failedIds(): string[] {
  const { status, tests } = usePythonTests.getState();
  return tests.filter((t) => status[t.id] === "failed").map((t) => t.id);
}
