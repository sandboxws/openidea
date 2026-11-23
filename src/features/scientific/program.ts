/** How the Science captures change a Python run configuration's launch. */
import type { RunConfig } from "@/platform/ipc";

/** Where the program starts in a Python configuration's arguments (`-m` or the script), or -1. */
export function programIndex(args: readonly string[]): number {
  return args.findIndex((a) => a === "-m" || /\.pyw?$/.test(a));
}

/** A Python configuration running a script or a module (what the captures can wrap). */
export const isPythonProgram = (config: RunConfig) => config.kind === "python" && programIndex(config.args) >= 0;

/** `python [options] script args` → `python [options] <helper> OUT script args`. */
export function helperLaunch(config: RunConfig, helper: string, output: string): RunConfig {
  const at = programIndex(config.args);
  return { ...config, args: [...config.args.slice(0, at), helper, output, ...config.args.slice(at)] };
}

export const profileLaunch = (config: RunConfig, helpers: string, output: string) =>
  helperLaunch(config, `${helpers}/openidea_science_profile.py`, output);

export const timelineLaunch = (config: RunConfig, helpers: string, output: string) =>
  helperLaunch(config, `${helpers}/openidea_science_timeline.py`, output);

/** The configuration with Matplotlib drawing into the capture backend. */
export function plotsLaunch(config: RunConfig, helpers: string, output: string, separator = ":"): RunConfig {
  const path = config.env.PYTHONPATH;
  return {
    ...config,
    env: {
      ...config.env,
      MPLBACKEND: "module://openidea_mpl_backend",
      OPENIDEA_PLOTS_DIR: output,
      PYTHONPATH: path ? `${helpers}${separator}${path}` : helpers,
    },
  };
}

export interface PlotEntry {
  file: string;
  title: string;
  reason: string;
}

/** The images listed in `plots.jsonl` (skipped and unreadable lines left out). */
export function readPlots(jsonl: string): PlotEntry[] {
  const out: PlotEntry[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Partial<PlotEntry>;
      if (typeof e.file === "string") out.push({ file: e.file, title: e.title ?? "", reason: e.reason ?? "" });
    } catch {
      /* a line being written */
    }
  }
  return out;
}
