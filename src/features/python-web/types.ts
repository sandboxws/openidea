/**
 * PyIdea's local web server configurations: Flask, FastAPI (Uvicorn) and Django, each one
 * server process without automatic reload (Flask's browser debugger off), so Run and Debug
 * behave like any Python process: put a breakpoint in a request handler, choose Debug and send
 * a request.
 *
 * An empty interpreter means the project's. Upstream swaps a plain `python` for it only in
 * Python configurations, so these types write the interpreter into the command (Debug reads
 * the saved command) and Run looks it up again at launch.
 */
import { parseArgs } from "@/platform/commandLine";
import { call, commands, type RunConfig } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import type { RunConfigTypeContribution, RunConfigTypeField } from "@/workbench/contributions";

let currentPython: string | null = null;

/** The project interpreter that an empty Interpreter field stands for (null: unknown). */
export const projectPython = () => currentPython;

export function setProjectPython(python: string | null) {
  currentPython = python;
}

/** `cwd` (relative to the project) as an absolute directory. */
function absolute(cwd: string | null | undefined, root: string): string {
  if (!cwd || cwd === ".") return root;
  return /^([\\/]|[A-Za-z]:)/.test(cwd) ? cwd : `${root}/${cwd}`;
}

/**
 * Right before Run: the current project interpreter for the configuration's directory when the
 * field is empty, and output as it happens (upstream does both only for its Python kinds).
 */
async function prepareServer(config: RunConfig): Promise<RunConfig> {
  const env = "PYTHONUNBUFFERED" in config.env ? config.env : { ...config.env, PYTHONUNBUFFERED: "1" };
  const root = useProject.getState().project?.root;
  if (config.params?.command?.trim() || !root) return { ...config, env };
  const python = await call(commands.sdkPythonEffective(absolute(config.cwd, root))).catch(() => null);
  return { ...config, command: python ?? config.command, env };
}

/** Code examples, shown as typed (not prose). */
const EXAMPLE = {
  flask: "webapp:create_app()",
  fastapi: "service.main:app",
  manage: "manage.py",
  settings: "project.settings.dev",
};

const interpreter: RunConfigTypeField = {
  key: "command",
  label: "Interpreter",
  mono: true,
  placeholder: "Project interpreter",
  browse: "file",
};
const host: RunConfigTypeField = { key: "host", label: "Host", mono: true, placeholder: "127.0.0.1", required: true };
const port = (fallback: string): RunConfigTypeField => ({
  key: "port",
  label: "Port",
  mono: true,
  placeholder: fallback,
  required: true,
  validate: (v) => (/^\d{1,5}$/.test(v.trim()) && Number(v) < 65536 ? null : "Enter a port from 0 to 65535"),
});
const extra: RunConfigTypeField = { key: "args", label: "Additional arguments", mono: true };

const command = (p: Record<string, string>) => p.command?.trim() || currentPython || "python";

export const flaskType: RunConfigTypeContribution = {
  id: "flask",
  label: "Flask Server",
  icon: "project-flask",
  description: "Run a Flask application with the development server",
  group: "Python",
  defaults: { host: "127.0.0.1", port: "5000" },
  debugAdapter: "debugpy",
  prepareLaunch: prepareServer,
  fields: [
    {
      key: "target",
      label: "Application",
      mono: true,
      required: true,
      placeholder: EXAMPLE.flask,
      hint: "What `flask --app` takes: a module, `module:app` or `module:factory()`",
    },
    host,
    port("5000"),
    extra,
    interpreter,
  ],
  commandLine(p) {
    const target = p.target?.trim();
    if (!target) return null;
    return {
      command: command(p),
      args: [
        "-m",
        "flask",
        "--app",
        target,
        "run",
        "--host",
        p.host?.trim() || "127.0.0.1",
        "--port",
        p.port?.trim() || "5000",
        "--no-reload",
        "--no-debugger",
        ...parseArgs(p.args ?? ""),
      ],
    };
  },
  paramsFrom: (c: RunConfig) => (c.kind === "flask" ? (c.params ?? null) : null),
};

export const fastapiType: RunConfigTypeContribution = {
  id: "fastapi",
  label: "FastAPI Server",
  icon: "project-fastapi",
  description: "Run a FastAPI application with Uvicorn",
  group: "Python",
  defaults: { host: "127.0.0.1", port: "8000" },
  debugAdapter: "debugpy",
  prepareLaunch: prepareServer,
  fields: [
    {
      key: "target",
      label: "Application",
      mono: true,
      required: true,
      placeholder: EXAMPLE.fastapi,
      hint: "`module:app`, or `module:create_app` with Application factory",
    },
    { key: "factory", label: "Application factory", control: "checkbox" },
    host,
    port("8000"),
    extra,
    interpreter,
  ],
  commandLine(p) {
    const target = p.target?.trim();
    if (!target) return null;
    return {
      command: command(p),
      args: [
        "-m",
        "uvicorn",
        target,
        ...(p.factory === "true" ? ["--factory"] : []),
        "--host",
        p.host?.trim() || "127.0.0.1",
        "--port",
        p.port?.trim() || "8000",
        ...parseArgs(p.args ?? ""),
      ],
    };
  },
  paramsFrom: (c: RunConfig) => (c.kind === "fastapi" ? (c.params ?? null) : null),
};

export const djangoServerType: RunConfigTypeContribution = {
  id: "django-server",
  label: "Django Server",
  icon: "project-django",
  description: "Run a Django project with runserver",
  group: "Python",
  defaults: { target: "manage.py", host: "127.0.0.1", port: "8000" },
  debugAdapter: "debugpy",
  prepareLaunch: prepareServer,
  fields: [
    {
      key: "target",
      label: "Management script",
      mono: true,
      required: true,
      browse: "file",
      placeholder: EXAMPLE.manage,
    },
    { key: "settings", label: "Settings module", mono: true, placeholder: EXAMPLE.settings },
    host,
    port("8000"),
    extra,
    interpreter,
  ],
  commandLine(p) {
    const target = p.target?.trim();
    if (!target) return null;
    const settings = p.settings?.trim();
    return {
      command: command(p),
      args: [
        target,
        "runserver",
        "--noreload",
        ...(settings ? ["--settings", settings] : []),
        ...parseArgs(p.args ?? ""),
        `${p.host?.trim() || "127.0.0.1"}:${p.port?.trim() || "8000"}`,
      ],
    };
  },
  paramsFrom: (c: RunConfig) => (c.kind === "django-server" ? (c.params ?? null) : null),
};

export const WEB_TYPES = [djangoServerType, flaskType, fastapiType];
