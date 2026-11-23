# Copyright 2026 OpenIDEA fork contributors. Licensed under the Apache License 2.0.
"""Runs a script or module while sampling its threads' stacks and its asyncio tasks, for the
IDE's thread and task timeline.

python openidea_science_timeline.py OUTDIR (SCRIPT | -m MODULE) [ARGS...]

Writes OUTDIR/timeline.jsonl: one line per sample, {"t": ms since start, "threads": [{"id",
"name", "daemon", "frames"}], "tasks": [{"id", "name", "coro", "thread", "frames"}]}, frames
innermost first as [file, line, function]. No trace hook is installed: short-lived work can
fall between samples, and a busy event loop answers late (its tasks then miss that sample).
"""

import asyncio
import json
import os
import runpy
import sys
import threading
import time
import weakref

INTERVAL = float(os.environ.get("OPENIDEA_TIMELINE_INTERVAL", "0.02"))
MAX_SAMPLES = 600
MAX_THREADS = 32
MAX_TASKS = 32
MAX_FRAMES = 16
MAX_OBSERVATIONS = 5000
MAX_FRAME_RECORDS = 10000

_loops = weakref.WeakSet()
_here = os.path.abspath(__file__)


def _track_loops():
    original = asyncio.base_events.BaseEventLoop.run_forever

    def run_forever(self):
        _loops.add(self)
        return original(self)

    asyncio.base_events.BaseEventLoop.run_forever = run_forever


def _frames(frame):
    out = []
    while frame is not None and len(out) < MAX_FRAMES:
        code = frame.f_code
        filename = code.co_filename
        if os.path.abspath(filename) != _here and not filename.startswith("<frozen runpy"):
            out.append([os.path.abspath(filename) if not filename.startswith("<") else filename, frame.f_lineno, code.co_name])
        frame = frame.f_back
    return out


def _task_frames(task):
    try:
        stack = task.get_stack(limit=MAX_FRAMES)
    except Exception:
        return []
    # get_stack lists outermost first for coroutines; the timeline wants innermost first.
    return [[os.path.abspath(f.f_code.co_filename), f.f_lineno, f.f_code.co_name] for f in reversed(stack)]


class Sampler(threading.Thread):
    def __init__(self, out):
        super().__init__(name="openidea-timeline", daemon=True)
        self.out = out
        self.samples = []
        self.observations = 0
        self.frame_records = 0
        self.stopped = threading.Event()
        self.start_time = time.perf_counter()

    def tasks(self):
        found = []
        for loop in list(_loops):
            if loop.is_closed() or not loop.is_running():
                continue
            done = threading.Event()
            box = []

            def snapshot(loop=loop):
                try:
                    owner = threading.current_thread().name
                    for task in list(asyncio.all_tasks(loop))[:MAX_TASKS]:
                        coro = task.get_coro()
                        box.append({
                            "id": id(task),
                            "name": task.get_name(),
                            "coro": getattr(coro, "__qualname__", type(coro).__name__),
                            "thread": owner,
                            "frames": _task_frames(task),
                        })
                finally:
                    done.set()

            try:
                loop.call_soon_threadsafe(snapshot)
            except RuntimeError:
                continue
            # A busy loop answers late: its tasks miss this sample.
            if done.wait(INTERVAL / 2):
                found.extend(box)
        return found[:MAX_TASKS]

    def sample(self):
        names = {t.ident: t for t in threading.enumerate()}
        threads = []
        for ident, frame in sys._current_frames().items():
            if ident == self.ident or len(threads) >= MAX_THREADS:
                continue
            thread = names.get(ident)
            frames = _frames(frame)
            threads.append({
                "id": ident,
                "name": thread.name if thread else "thread-%d" % ident,
                "daemon": bool(thread and thread.daemon),
                "frames": frames,
            })
        tasks = self.tasks()
        self.observations += len(threads) + len(tasks)
        self.frame_records += sum(len(t["frames"]) for t in threads) + sum(len(t["frames"]) for t in tasks)
        return {"t": round((time.perf_counter() - self.start_time) * 1000, 1), "threads": threads, "tasks": tasks}

    def full(self):
        return (
            len(self.samples) >= MAX_SAMPLES
            or self.observations >= MAX_OBSERVATIONS
            or self.frame_records >= MAX_FRAME_RECORDS
        )

    def run(self):
        due = time.perf_counter()
        while not self.stopped.is_set() and not self.full():
            try:
                self.samples.append(self.sample())
            except Exception as error:  # sampling must never break the program
                sys.stderr.write("openidea: a timeline sample failed: %s\n" % error)
            # On a fixed schedule: a slow sample doesn't push the next ones back.
            due = max(due + INTERVAL, time.perf_counter())
            self.stopped.wait(due - time.perf_counter())

    def write(self):
        os.makedirs(self.out, exist_ok=True)
        path = os.path.join(self.out, "timeline.jsonl")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            for sample in self.samples:
                f.write(json.dumps(sample) + "\n")
        os.replace(tmp, path)


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: openidea_science_timeline.py OUTDIR (SCRIPT | -m MODULE) [ARGS...]")
    out = sys.argv[1]
    if sys.argv[2] == "-m":
        target, module = sys.argv[3], True
        sys.argv = [sys.argv[3]] + sys.argv[4:]
    else:
        target, module = sys.argv[2], False
        sys.argv = sys.argv[2:]
        sys.path.insert(0, os.path.dirname(os.path.abspath(target)))
    _track_loops()
    sampler = Sampler(out)
    sampler.start()
    code = 0
    try:
        if module:
            runpy.run_module(target, run_name="__main__", alter_sys=True)
        else:
            runpy.run_path(target, run_name="__main__")
    except SystemExit as exit:
        code = exit.code
    finally:
        sampler.stopped.set()
        sampler.join(1)
        sampler.write()
    if code not in (None, 0):
        sys.exit(code)


if __name__ == "__main__":
    main()
