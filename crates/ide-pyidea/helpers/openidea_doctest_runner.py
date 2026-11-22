# Copyright 2026 PyIdea and OpenIDEA fork contributors. Licensed under the Apache License 2.0.
# Example selection adapted from PyIdea's changes to PyCharm's docrunner.py.
"""Runs a source file's doctests with the standard doctest runner and reports them like
openidea_pytest_reporter.

python -m openidea_doctest_runner TARGET... [--owner SYMBOL] [--example LINE]

Every docstring with examples is one test, `FILE::SYMBOL` (`FILE::` for the module's own). A
TARGET is a FILE (all of its docstrings) or a test id FILE::SYMBOL. --owner runs one docstring of
a single FILE. --example runs the example of a single FILE whose `>>>` prompt is on 1-based LINE:
the earlier examples of its docstring run first as setup, and the run stops at the selected
example or at the first setup failure (reported as the failure of the selected example).
"""

import argparse
import doctest
import importlib
import importlib.util
import io
import os
import sys
import time
import traceback

from openidea_pytest_reporter import _emit, snapshot


def import_file(path):
    """Imports `path` by its module name under the longest matching sys.path root."""
    path = os.path.realpath(path)
    best = None
    for entry in sys.path:
        root = os.path.realpath(entry or os.getcwd())
        if path.startswith(root + os.sep):
            rel = os.path.relpath(path, root)
            parts = rel[: -len(".py")].split(os.sep) if rel.endswith(".py") else None
            if parts and parts[-1] == "__init__":
                parts.pop()
            if parts and all(p.isidentifier() for p in parts) and (best is None or len(parts) < len(best)):
                best = parts
    if best:
        module = importlib.import_module(".".join(best))
        if os.path.realpath(getattr(module, "__file__", "") or "") == path:
            return module
    name = os.path.splitext(os.path.basename(path))[0]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def symbol_of(test, module):
    prefix = module.__name__ + "."
    if test.name == module.__name__:
        return ""
    return test.name[len(prefix):] if test.name.startswith(prefix) else test.name


def example_line(test, example):
    """1-based source line of an example's `>>>` prompt."""
    return (test.lineno or 0) + example.lineno + 1


class SetupFailed(Exception):
    pass


class Runner(doctest.DocTestRunner):
    """Records the first failure; with `selected`, a failure before it is a setup failure."""

    def __init__(self, test, selected=None, optionflags=0):
        doctest.DocTestRunner.__init__(self, verbose=False, optionflags=optionflags)
        self.test = test
        self.selected = selected
        self.failure = None
        self.reached = selected is None

    def report_start(self, out, test, example):
        if example is self.selected:
            self.reached = True

    def _fail(self, example, details, expected=None, actual=None):
        setup = self.selected is not None and example is not self.selected
        if self.failure is None:
            self.failure = {
                "example": example,
                "details": ("An earlier example in the same docstring failed during setup.\n" if setup else "")
                + details,
                "expected": expected,
                "actual": actual,
                "setup": setup,
            }
        if setup:
            raise SetupFailed()

    def report_failure(self, out, test, example, got):
        details = self._checker.output_difference(example, got, self.optionflags)
        self._fail(example, details, expected=example.want, actual=got)

    def report_unexpected_exception(self, out, test, example, exc_info):
        details = "Exception raised:\n" + "".join(traceback.format_exception(*exc_info))
        self._fail(example, details)


def run_test(test, module, file, selected=None, test_id=None):
    test_id = test_id or "%s::%s" % (file, symbol_of(test, module))
    _emit(event="started", id=test_id)
    started = time.perf_counter()
    runner = Runner(test, selected)
    sink = io.StringIO()
    try:
        runner.run(test, out=sink.write, clear_globs=False)
    except SetupFailed:
        pass
    duration = round(time.perf_counter() - started, 6)
    failure = runner.failure
    if failure is None and not runner.reached:
        outcome = "skipped"
    else:
        outcome = "failed" if failure else "passed"
    location = None
    if failure:
        location = {"file": file, "line": example_line(test, failure["example"])}
    _emit(
        event="result",
        id=test_id,
        outcome=outcome,
        duration=duration,
        message=(failure["details"].splitlines() or [""])[0] if failure else None,
        longrepr=failure["details"] if failure else None,
        location=location,
        expected=failure and failure["expected"],
        actual=failure and failure["actual"],
        params=None,
        snapshot=snapshot(file, location["line"]) if location else None,
        stdout=None,
        stderr=None,
        log=None,
    )
    return outcome


def file_tests(file):
    module = import_file(file)
    tests = [t for t in doctest.DocTestFinder().find(module) if t.examples]
    return module, [t for t in tests if os.path.realpath(t.filename or "") == file]


def main(argv=None):
    parser = argparse.ArgumentParser(prog="openidea_doctest_runner")
    parser.add_argument("targets", nargs="+")
    parser.add_argument("--owner", default=None)
    parser.add_argument("--example", type=int, default=None)
    args = parser.parse_args(argv)
    # FILE or FILE::SYMBOL, grouped by file in the order given.
    wanted = {}
    for target in args.targets:
        file, sep, symbol = target.partition("::")
        file = os.path.realpath(file)
        owners = wanted.setdefault(file, set())
        if sep:
            owners.add(symbol)
        elif args.owner is not None:
            owners.add(args.owner)
        else:
            owners.add(None)
    loaded = {}
    try:
        for file in wanted:
            loaded[file] = file_tests(file)
    except Exception:
        _emit(event="collected", count=0)
        sys.stderr.write(traceback.format_exc())
        _emit(event="finished", exitstatus=2)
        return 2
    outcomes = []
    if args.example is not None:
        file = next(iter(wanted))
        module, tests = loaded[file]
        found = [(t, i) for t in tests for i, e in enumerate(t.examples) if example_line(t, e) == args.example]
        if not found:
            sys.stderr.write("The selected line no longer holds a doctest example. Select it again.\n")
            _emit(event="collected", count=0)
            _emit(event="finished", exitstatus=2)
            return 2
        test, index = found[0]
        selected = test.examples[index]
        partial = doctest.DocTest(test.examples[: index + 1], test.globs, test.name, test.filename, test.lineno, test.docstring)
        _emit(event="collected", count=1)
        test_id = "%s::%s:%d" % (file, symbol_of(test, module), args.example)
        outcomes.append(run_test(partial, module, file, selected, test_id))
    else:
        selected = []
        for file, owners in wanted.items():
            module, tests = loaded[file]
            selected.extend(
                (t, module, file) for t in tests if None in owners or symbol_of(t, module) in owners
            )
        _emit(event="collected", count=len(selected))
        for test, module, file in selected:
            outcomes.append(run_test(test, module, file))
    status = 1 if any(o == "failed" for o in outcomes) else 0
    _emit(event="finished", exitstatus=status)
    print("%d doctest%s: %s" % (len(outcomes), "" if len(outcomes) == 1 else "s", ", ".join(outcomes) or "none"))
    return status


if __name__ == "__main__":
    sys.exit(main())
