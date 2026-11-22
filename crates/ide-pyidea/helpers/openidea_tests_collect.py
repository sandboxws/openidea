# Copyright 2026 PyIdea and OpenIDEA fork contributors. Licensed under the Apache License 2.0.
# Adapted from PyIdea's pyidea_tests/collect.py.
"""Collect Python tests and the project's local import graph without running test bodies.

python openidea_tests_collect.py REQUEST.json OUTPUT.json

REQUEST: {"project", "framework": "pytest" | "unittest" | "doctest" | "graph", "roots"?,
"discovery"?, "targets"?, "args"?, "pattern"?, "excluded"?, "previous"?: {"graph", "stamps"}}.
OUTPUT: {"version": 1, "tests": [...], "errors": [...], "graph": {file: [files]}, "stamps"}.
"graph" only refreshes the import graph (incrementally from "previous").
"""

import ast
import doctest
import importlib
import inspect
import json
import os
import re
from pathlib import Path
import sys
import traceback
import unittest


IGNORED = {
    "__pycache__", "node_modules", "venv", "env", "build", "dist",
    "site-packages", "htmlcov", "spark-warehouse",
}


def inside(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def source_files(root, excluded):
    for directory, dirs, files in os.walk(root, followlinks=False):
        base = Path(directory)
        dirs[:] = [
            name for name in sorted(dirs)
            if not name.startswith(".") and name not in IGNORED
            and not (base / name).is_symlink()
            and not any(inside(base / name, item) for item in excluded)
        ]
        for name in sorted(files):
            path = base / name
            if name.endswith(".py") and not path.is_symlink():
                yield path


def module_name(path, roots):
    for root in roots:
        if inside(path, root):
            parts = list(path.relative_to(root).with_suffix("").parts)
            if parts[-1] == "__init__":
                parts.pop()
            if parts:
                return ".".join(parts)
    return path.stem


def import_graph(files, roots, previous=None):
    previous = previous or {}
    modules = {}
    # A file may be importable from more than one configured root.
    for path in files:
        for root in roots:
            if inside(path, root):
                modules[module_name(path, [root])] = str(path)
    graph, stamps = {}, {}
    for path in files:
        key = str(path)
        stat = path.stat()
        stamp = [stat.st_mtime_ns, stat.st_size]
        stamps[key] = stamp
        if previous.get("stamps", {}).get(key) == stamp:
            graph[key] = previous.get("graph", {}).get(key, [])
            continue
        dependencies = set()

        def resolve(name):
            parts = name.split(".")
            # Package initializers can affect every module below them.
            for end in range(1, len(parts) + 1):
                candidate = modules.get(".".join(parts[:end]))
                if candidate and candidate != key:
                    dependencies.add(candidate)

        try:
            tree = ast.parse(path.read_bytes(), filename=key)
            package = module_name(path, roots).split(".")
            if path.name != "__init__.py":
                package.pop()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        resolve(alias.name)
                elif isinstance(node, ast.ImportFrom):
                    prefix = package[: len(package) - node.level + 1] if node.level else []
                    name = ".".join(prefix + ([node.module] if node.module else []))
                    resolve(name)
                    for alias in node.names:
                        resolve(name + "." + alias.name)
            graph[key] = sorted(dependencies)
        except (SyntaxError, UnicodeError):
            # Retain known relationships while a source file is temporarily invalid.
            graph[key] = previous.get("graph", {}).get(key, [])
    return {"graph": graph, "stamps": stamps}


def pytest_tests(request, result):
    import pytest

    class Collector:
        def pytest_collection_finish(self, session):
            for item in session.items:
                path = Path(str(item.path)).absolute()
                location = item.location
                suffix = item.nodeid.partition("::")[2]
                base, bracket, parameter = item.nodeid.partition("[")
                native = re.sub(r"\.pyc?::", "::", base.rstrip(":"))
                native = native.replace(".", "_").replace("\\", ".")
                native = native.replace("/", ".").replace("::", ".")
                if bracket:
                    native += "(" + parameter[:-1].replace(".", "_") + ")"
                callspec = getattr(item, "callspec", None)
                params = {key: safe_repr(value) for key, value in callspec.params.items()} if callspec else None
                result["tests"].append({
                    "id": item.nodeid,
                    "params": params,
                    "file": str(path),
                    "name": suffix or item.name,
                    "line": (location[1] or 0),
                    "native": native,
                    "symbol": suffix.split("[", 1)[0].replace("::", "."),
                })

        def pytest_collectreport(self, report):
            if report.failed:
                result["errors"].append(str(report.longrepr))

    args = list(request.get("targets", [])) + list(request.get("args", []))
    # These options change test execution or prevent unattended collection.
    args = [arg for arg in args if arg not in ("--pdb", "--trace", "-x")]
    code = pytest.main(args + ["--collect-only"], plugins=[Collector()])
    if code not in (0, 5) and not result["errors"]:
        result["errors"].append("pytest collection exited with code " + str(code))


def safe_repr(value, limit=200):
    try:
        text = repr(value)
    except Exception:
        text = "<unrepresentable %s>" % type(value).__name__
    return text if len(text) <= limit else text[: limit - 1] + "\u2026"


def object_location(obj):
    try:
        return inspect.getsourcefile(obj), inspect.getsourcelines(obj)[1] - 1
    except (OSError, TypeError):
        return None, 0


def unittest_tests(request, result):
    loader = unittest.TestLoader()
    discovery = request.get("discovery", request["project"])
    targets = request.get("targets", [])
    labels = []
    pattern = request.get("pattern") or "test*.py"
    if targets:
        for target in targets:
            path = Path(target)
            if path.is_file():
                labels.append(module_name(path, request["roots"]))
            elif path.is_dir():
                labels = ["discover", "-s", str(path), "-t", discovery, "-p", pattern]
            else:
                labels.append(target)
    else:
        start = Path(discovery) / "tests"
        if not start.is_dir():
            start = Path(discovery)
        labels = ["discover", "-s", str(start), "-t", discovery, "-p", pattern]

    def visit(suite):
        if isinstance(suite, unittest.TestSuite):
            for test in suite:
                visit(test)
        elif not isinstance(suite, unittest.loader._FailedTest):
            method = getattr(suite, suite._testMethodName, type(suite))
            file, line = object_location(method)
            if file:
                result["tests"].append({
                    "id": suite.id(), "file": str(Path(file).absolute()),
                    "name": type(suite).__qualname__ + "." + suite._testMethodName,
                    "line": line, "native": suite.id(),
                    "symbol": type(suite).__qualname__ + "." + suite._testMethodName,
                })

    class CollectorRunner:
        def run(self, suite):
            visit(suite)
            return unittest.TestResult()

    unittest.TestProgram(
        module=None, argv=["python -m unittest"] + labels + request.get("args", []),
        testRunner=CollectorRunner(), testLoader=loader, exit=False,
    )
    result["errors"].extend(loader.errors)


def doctest_tests(request, result, files):
    targets = {str(Path(target).absolute()) for target in request.get("targets", [])}
    for path in files:
        if not inside(path, Path(request.get("discovery", request["project"]))):
            continue
        if targets and str(path) not in targets and not any(
            inside(path, Path(target)) for target in targets
        ):
            continue
        try:
            tree = ast.parse(path.read_bytes(), filename=str(path))
            owners = [tree] + [node for node in ast.walk(tree) if isinstance(
                node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
            )]
            if not any(">>>" in (ast.get_docstring(owner) or "") for owner in owners):
                continue
            module = importlib.import_module(module_name(path, request["roots"]))
            for test in doctest.DocTestFinder().find(module):
                if test.examples:
                    symbol = test.name.removeprefix(module.__name__ + ".")
                    if symbol == module.__name__:
                        symbol = ""
                    result["tests"].append({
                        "id": str(path) + "::" + symbol,
                        "file": str(path), "name": symbol or module.__name__,
                        "line": test.lineno or 0, "native": test.name,
                        "symbol": symbol,
                    })
        except (ImportError, SyntaxError, OSError, ValueError):
            result["errors"].append(traceback.format_exc())


def collect(request):
    project = Path(request["project"]).absolute()
    roots = [Path(root).absolute() for root in request.get("roots", [str(project)])]
    discovery = Path(request.get("discovery", str(project))).absolute()
    if discovery not in roots:
        roots.insert(0, discovery)
    if (discovery / "src").is_dir() and discovery / "src" not in roots:
        roots.insert(0, discovery / "src")
    if project / "src" not in roots and (project / "src").is_dir():
        roots.insert(0, project / "src")
    if project not in roots:
        roots.append(project)
    request["roots"] = roots
    for root in reversed(roots):
        sys.path.insert(0, str(root))
    excluded = [Path(path) for path in request.get("excluded", [])]
    files = list(source_files(project, excluded))
    # New and removed modules can change the resolution of unchanged imports.
    previous = request.get("previous") or {}
    if set(previous.get("graph", {})) != {str(path) for path in files}:
        previous = {}
    result = {"version": 1, "tests": [], "errors": []}
    result.update(import_graph(files, roots, previous))
    try:
        framework = request["framework"]
        if framework == "pytest":
            pytest_tests(request, result)
        elif framework == "unittest":
            unittest_tests(request, result)
        elif framework == "doctest":
            doctest_tests(request, result, files)
        elif framework == "graph":
            pass
        else:
            raise ValueError("Unsupported test framework: " + framework)
    except (Exception, SystemExit):
        # The subprocess must preserve the graph and any successful collection.
        result["errors"].append(traceback.format_exc())
    return result


if __name__ == "__main__":
    request_path, output_path = map(Path, sys.argv[1:])
    request_data = json.loads(request_path.read_text(encoding="utf-8"))
    response = collect(request_data)
    temporary = output_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(response), encoding="utf-8")
    temporary.replace(output_path)
