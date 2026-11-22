# Copyright 2026 OpenIDEA fork contributors. Licensed under the Apache License 2.0.
"""Runs a script or module under cProfile and writes V8 ``.cpuprofile`` files for the IDE's
profiler view: one per thread up to Python 3.11, one for all threads from 3.12 (cProfile then
runs on sys.monitoring, which allows one profiler per process). In that shared profile, calls
made while several threads run at once can be recorded under another thread's caller; each
function's own totals stay right.

python openidea_science_profile.py OUTDIR (SCRIPT | -m MODULE) [ARGS...]

cProfile aggregates by function (with callers), not by call path. Each profile's tree is
expanded from its root functions through their callees, splitting a function's time between
the paths into it in proportion to each caller's share, as SnakeViz does: exact per function,
approximate per path.
"""

import cProfile
import json
import os
import pstats
import runpy
import sys
import threading
import time

MAX_FUNCTIONS = 5000
MAX_EDGES = 20000
MAX_NODES = 20000
MAX_DEPTH = 96
MIN_SHARE = 0.001

_profiles = []
_lock = threading.Lock()


def _profile_threads():
    original = threading.Thread.run

    def run(self):
        profile = cProfile.Profile()
        profile.enable()
        try:
            original(self)
        finally:
            profile.disable()
            with _lock:
                _profiles.append((self.name, profile))

    threading.Thread.run = run


def _label(func):
    filename, line, name = func
    if filename == "~":  # builtins: ('~', 0, "<built-in method time.sleep>")
        return name, "", -1
    return name, os.path.abspath(filename) if not filename.startswith("<") else "", max(line - 1, 0)


def _wrapper(func):
    """Frames of this helper and of runpy, between the profiler and the program."""
    filename = func[0]
    return filename in (__file__, "<frozen runpy>") or filename.endswith(("runpy.py", "openidea_science_profile.py")) or (
        filename == "~" and func[2] in ("<built-in method builtins.exec>", "<method 'disable' of '_lsprof.Profiler' objects>")
    )


def _cpuprofile(profile, started):
    stats = pstats.Stats(profile).stats  # func -> (cc, nc, tt, ct, callers{caller: (cc, nc, tt, ct)})
    if len(stats) > MAX_FUNCTIONS:
        keep = sorted(stats, key=lambda f: stats[f][3], reverse=True)[:MAX_FUNCTIONS]
        stats = {f: stats[f] for f in keep}
    callees = {}
    edges = 0
    for func, (_, _, _, _, callers) in stats.items():
        for caller, edge in callers.items():
            if caller in stats and edges < MAX_EDGES:
                callees.setdefault(caller, []).append((func, edge))
                edges += 1
    for edges_of in callees.values():
        edges_of.sort(key=lambda e: -e[1][3])
    roots = [f for f, s in stats.items() if not any(c in stats for c in s[4])]
    total_time = sum(stats[f][3] for f in roots) or 1e-12
    # Paths below this share of the profile are left out (import machinery has many).
    floor = total_time * MIN_SHARE
    nodes = [{"id": 1, "callFrame": {"functionName": "(root)", "url": "", "lineNumber": -1}, "children": []}]
    weights = []  # (node id, self seconds)

    def add(parent, func, total, own, path):
        if len(nodes) >= MAX_NODES:
            return
        if _wrapper(func):
            node = parent  # its callees take its place
        else:
            name, url, line = _label(func)
            node = {"id": len(nodes) + 1, "callFrame": {"functionName": name, "url": url, "lineNumber": line, "columnNumber": 0}, "children": []}
            nodes.append(node)
            parent["children"].append(node["id"])
            weights.append((node["id"], own))
        if len(path) >= MAX_DEPTH:
            return
        scale = total / (stats[func][3] or 1e-12)  # this path's share of the function's time
        children = [(callee, ct * scale, tt * scale) for callee, (_, _, tt, ct) in callees.get(func, [])]
        # Recursion makes callers' cumulative times overlap: the children get at most the time
        # this node didn't spend itself.
        room = max(total - (0 if node is parent else own), 0.0)
        claimed = sum(c[1] for c in children)
        factor = room / claimed if claimed > room else 1.0
        added = 0.0
        for callee, child_total, child_own in children:
            child_total *= factor
            if callee not in path and child_total >= floor and len(nodes) < MAX_NODES:
                add(node, callee, child_total, child_own * factor, path | {callee})
                added += child_total
        # The rest (small calls, recursion back up the path, time cProfile couldn't attribute)
        # keeps the total right.
        rest_time = room - added
        if rest_time > floor * 0.01:
            rest = {"id": len(nodes) + 1, "callFrame": {"functionName": "(other calls)", "url": "", "lineNumber": -1}, "children": []}
            nodes.append(rest)
            node["children"].append(rest["id"])
            weights.append((rest["id"], rest_time))

    for root in sorted(roots, key=lambda f: -stats[f][3]):
        if stats[root][3] >= floor:
            add(nodes[0], root, stats[root][3], stats[root][2], {root})
    samples, deltas = [], [0]
    for node_id, own in weights:
        if own > 0:
            samples.append(node_id)
            deltas.append(int(own * 1e6))
    samples.append(1)  # carries the last delta (`timeDeltas[i + 1]` belongs to sample `i`)
    return {"nodes": nodes, "startTime": started, "endTime": started + sum(deltas), "samples": samples, "timeDeltas": deltas}


def _write(out, profiles):
    started = int(time.time() * 1e6)
    used = set()
    for index, (name, profile) in enumerate(profiles):
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:60] or "thread"
        filename = "%02d-%s.cpuprofile" % (index, safe)
        while filename in used:
            filename = "%02d-%s-%d.cpuprofile" % (index, safe, len(used))
        used.add(filename)
        try:
            data = _cpuprofile(profile, started)
        except Exception as error:  # an unreadable profile shouldn't hide the others
            sys.stderr.write("openidea: skipped the profile of %s: %s\n" % (name, error))
            continue
        tmp = os.path.join(out, "." + filename + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, os.path.join(out, filename))


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: openidea_science_profile.py OUTDIR (SCRIPT | -m MODULE) [ARGS...]")
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    if sys.argv[2] == "-m":
        target, module = sys.argv[3], True
        sys.argv = [sys.argv[3]] + sys.argv[4:]
    else:
        target, module = sys.argv[2], False
        sys.argv = sys.argv[2:]
        sys.path.insert(0, os.path.dirname(os.path.abspath(target)))
    # From 3.12 cProfile runs on sys.monitoring: one profiler per process, seeing every thread.
    per_thread = sys.version_info < (3, 12)
    if per_thread:
        _profile_threads()
    main_profile = cProfile.Profile()
    code = 0
    main_profile.enable()
    try:
        if module:
            runpy.run_module(target, run_name="__main__", alter_sys=True)
        else:
            runpy.run_path(target, run_name="__main__")
    except SystemExit as exit:
        code = exit.code
    finally:
        main_profile.disable()
        # Threads still running at exit keep running; the finished ones are written with the main thread.
        with _lock:
            profiles = [("MainThread" if per_thread else "all-threads", main_profile)] + list(_profiles)
        _write(out, profiles)
    if code not in (None, 0):
        sys.exit(code)


if __name__ == "__main__":
    main()
