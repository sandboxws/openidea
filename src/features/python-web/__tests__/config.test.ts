import { afterEach, describe, expect, it } from "vitest";
import type { PythonWebApp } from "@/platform/ipc";
import { configFor } from "../config";
import { setProjectPython } from "../types";

afterEach(() => setProjectPython(null));

const app = (over: Partial<PythonWebApp>): PythonWebApp => ({
  framework: "flask",
  target: "app:app",
  factory: false,
  file: "/p/app.py",
  line: 3,
  directory: "/p",
  pythonPath: "/p",
  ...over,
});

describe("configFor", () => {
  it("starts an app in its own directory, importing from its src/ layout", () => {
    const config = configFor(
      app({
        framework: "fastapi",
        target: "api.main:create_app",
        factory: true,
        directory: "/p/services/api",
        pythonPath: "/p/services/api/src",
      }),
      "/p",
    );
    expect(config).toMatchObject({
      name: "FastAPI: api.main:create_app",
      kind: "fastapi",
      cwd: "services/api",
      env: { PYTHONPATH: "src" },
      debugAdapter: "debugpy",
      params: { target: "api.main:create_app", factory: "true" },
    });
    expect(config.args).toContain("--factory");
  });

  it("marks a Flask factory with a call and keeps a flat app's environment empty", () => {
    const config = configFor(app({ target: "webapp:create_app", factory: true }), "/p");
    expect(config.params?.target).toBe("webapp:create_app()");
    expect(config.cwd).toBeNull();
    expect(config.env).toEqual({});
  });

  it("runs Django's manage.py from its directory", () => {
    const config = configFor(
      app({ framework: "django", target: "/p/site/manage.py", directory: "/p/site", pythonPath: "/p/site" }),
      "/p",
    );
    expect(config).toMatchObject({ name: "Django: site", kind: "django-server", cwd: "site" });
    expect(config.args.slice(0, 3)).toEqual(["manage.py", "runserver", "--noreload"]);
  });

  it("keeps an app's own interpreter explicitly, and the project's as the default", () => {
    setProjectPython("/p/.venv/bin/python");
    const own = configFor(app({ directory: "/p/svc" }), "/p", "/p/svc/.venv/bin/python");
    expect(own.command).toBe("/p/svc/.venv/bin/python");
    expect(own.params?.command).toBe("/p/svc/.venv/bin/python");
    const shared = configFor(app({}), "/p", "/p/.venv/bin/python");
    expect(shared.command).toBe("/p/.venv/bin/python");
    expect(shared.params?.command).toBeUndefined();
  });
});
