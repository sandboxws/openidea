/** Running, debugging, building and formatting Mojo files with the project's SDK. */
import type { EditorView } from "@codemirror/view";
import { activeEditor } from "@/editor/api";
import { executeAction } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { call, commands, nextRequestId, type RunConfig } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { notifications, showStatusInfo } from "@/workbench/contributions";
import { defaultOutput, relative, stem } from "./paths";
import { syncMojoSetup } from "./setup";
import { MOJO_KIND } from "./types";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const isMojoFile = (path: string | null | undefined) => !!path && /\.(mojo|🔥)$/u.test(path);

/** A Mojo Application configuration for `path` that builds with debug info before launching. */
export async function mojoConfig(path: string): Promise<RunConfig> {
  const root = useProject.getState().project?.root ?? "";
  const rel = relative(path, root);
  const output = defaultOutput(rel);
  const line = await call(commands.pyideaMojoBuildLine(path, `${root}/${output}`, [], true));
  return {
    id: `mojo:${rel}`,
    name: `${stem(rel)}.mojo`,
    kind: MOJO_KIND,
    command: output,
    args: [],
    cwd: null,
    env: {},
    detected: false,
    isTest: false,
    debugAdapter: "lldb-dap",
    params: { source: rel, programArgs: "", compilerArgs: "", output },
    beforeLaunch: [{ kind: "command", target: line }],
  };
}

/** Runs or debugs the Mojo file `path` (its `main`). */
export async function runMojoFile(path: string, debug = false): Promise<void> {
  try {
    await syncMojoSetup();
    const config = await mojoConfig(path);
    await executeAction(
      debug ? "run.debugConfig" : "run.runConfig",
      debug ? { config, temporary: true, show: true } : { config },
    );
  } catch (e) {
    notifications().notify({ group: "run", level: "error", title: tx("Cannot run the Mojo file"), body: message(e) });
  }
}

/** Build Mojo File: compiles the active Mojo file (with debug info) into `.openidea/mojo/bin`. */
export async function buildActiveFile(): Promise<void> {
  const path = activeEditor()?.ctx.path;
  if (!isMojoFile(path)) {
    showStatusInfo(tx("Open a Mojo file to build it"));
    return;
  }
  const root = useProject.getState().project?.root ?? "";
  const output = `${root}/${defaultOutput(relative(path!, root))}`;
  showStatusInfo(tx("Building with Mojo…"));
  try {
    const result = await call(commands.pyideaMojoBuild(path!, output, [], true, nextRequestId()));
    const binary = relative(output, root);
    if (result.ok) showStatusInfo(tx`Built ${binary}`);
    else
      notifications().notify({
        group: "run",
        level: "error",
        title: tx("Mojo build failed"),
        body: result.output.trim(),
      });
  } catch (e) {
    notifications().notify({ group: "run", level: "error", title: tx("Mojo build failed"), body: message(e) });
  }
}

/** The single change turning `before` into `after` (common prefix and suffix kept). */
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/** Reformat Mojo File: `mojo format` on a copy, applied as one undoable edit unless the text changed meanwhile. */
export async function formatMojo(view: EditorView, path: string): Promise<void> {
  const before = view.state.doc.toString();
  try {
    const formatted = await call(commands.pyideaMojoFormat(path, before, nextRequestId()));
    if (view.state.doc.toString() !== before) {
      showStatusInfo(tx("The file changed while it was formatted; format it again"));
      return;
    }
    const change = minimalChange(before, formatted);
    if (change) view.dispatch({ changes: change, userEvent: "format" });
  } catch (e) {
    notifications().notify({ group: "run", level: "error", title: tx("Mojo format failed"), body: message(e) });
  }
}
