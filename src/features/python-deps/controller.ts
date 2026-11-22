/**
 * What the Project Dependencies tool window does: load the model (with the staged edits
 * applied), stage edits, preview them with uv in a copy of the project, write the reviewed
 * files and synchronize the environment in the Run tool window.
 */
import { activeEditor } from "@/editor/api";
import { executeAction } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import {
  call,
  commands,
  isTauri,
  nextRequestId,
  type PythonStagedEdit,
  type PythonSyncCommand,
  type PythonSyncSelection,
  type RunConfig,
} from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { editorService, showStatusInfo, toolWindowService } from "@/workbench/contributions";
import { initialDeps, useDeps } from "./store";

export const TOOL_WINDOW = "pythonDependencies";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The `pyproject.toml` to show: the active editor's, else the project's. */
function chooseManifest(): string | null {
  const active = activeEditor()?.ctx.path;
  if (active?.endsWith("/pyproject.toml")) return active;
  const root = useProject.getState().project?.root;
  return root ? `${root}/pyproject.toml` : null;
}

let modelRequest: number | null = null;

export async function refresh(): Promise<void> {
  const { path, edits } = useDeps.getState();
  if (!path || !isTauri()) return;
  if (modelRequest !== null) void commands.cancelRequest(modelRequest);
  const id = nextRequestId();
  modelRequest = id;
  useDeps.setState({ loading: true });
  try {
    const model = await call(commands.pyideaDepsModel(path, edits, id));
    if (modelRequest === id) useDeps.setState({ model, error: null });
  } catch (e) {
    if (modelRequest === id) useDeps.setState({ error: message(e) });
  } finally {
    if (modelRequest === id) {
      modelRequest = null;
      useDeps.setState({ loading: false });
    }
  }
}

/** Shows the tool window for the active (else the project's) `pyproject.toml`. */
export async function openDependencies(): Promise<void> {
  const path = chooseManifest();
  if (!path) return;
  if (useDeps.getState().path !== path) useDeps.setState({ ...initialDeps(), path });
  toolWindowService().show(TOOL_WINDOW, true);
  await refresh();
}

/** The preview no longer matches what would be applied. */
export function invalidatePreview() {
  if (useDeps.getState().preview) useDeps.setState({ stale: true });
}

export function stage(edit: PythonStagedEdit) {
  useDeps.setState((s) => ({ edits: [...s.edits, edit], tab: "changes" }));
  invalidatePreview();
  void refresh();
}

export function unstage(index: number) {
  useDeps.setState((s) => ({ edits: s.edits.filter((_, i) => i !== index) }));
  invalidatePreview();
  void refresh();
}

export function discardEdits() {
  useDeps.setState({ edits: [], preview: null, stale: false, previewError: null });
  void refresh();
}

export function setSelection(selection: PythonSyncSelection) {
  useDeps.setState({ selection });
  invalidatePreview();
}

let previewRequest: number | null = null;

/** Saves open files (a preview resolves what's on disk), then previews the staged edits. */
export async function previewChanges(): Promise<void> {
  const { path, edits, selection } = useDeps.getState();
  if (!path) return;
  try {
    await editorService().saveAll({ skipUntitled: true });
  } catch {
    /* nothing to save */
  }
  const id = nextRequestId();
  previewRequest = id;
  useDeps.setState({ previewing: true, previewError: null, tab: "changes" });
  try {
    const preview = await call(commands.pyideaDepsPreview(path, edits, selection, id));
    if (previewRequest === id) useDeps.setState({ preview, stale: false });
  } catch (e) {
    if (previewRequest === id) useDeps.setState({ preview: null, previewError: message(e) });
  } finally {
    if (previewRequest === id) {
      previewRequest = null;
      useDeps.setState({ previewing: false });
    }
  }
}

export function cancelPreview() {
  if (previewRequest !== null) void commands.cancelRequest(previewRequest);
}

export function viewFileDiffs() {
  const { preview, path } = useDeps.getState();
  if (!preview || !path) return;
  const current = tx("Current");
  const proposed = tx("Proposed");
  if (preview.manifestBefore !== preview.manifestAfter)
    void executeAction("diff.compareTexts", {
      path,
      title: tx("pyproject.toml: proposed changes"),
      left: { text: preview.manifestBefore, label: current },
      right: { text: preview.manifestAfter, label: proposed },
    });
  void executeAction("diff.compareTexts", {
    path: String(preview.lockPath),
    title: tx("uv.lock: proposed changes"),
    left: { text: preview.lockBefore, label: current },
    right: { text: preview.lockAfter, label: proposed },
  });
}

async function runSync(command: PythonSyncCommand): Promise<void> {
  const config: RunConfig = {
    id: "pyidea-deps-sync",
    name: "uv sync",
    kind: "shell",
    command: String(command.command),
    args: command.args,
    cwd: String(command.cwd),
    env: command.env,
    detected: false,
    isTest: false,
    debugAdapter: null,
  };
  useDeps.setState({ syncing: true, synced: null });
  const done = (code?: number | null) => {
    useDeps.setState({ syncing: false, synced: code === 0 ? "ok" : "failed" });
    void refresh();
  };
  const started = await executeAction("run.runConfig", { config, onExit: done });
  if (!started) done(null);
}

/** Writes the previewed manifest and lock, then synchronizes the environment against the lock. */
export async function applyAndSync(): Promise<void> {
  const { preview, stale } = useDeps.getState();
  if (!preview || stale) {
    showStatusInfo(tx("Preview the changes again before applying them"));
    return;
  }
  try {
    const command = await call(commands.pyideaDepsApply(preview.id));
    useDeps.setState({ edits: [], preview: null, stale: false });
    await runSync(command);
  } catch (e) {
    useDeps.setState({ previewError: message(e), stale: true });
  }
}

/** Synchronizes the environment against the lock as it is (after an interrupted sync). */
export async function retrySync(): Promise<void> {
  const { path, selection } = useDeps.getState();
  if (!path) return;
  try {
    await runSync(await call(commands.pyideaDepsSync(path, selection)));
  } catch (e) {
    showStatusInfo(message(e));
  }
}
