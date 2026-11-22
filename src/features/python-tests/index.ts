/**
 * Python Tests (FORK.md, PyIdea's test explorer): collects pytest, unittest and doctest tests
 * before they run, runs and debugs any group of them, shows failures with their source and
 * values, watches for changes to run the related tests, and runs doctests from the gutter or
 * one example from the editor's context menu.
 */
import { activeEditor, onEditorEvent, registerEditorContribution } from "@/editor/api";
import { registerActions } from "@/platform/actions";
import { getContext } from "@/platform/context";
import { tx } from "@/platform/i18n";
import { call, commands, isTauri, onIdeEvent } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { lazyComponent } from "@/ui";
import { registerMenuGroup, registerToolWindow, showStatusInfo, toolWindowService } from "@/workbench/contributions";
import { examplePromptLine } from "./doctest";
import { pythonTestsGutter } from "./gutter";
import { collect, failedIds, idsInFiles, runDoctestExample, runTests, stopRun } from "./runner";
import { markStale, resetForRoot, setPrefs, usePythonTests } from "./store";
import { TOOL_WINDOW } from "./ui/toolWindow";
import { WatchScheduler } from "./watch";

/** Files whose change can affect tests: Python sources and the runner's configuration. */
const WATCHED = /\.(py|pyi)$|(?:^|\/)(?:pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini)$/;

function useFailureBadge(): number | null {
  return usePythonTests((s) => s.tests.filter((t) => s.status[t.id] === "failed").length || null);
}

function activeFile(): string | null {
  return activeEditor()?.ctx.path ?? null;
}

function activeDoctestPrompt(): { file: string; line: number } | null {
  const editor = activeEditor();
  if (!editor || editor.ctx.language !== "python") return null;
  const state = editor.view.state;
  const line = state.doc.lineAt(state.selection.main.head).number - 1;
  const prompt = examplePromptLine(state.doc.toString(), line);
  return prompt ? { file: editor.ctx.path, line: prompt } : null;
}

async function runExample(debug: boolean) {
  const target = activeDoctestPrompt();
  if (!target) {
    showStatusInfo(tx("Put the caret on a doctest example's >>> line"));
    return;
  }
  await runDoctestExample(target.file, target.line, debug);
  const result = Object.values(usePythonTests.getState().results).find(
    (r) => r.id.endsWith(`:${target.line}`) && r.id.startsWith(`${target.file}::`),
  );
  if (result) showStatusInfo(result.outcome === "passed" ? tx("Doctest example passed") : tx("Doctest example failed"));
}

function activateActions(): () => void {
  return registerActions([
    {
      id: "pythonTests.open",
      title: "Open Python Tests",
      category: "Tools",
      when: "projectOpen",
      run: () => toolWindowService().show(TOOL_WINDOW, true),
    },
    {
      id: "pythonTests.runAll",
      title: "Run All Python Tests",
      category: "Run",
      when: "projectOpen",
      run: async () => {
        if (usePythonTests.getState().fresh) await collect();
        await runTests([]);
      },
    },
    {
      id: "pythonTests.runFile",
      title: "Run Python Tests in File",
      category: "Run",
      when: "projectOpen && editorLangId == python",
      run: async () => {
        const file = activeFile();
        if (!file) return;
        if (usePythonTests.getState().fresh) await collect();
        const ids = idsInFiles([file]);
        if (ids.length) await runTests(ids);
        else showStatusInfo(tx("No collected tests in this file"));
      },
    },
    {
      id: "pythonTests.runRelated",
      title: "Run Related Python Tests",
      category: "Run",
      when: "projectOpen && editorLangId == python",
      run: async () => {
        const file = activeFile();
        if (!file || !isTauri()) return;
        if (usePythonTests.getState().fresh) await collect();
        const related = await call(commands.pyideaTestsRelated([file]));
        if (related.refresh) await collect();
        const ids = idsInFiles(related.testFiles);
        if (ids.length) await runTests(ids);
        else usePythonTests.setState({ noRelated: [file] });
      },
    },
    {
      id: "pythonTests.rerunFailed",
      title: "Rerun Failed Python Tests",
      category: "Run",
      when: "projectOpen",
      run: () => {
        const ids = failedIds();
        if (ids.length) void runTests(ids);
      },
    },
    {
      id: "pythonTests.refresh",
      title: "Refresh Python Tests",
      category: "Run",
      when: "projectOpen",
      run: () => collect(),
    },
    {
      id: "pythonTests.stop",
      title: "Stop Python Tests",
      category: "Run",
      when: "projectOpen",
      run: () => stopRun(),
    },
    {
      id: "pythonTests.toggleWatch",
      title: "Watch Related Python Tests",
      category: "Run",
      when: "projectOpen",
      toggled: () => usePythonTests.getState().watch,
      run: () => setPrefs({ watch: !usePythonTests.getState().watch }),
    },
    {
      id: "pythonTests.runDoctestExample",
      title: "Run Doctest Example",
      category: "Run",
      when: "editorLangId == python",
      run: () => runExample(false),
    },
    {
      id: "pythonTests.debugDoctestExample",
      title: "Debug Doctest Example",
      category: "Run",
      when: "editorLangId == python",
      run: () => runExample(true),
    },
  ]);
}

/** Saves and external changes feed the related-test watch; edits make results stale. */
function activateWatch(): () => void {
  const watch = new WatchScheduler({
    relate: async (changed) => {
      const r = await call(commands.pyideaTestsRelated(changed));
      return { files: r.testFiles, refresh: r.refresh };
    },
    collect: () => collect(),
    run: (files) => runTests(idsInFiles(files)),
    nothingRelated: (changed) => usePythonTests.setState({ noRelated: changed }),
  });
  const watching = () => {
    const s = usePythonTests.getState();
    return isTauri() && s.watch && !s.fresh && s.tests.length > 0;
  };
  const offEditor = onEditorEvent((e) => {
    if (e.type === "docSaved" && WATCHED.test(e.path) && watching()) watch.changed([e.path]);
    if (e.type === "docChanged" && e.path.endsWith(".py")) markStale(e.path);
  });
  const offFs = onIdeEvent("fsChanged", (e) => {
    if (!watching()) return;
    const paths = [...e.created, ...e.modified, ...e.removed].filter((p) => WATCHED.test(p));
    if (paths.length) watch.changed(paths);
  });
  // Stop drops pending watch work too.
  const offStop = usePythonTests.subscribe((s, prev) => {
    if (!s.watch && prev.watch) watch.stop();
  });
  return () => {
    offStop();
    offFs();
    offEditor();
    watch.dispose();
  };
}

/** Opening an editor reveals its related tests (without running them). */
function activateRelatedReveal(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const off = onEditorEvent((e) => {
    if (e.type !== "activeEditorChanged" || !e.path?.endsWith(".py")) return;
    const path = e.path;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const s = usePythonTests.getState();
      if (!isTauri() || s.fresh || !s.tests.length) return;
      if (s.tests.some((t) => t.file === path)) {
        usePythonTests.setState({ related: [path] });
        return;
      }
      try {
        const related = await call(commands.pyideaTestsRelated([path]));
        usePythonTests.setState({ related: related.testFiles });
      } catch {
        // Related tests are a convenience; the panel works without them.
      }
    }, 300);
  });
  return () => {
    if (timer) clearTimeout(timer);
    off();
  };
}

export function activate(): () => void {
  resetForRoot(useProject.getState().project?.root ?? null);
  const offRoot = useProject.subscribe((s, prev) => {
    const root = s.project?.root ?? null;
    if (root !== (prev.project?.root ?? null)) resetForRoot(root);
  });
  const disposers = [
    offRoot,
    registerToolWindow({
      id: TOOL_WINDOW,
      title: "Python Tests",
      icon: "toolwindow-run",
      anchor: "left",
      order: 40,
      requiresProject: true,
      component: lazyComponent(() => import("./ui/PythonTestsView").then((m) => m.PythonTestsView)),
      useBadge: useFailureBadge,
    }),
    activateActions(),
    activateWatch(),
    activateRelatedReveal(),
    registerEditorContribution({ id: "pythonTests.gutter", order: 66, extensions: pythonTestsGutter }),
    registerMenuGroup({
      id: "pythonTests.editor",
      menus: ["editor"],
      order: 46,
      items: () =>
        getContext().editorLangId === "python" && activeDoctestPrompt()
          ? [
              { kind: "action", action: "pythonTests.runDoctestExample" },
              { kind: "action", action: "pythonTests.debugDoctestExample" },
            ]
          : [],
    }),
  ];
  return () => disposers.reverse().forEach((d) => d());
}
