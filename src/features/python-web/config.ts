/** Run configurations of discovered web applications. */
import type { PythonWebApp, RunConfig } from "@/platform/ipc";
import { projectPython, WEB_TYPES } from "./types";

/** `path` relative to `root` ("." for `root` itself); other paths as they are. */
export function relative(path: string, root: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path === root ? "." : path;
}

export const LABEL: Record<PythonWebApp["framework"], string> = {
  django: "Django",
  flask: "Flask",
  fastapi: "FastAPI",
};

/**
 * The run configuration of a discovered application, started from its directory on `python`
 * (the interpreter for that directory; kept explicitly when it isn't the project's).
 */
export function configFor(app: PythonWebApp, root: string, python: string | null = null): RunConfig {
  const type = WEB_TYPES.find((t) => t.id === (app.framework === "django" ? "django-server" : app.framework))!;
  const directory = relative(app.directory, root);
  const params: Record<string, string> = { ...type.defaults };
  if (app.framework === "django") params.target = relative(app.target, app.directory);
  else if (app.framework === "flask") params.target = app.factory ? `${app.target}()` : app.target;
  else {
    params.target = app.target;
    if (app.factory) params.factory = "true";
  }
  if (python && python !== projectPython()) params.command = python;
  const line = type.commandLine(params)!;
  const name =
    app.framework === "django"
      ? `${LABEL.django}: ${directory === "." ? relative(app.target, root) : directory}`
      : `${LABEL[app.framework]}: ${params.target}`;
  // The module imports from here: a src/ layout, or a package below the server's directory.
  const pythonPath = relative(app.pythonPath, app.directory);
  return {
    id: `pyidea-web:${app.framework}:${directory}:${app.target}`,
    name,
    kind: type.id,
    command: python ?? line.command,
    args: line.args,
    cwd: directory === "." ? null : directory,
    env: pythonPath === "." ? {} : { PYTHONPATH: pythonPath },
    detected: false,
    isTest: false,
    debugAdapter: "debugpy",
    params,
  };
}
