# Copyright 2026 OpenIDEA fork contributors. Licensed under the Apache License 2.0.
"""A pytest plugin reporting each test's result as one JSON line to $OPENIDEA_TEST_EVENTS.

Loaded with `-p openidea_pytest_reporter`. Events:
  {"event": "collected", "count"}
  {"event": "started", "id"}
  {"event": "result", "id", "outcome", "duration", "message", "longrepr", "location",
   "expected", "actual", "params", "snapshot", "stdout", "stderr", "log"}
  {"event": "finished", "exitstatus"}
`outcome` is passed, failed, error (setup or teardown), skipped, xfailed or xpassed. A failed
assertion comparing two values carries their reprs as `expected` / `actual`, and every failure
a `snapshot` of the source around the reported line, with original line numbers.
"""

import json
import linecache
import os
import pprint

_out = None
_current = None
_params = {}
_compare = {}
_reported = set()

TEXT_LIMIT = 64 * 1024


def _emit(**event):
    global _out
    path = os.environ.get("OPENIDEA_TEST_EVENTS")
    if not path:
        return
    if _out is None:
        _out = open(path, "a", buffering=1, encoding="utf-8")
    _out.write(json.dumps(event, default=str) + "\n")


def _clip(text):
    if not text:
        return None
    return text if len(text) <= TEXT_LIMIT else text[:TEXT_LIMIT] + "\n…"


def _repr(value):
    try:
        return pprint.pformat(value, width=88)
    except Exception:
        return "<unrepresentable %s>" % type(value).__name__


def snapshot(path, line, before=6, after=4):
    """Source lines around 1-based `line` of `path`: {"file", "start", "line", "lines"}."""
    if not path or not line:
        return None
    start = max(1, line - before)
    lines = []
    for number in range(start, line + after + 1):
        text = linecache.getline(path, number)
        if not text and number > line:
            break
        lines.append(text.rstrip("\n"))
    return {"file": path, "start": start, "line": line, "lines": lines} if lines else None


def pytest_collection_finish(session):
    _emit(event="collected", count=len(session.items))


def pytest_runtest_setup(item):
    callspec = getattr(item, "callspec", None)
    if callspec:
        _params[item.nodeid] = {key: _repr(value)[:200] for key, value in callspec.params.items()}


def pytest_runtest_logstart(nodeid, location):
    global _current
    _current = nodeid
    _emit(event="started", id=nodeid)


def pytest_assertrepr_compare(config, op, left, right):
    if _current is not None and op == "==":
        _compare[_current] = {"expected": _repr(right), "actual": _repr(left)}
    return None


def _location(report):
    crash = getattr(getattr(report, "longrepr", None), "reprcrash", None)
    if crash is None:
        return None, None
    path = str(crash.path)
    if not os.path.isabs(path):
        path = os.path.abspath(path)
    return {"file": path, "line": crash.lineno}, crash.message


def pytest_runtest_logreport(report):
    nodeid = report.nodeid
    if nodeid in _reported:
        # A teardown error after a reported result: report it once more as an error.
        if not (report.when == "teardown" and report.failed):
            return
    outcome = None
    if report.when == "call":
        if hasattr(report, "wasxfail"):
            outcome = "xfailed" if report.skipped else "xpassed"
        else:
            outcome = report.outcome
    elif report.failed:
        outcome = "error"
    elif report.skipped:
        outcome = "skipped"
    if outcome is None:
        return
    _reported.add(nodeid)
    location, message = (None, None)
    longrepr = None
    if report.failed or outcome == "skipped":
        location, message = _location(report)
        longrepr = _clip(getattr(report, "longreprtext", None) or (str(report.longrepr) if report.longrepr else None))
        if outcome == "skipped" and isinstance(report.longrepr, tuple) and len(report.longrepr) == 3:
            message = report.longrepr[2]
            if message.startswith("Skipped: "):
                message = message[len("Skipped: "):]
    compare = _compare.pop(nodeid, None) if report.failed else None
    failed = outcome in ("failed", "error")
    _emit(
        event="result",
        id=nodeid,
        outcome=outcome,
        duration=round(report.duration, 6),
        message=message,
        longrepr=longrepr,
        location=location,
        expected=compare and compare["expected"],
        actual=compare and compare["actual"],
        params=_params.get(nodeid),
        snapshot=snapshot(location["file"], location["line"]) if failed and location else None,
        stdout=_clip(report.capstdout) if failed else None,
        stderr=_clip(report.capstderr) if failed else None,
        log=_clip(report.caplog) if failed else None,
    )


def pytest_sessionfinish(session, exitstatus):
    _emit(event="finished", exitstatus=int(exitstatus))
    if _out is not None:
        _out.flush()
