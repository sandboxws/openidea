/**
 * PyIdea's local web frameworks (FORK.md): Flask, FastAPI and Django Server run
 * configurations, and Discover Web Applications to create them from the project's files.
 */
import { registerActions } from "@/platform/actions";
import { call, commands, isTauri, onIdeEvent } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { registerRunConfigType } from "@/workbench/contributions";
import { discoverWebApps } from "./discover";
import { setProjectPython, WEB_TYPES } from "./types";

/** Keeps the project interpreter that new configurations default to. */
function trackProjectPython(): () => void {
  let generation = 0;
  const refresh = () => {
    const root = useProject.getState().project?.root;
    const current = ++generation;
    if (!root || !isTauri()) return setProjectPython(null);
    void call(commands.sdkPythonEffective(root))
      .catch(() => null)
      .then((python) => current === generation && setProjectPython(python));
  };
  refresh();
  const offRoot = useProject.subscribe((s, prev) => s.project?.root !== prev.project?.root && refresh());
  const offSettings = onIdeEvent("settingsChanged", refresh);
  return () => {
    generation++;
    offRoot();
    offSettings();
  };
}

export function activate(): () => void {
  const disposers = [
    trackProjectPython(),
    ...WEB_TYPES.map((t) => registerRunConfigType(t)),
    registerActions([
      {
        id: "pythonWeb.discover",
        title: "Discover Web Applications",
        category: "Tools",
        when: "projectOpen",
        keywords: ["django", "flask", "fastapi", "uvicorn", "server", "run configuration"],
        run: () => discoverWebApps(),
      },
    ]),
  ];
  return () => disposers.reverse().forEach((d) => d());
}
