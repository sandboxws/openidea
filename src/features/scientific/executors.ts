/**
 * PyIdea's Science captures as run executors for Python script / module configurations (the
 * run widget's ⋮ menu, the gutter ▶ popup): cProfile into the Profiler view, and Matplotlib
 * plot capture into the Plots tool window. The configuration itself isn't changed.
 */
import { executeAction } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { call, commands, isTauri } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { notifications, toolWindowService, type RunExecutorContribution } from "@/workbench/contributions";
import { finishCapture, followCapture } from "./captures";
import { isPythonProgram, plotsLaunch, profileLaunch } from "./program";

export const PLOTS_WINDOW = "pythonPlots";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function capture(kind: "profile" | "plots") {
  if (!isTauri()) return null;
  try {
    return await call(commands.pyideaSciencePrepare(kind));
  } catch (e) {
    notifications().notify({ group: "run", level: "error", title: tx("Cannot start the capture"), body: message(e) });
    return null;
  }
}

export const cProfileExecutor: RunExecutorContribution = {
  id: "pythonCProfile",
  label: (name) => tx`Profile '${name}' with cProfile`,
  icon: "profile",
  action: "scientific.profile",
  order: 22,
  supports: isPythonProgram,
  async prepare(config) {
    const target = await capture("profile");
    if (!target) return null;
    const output = String(target.output);
    return {
      launch: profileLaunch(config, String(target.helpers), output),
      finished: () =>
        void executeAction("profiler.showCpuProfiles", {
          name: tx`cProfile: ${config.name}`,
          dir: output,
          root: useProject.getState().project?.root ?? "",
          profiler: "cProfile",
        }),
    };
  },
};

export const plotsExecutor: RunExecutorContribution = {
  id: "pythonPlots",
  label: (name) => tx`Run '${name}' and Capture Plots`,
  icon: "image",
  action: "scientific.capturePlots",
  order: 23,
  supports: isPythonProgram,
  async prepare(config) {
    const target = await capture("plots");
    if (!target) return null;
    const output = String(target.output);
    const separator = useProject.getState().project?.root?.includes("\\") ? ";" : ":";
    followCapture(output, config.name);
    try {
      toolWindowService().show(PLOTS_WINDOW);
    } catch {
      /* no workbench (tests) */
    }
    return {
      launch: plotsLaunch(config, String(target.helpers), output, separator),
      finished: () => void finishCapture(output),
    };
  },
};
