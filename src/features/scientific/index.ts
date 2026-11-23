/**
 * PyIdea's Science tools (FORK.md): profile a Python script or module with cProfile (shown in
 * the Profiler tool window), capture its Matplotlib figures (the Plots tool window), and
 * Inspect Large Value of NumPy / pandas values in the debugger's Variables view.
 */
import { executeAction, registerActions } from "@/platform/actions";
import { lazyComponent } from "@/ui";
import {
  registerOverlay,
  registerRunExecutor,
  registerToolWindow,
  registerValueInspector,
  toolWindowService,
} from "@/workbench/contributions";
import { stopAll } from "./captures";
import { cProfileExecutor, PLOTS_WINDOW, plotsExecutor } from "./executors";
import { openInspect } from "./values/store";

/** Type names debugpy reports for values Inspect Large Value reads. */
const INSPECTABLE = /^(ndarray|DataFrame|Series|matrix|memmap|MaskedArray)$/;

export function activate(): () => void {
  const disposers = [
    registerValueInspector({
      id: "pyidea.inspectLargeValue",
      label: "Inspect Large Value…",
      supports: (v) => v.adapter === "debugpy" && INSPECTABLE.test(v.typeName ?? ""),
      open: openInspect,
    }),
    registerOverlay({
      id: "pyidea.inspectLargeValue",
      component: lazyComponent(() => import("./values/InspectDialog").then((m) => m.InspectDialog)),
    }),
    registerRunExecutor(cProfileExecutor),
    registerRunExecutor(plotsExecutor),
    registerToolWindow({
      id: PLOTS_WINDOW,
      title: "Plots",
      icon: "image",
      anchor: "right",
      stripe: "onUse",
      order: 40,
      requiresProject: true,
      component: lazyComponent(() => import("./ui/PlotsView").then((m) => m.PlotsView)),
    }),
    registerActions([
      {
        id: "scientific.profile",
        title: "Profile with cProfile",
        category: "Run",
        when: "projectOpen",
        keywords: ["cprofile", "python", "profiler", "callers", "callees"],
        run: () => executeAction("run.withExecutor", { executor: cProfileExecutor.id }).then(() => undefined),
      },
      {
        id: "scientific.capturePlots",
        title: "Run and Capture Plots",
        category: "Run",
        when: "projectOpen",
        keywords: ["matplotlib", "plot", "figure", "python", "science"],
        run: () => executeAction("run.withExecutor", { executor: plotsExecutor.id }).then(() => undefined),
      },
      {
        id: "scientific.openPlots",
        title: "Open Plots",
        category: "View",
        when: "projectOpen",
        run: () => toolWindowService().show(PLOTS_WINDOW, true),
      },
    ]),
    stopAll,
  ];
  return () => disposers.reverse().forEach((d) => d());
}
