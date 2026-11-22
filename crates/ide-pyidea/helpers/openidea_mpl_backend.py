# Copyright 2026 OpenIDEA fork contributors. Licensed under the Apache License 2.0.
"""A noninteractive Matplotlib backend that saves figures as PNGs for the IDE's Plots view.

Selected with ``MPLBACKEND=module://openidea_mpl_backend``; images go to
``$OPENIDEA_PLOTS_DIR`` as ``NNNN-figure-N.png``, each listed in ``plots.jsonl``. A figure is
saved when the program shows it, closes it, and when the program ends with it changed since.
"""

import atexit
import json
import os
import threading

import matplotlib
from matplotlib import _pylab_helpers
from matplotlib.backend_bases import FigureManagerBase, _Backend
from matplotlib.backends.backend_agg import FigureCanvasAgg

MAX_IMAGES = 20
MAX_PIXELS = 16_000_000
MAX_BYTES = 8 * 1024 * 1024

_dir = os.environ.get("OPENIDEA_PLOTS_DIR") or os.path.join(os.getcwd(), ".openidea-plots")
_lock = threading.Lock()
_count = 0
_saved = {}  # figure number -> the figure saved under it


def _record(entry):
    with open(os.path.join(_dir, "plots.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _save(figure, reason):
    global _count
    with _lock:
        if _count >= MAX_IMAGES:
            return
        width, height = figure.get_size_inches() * figure.dpi
        dpi = figure.dpi
        if width * height > MAX_PIXELS:
            dpi = dpi * (MAX_PIXELS / (width * height)) ** 0.5
        os.makedirs(_dir, exist_ok=True)
        _count += 1
        number = getattr(figure, "number", _count)
        name = "%04d-figure-%s.png" % (_count, number)
        path = os.path.join(_dir, name)
        tmp = os.path.join(_dir, "." + name + ".tmp")
        try:
            figure.savefig(tmp, format="png", dpi=dpi)
            if os.path.getsize(tmp) > MAX_BYTES:
                os.remove(tmp)
                _record({"skipped": name, "reason": "larger than 8 MiB"})
                return
            os.replace(tmp, path)
        except Exception as error:  # a figure that can't render shouldn't stop the program
            _record({"skipped": name, "reason": str(error)})
            return
        # Saving restores the figure's dpi and colors, which marks it changed: it isn't.
        figure.stale = False
        _saved[number] = id(figure)
        title = figure.get_suptitle() if hasattr(figure, "get_suptitle") else ""
        if not title:
            axes = figure.get_axes()
            title = axes[0].get_title() if axes else ""
        _record({"file": name, "figure": number, "title": title, "reason": reason})


def _changed(manager):
    figure = manager.canvas.figure
    return _saved.get(manager.num) != id(figure) or figure.stale


class FigureManager(FigureManagerBase):
    def destroy(self):
        if _changed(self):
            _save(self.canvas.figure, "close")
        super().destroy()


@_Backend.export
class _BackendOpenIDEA(_Backend):
    FigureCanvas = FigureCanvasAgg
    FigureManager = FigureManager

    @staticmethod
    def show(*args, **kwargs):
        for manager in _pylab_helpers.Gcf.get_all_fig_managers():
            if _changed(manager):
                _save(manager.canvas.figure, "show")


@atexit.register
def _at_exit():
    for manager in _pylab_helpers.Gcf.get_all_fig_managers():
        if _changed(manager):
            _save(manager.canvas.figure, "exit")


matplotlib.rcParams["interactive"] = False
