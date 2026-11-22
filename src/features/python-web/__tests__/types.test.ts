import { afterEach, describe, expect, it } from "vitest";
import type { RunConfig } from "@/platform/ipc";
import { djangoServerType, fastapiType, flaskType, setProjectPython } from "../types";

afterEach(() => setProjectPython(null));

describe("web server command lines", () => {
  it("runs Flask without the reloader or the browser debugger, so Debug stops in handlers", () => {
    expect(
      flaskType.commandLine({ ...flaskType.defaults, target: "webapp:create_app()", args: "--with-threads" }),
    ).toEqual({
      command: "python",
      args: [
        "-m",
        "flask",
        "--app",
        "webapp:create_app()",
        "run",
        "--host",
        "127.0.0.1",
        "--port",
        "5000",
        "--no-reload",
        "--no-debugger",
        "--with-threads",
      ],
    });
  });

  it("runs FastAPI through Uvicorn, with --factory for application factories", () => {
    const line = fastapiType.commandLine({
      ...fastapiType.defaults,
      target: "api.main:create_app",
      factory: "true",
      port: "9000",
    });
    expect(line?.args).toEqual([
      "-m",
      "uvicorn",
      "api.main:create_app",
      "--factory",
      "--host",
      "127.0.0.1",
      "--port",
      "9000",
    ]);
    expect(fastapiType.commandLine({ ...fastapiType.defaults, target: "api.main:app" })?.args).not.toContain(
      "--factory",
    );
  });

  it("runs Django's runserver without autoreload, with an optional settings module", () => {
    const line = djangoServerType.commandLine({
      ...djangoServerType.defaults,
      settings: "site.settings.dev",
      port: "8001",
    });
    expect(line?.args).toEqual([
      "manage.py",
      "runserver",
      "--noreload",
      "--settings",
      "site.settings.dev",
      "127.0.0.1:8001",
    ]);
  });

  it("uses the project interpreter when the field is empty, and the chosen one otherwise", () => {
    setProjectPython("/p/.venv/bin/python");
    expect(flaskType.commandLine({ ...flaskType.defaults, target: "app" })?.command).toBe("/p/.venv/bin/python");
    expect(
      flaskType.commandLine({ ...flaskType.defaults, target: "app", command: "/opt/py/bin/python3" })?.command,
    ).toBe("/opt/py/bin/python3");
  });

  it("needs an application and a valid port", () => {
    expect(flaskType.commandLine({ ...flaskType.defaults, target: " " })).toBeNull();
    const port = flaskType.fields.find((f) => f.key === "port")!;
    expect(port.validate?.("8080", {})).toBeNull();
    expect(port.validate?.("70000", {})).not.toBeNull();
    expect(port.validate?.("80a", {})).not.toBeNull();
  });
});

describe("prepareLaunch", () => {
  it("streams output unbuffered unless the configuration sets it", async () => {
    const config: RunConfig = {
      id: "x",
      name: "x",
      kind: "flask",
      command: "/p/.venv/bin/python",
      args: [],
      cwd: null,
      env: {},
      detected: false,
      isTest: false,
      debugAdapter: "debugpy",
      params: { command: "/p/.venv/bin/python" },
    };
    expect((await flaskType.prepareLaunch!(config)).env).toEqual({ PYTHONUNBUFFERED: "1" });
    const own = { ...config, env: { PYTHONUNBUFFERED: "0" } };
    expect((await flaskType.prepareLaunch!(own)).env).toEqual({ PYTHONUNBUFFERED: "0" });
  });
});
