# Copyright 2026 OpenIDEA fork contributors. Licensed under the Apache License 2.0.
"""Runs unittest tests by id and reports them like openidea_pytest_reporter.

python -m openidea_unittest_runner [--start DIR] [--pattern GLOB] [TEST_ID ...]

Without ids, discovers tests under DIR (default: the working directory). Events go to
$OPENIDEA_TEST_EVENTS; the usual unittest output goes to the console.
"""

import argparse
import os
import sys
import time
import traceback
import unittest

from openidea_pytest_reporter import _clip, _emit, snapshot


def _frame(err, test):
    """The last traceback frame inside the test's own file, else the last one."""
    tb = err[2]
    frames = traceback.extract_tb(tb)
    test_file = None
    try:
        test_file = os.path.abspath(sys.modules[type(test).__module__].__file__)
    except (KeyError, AttributeError, TypeError):
        pass
    own = [f for f in frames if test_file and os.path.abspath(f.filename) == test_file]
    frame = (own or frames or [None])[-1]
    return ({"file": os.path.abspath(frame.filename), "line": frame.lineno} if frame else None)


class EventResult(unittest.TextTestResult):
    def startTest(self, test):
        super().startTest(test)
        self._started = time.perf_counter()
        _emit(event="started", id=test.id())

    def _report(self, test, outcome, err=None, message=None):
        duration = round(time.perf_counter() - getattr(self, "_started", time.perf_counter()), 6)
        location = _frame(err, test) if err else None
        longrepr = _clip("".join(traceback.format_exception(*err))) if err else None
        if err and message is None:
            message = "".join(traceback.format_exception_only(err[0], err[1])).strip()
        _emit(
            event="result",
            id=test.id(),
            outcome=outcome,
            duration=duration,
            message=message,
            longrepr=longrepr,
            location=location,
            expected=None,
            actual=None,
            params=None,
            snapshot=snapshot(location["file"], location["line"]) if location else None,
            stdout=None,
            stderr=None,
            log=None,
        )

    def addSuccess(self, test):
        super().addSuccess(test)
        self._report(test, "passed")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._report(test, "failed", err)

    def addError(self, test, err):
        super().addError(test, err)
        self._report(test, "error", err)

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._report(test, "skipped", message=reason)

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._report(test, "xfailed")

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._report(test, "xpassed")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="openidea_unittest_runner")
    parser.add_argument("--start", default=os.getcwd())
    parser.add_argument("--pattern", default="test*.py")
    parser.add_argument("--top", default=None)
    parser.add_argument("ids", nargs="*")
    args = parser.parse_args(argv)
    loader = unittest.TestLoader()
    if args.ids:
        suite = loader.loadTestsFromNames(args.ids)
    else:
        suite = loader.discover(args.start, pattern=args.pattern, top_level_dir=args.top)
    _emit(event="collected", count=suite.countTestCases())
    runner = unittest.TextTestRunner(resultclass=EventResult, verbosity=2)
    result = runner.run(suite)
    status = 0 if result.wasSuccessful() else 1
    _emit(event="finished", exitstatus=status)
    return status


if __name__ == "__main__":
    sys.exit(main())
