/**
 * Tools › Discover Web Applications: finds the project's Django, Flask and FastAPI
 * applications from its files (nothing is imported or installed) and creates the chosen one's
 * run configuration.
 */
import { executeAction } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { call, commands, isTauri, type PythonWebApp } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { showContextMenu } from "@/ui";
import { showStatusInfo } from "@/workbench/contributions";
import { configFor, LABEL, relative } from "./config";

const ICON = { django: "project-django", flask: "project-flask", fastapi: "project-fastapi" } as const;

/** A menu row: the framework, what the server runs (`()` marks a factory) and, when it isn't the project, where. */
function appLabel(app: PythonWebApp, root: string): string {
  if (app.framework === "django") return `${LABEL.django}: ${relative(app.target, root)}`;
  const dir = relative(app.directory, root);
  return `${LABEL[app.framework]}: ${app.target}${app.factory ? "()" : ""}${dir === "." ? "" : `  (${dir})`}`;
}

export async function discoverWebApps(): Promise<void> {
  const root = useProject.getState().project?.root;
  if (!isTauri() || !root) return;
  let found;
  try {
    found = await call(commands.pyideaWebDiscover());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    showStatusInfo(tx`Cannot discover web applications: ${message}`);
    return;
  }
  const apps = found.apps ?? [];
  if (!apps.length) {
    showStatusInfo(tx("No Django, Flask or FastAPI applications found"));
    return;
  }
  showContextMenu(
    "center",
    apps.map((app) => ({
      label: appLabel(app, root),
      verbatim: true,
      icon: ICON[app.framework],
      hint: app.file,
      run: () => void create(app, root),
    })),
    { title: tx("Create a Run Configuration") },
  );
}

/** Saves `app`'s configuration on the interpreter of its directory (its own venv, else the project's). */
async function create(app: PythonWebApp, root: string) {
  const python = await call(commands.sdkPythonEffective(app.directory)).catch(() => null);
  await executeAction("run.createConfig", configFor(app, root, python));
}
