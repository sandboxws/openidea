# Copyright 2026 OpenIDEA fork contributors. Licensed under the Apache License 2.0.
"""Finds a project's Django, Flask and FastAPI applications without importing anything.

python openidea_web_discover.py PROJECT OUTPUT.json

OUTPUT: {"apps": [{"framework": "django" | "flask" | "fastapi", "target", "factory", "file",
"line", "directory", "pythonPath"}], "errors": [...]}. `target` is what the server command takes:
a `manage.py` path for Django, `module:app` / `module:create_app` otherwise. `directory` is where
to run it (the app's own project directory, so apps in separate directories stay apart, and the
directory above `src/` in a src layout) and `pythonPath` the directory its module imports from.
"""

import ast
import json
import os
import sys
from pathlib import Path

IGNORED = {
    "__pycache__", "node_modules", "venv", "env", "build", "dist", "site-packages",
    "htmlcov", "migrations",
}
FACTORY_NAMES = {"create_app", "make_app", "app_factory", "get_app", "build_app"}
MAX_FILES = 20000

try:
    import tomllib
except ImportError:  # Python < 3.11
    tomllib = None


def source_files(root):
    count = 0
    for directory, dirs, files in os.walk(root):
        base = Path(directory)
        dirs[:] = [
            d for d in sorted(dirs)
            if not d.startswith(".") and d not in IGNORED and not (base / d).is_symlink()
            and not (base / d / "pyvenv.cfg").exists()
        ]
        for name in sorted(files):
            if name.endswith(".py"):
                count += 1
                if count > MAX_FILES:
                    return
                yield base / name


def import_root(path):
    """The first ancestor that isn't a package: where `path`'s module imports from."""
    directory = path.parent
    while (directory / "__init__.py").exists() and directory.parent != directory:
        directory = directory.parent
    return directory


def module_name(path, root):
    parts = list(path.relative_to(root).with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def run_directory(root):
    return root.parent if root.name == "src" else root


def callee(node):
    """`Flask` for `Flask(...)` and `flask.Flask(...)`."""
    if not isinstance(node, ast.Call):
        return None
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


FRAMEWORKS = {"Flask": "flask", "FastAPI": "fastapi"}


def assigned_instances(body):
    """{name: (framework, line)} of `name = Flask(...)` / `name: FastAPI = FastAPI(...)` in `body`."""
    found = {}
    for node in body:
        value, targets = None, []
        if isinstance(node, ast.Assign):
            value, targets = node.value, node.targets
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            value, targets = node.value, [node.target]
        framework = FRAMEWORKS.get(callee(value))
        if framework:
            for target in targets:
                if isinstance(target, ast.Name):
                    found[target.id] = (framework, node.lineno)
    return found


def factory_framework(func):
    """The framework a function returns an instance of, when it does."""
    local = assigned_instances(ast.walk(func))
    for node in ast.walk(func):
        if isinstance(node, ast.Return) and node.value is not None:
            framework = FRAMEWORKS.get(callee(node.value))
            if framework:
                return framework
            if isinstance(node.value, ast.Name) and node.value.id in local:
                return local[node.value.id][0]
    return None


def apps_in(path):
    tree = ast.parse(path.read_bytes(), filename=str(path))
    imports = {
        alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in (node.names if isinstance(node, ast.Import) else [ast.alias(name=node.module or "")])
    }
    if not imports & {"flask", "fastapi"}:
        return []
    found = []
    for name, (framework, line) in assigned_instances(tree.body).items():
        found.append((framework, name, False, line))
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            framework = factory_framework(node)
            if framework and (node.name in FACTORY_NAMES or not found):
                found.append((framework, node.name, True, node.lineno))
    return found


def discover(project):
    apps, errors = [], []
    for path in source_files(project):
        if path.name == "manage.py":
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if "DJANGO_SETTINGS_MODULE" in text or "django" in text:
                apps.append({
                    "framework": "django", "target": str(path), "factory": False, "file": str(path),
                    "line": 1, "directory": str(path.parent), "pythonPath": str(path.parent),
                })
            continue
        try:
            found = apps_in(path)
        except (SyntaxError, ValueError, OSError) as error:
            errors.append("%s: %s" % (path, error))
            continue
        if not found:
            continue
        root = import_root(path)
        module = module_name(path, root)
        for framework, name, factory, line in found:
            apps.append({
                "framework": framework, "target": "%s:%s" % (module, name), "factory": factory,
                "file": str(path), "line": line, "directory": str(run_directory(root)), "pythonPath": str(root),
            })
    # FastAPI's own configuration: [tool.fastapi] entrypoint = "pkg.main:app".
    pyproject = project / "pyproject.toml"
    if tomllib and pyproject.is_file():
        try:
            entry = tomllib.loads(pyproject.read_text(encoding="utf-8")).get("tool", {}).get("fastapi", {}).get("entrypoint")
        except (ValueError, OSError):
            entry = None
        if isinstance(entry, str) and ":" in entry and not any(a["target"] == entry for a in apps):
            source = project / "src" if (project / "src").is_dir() else project
            apps.append({
                "framework": "fastapi", "target": entry, "factory": False, "file": str(pyproject), "line": 1,
                "directory": str(project), "pythonPath": str(source),
            })
    order = {"django": 0, "flask": 1, "fastapi": 2}
    apps.sort(key=lambda a: (order[a["framework"]], a["directory"], a["target"]))
    return {"apps": apps, "errors": errors}


if __name__ == "__main__":
    project, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2])
    result = discover(project)
    tmp = output.with_suffix(".tmp")
    tmp.write_text(json.dumps(result), encoding="utf-8")
    tmp.replace(output)
