/**
 * Mojo Application: builds a Mojo file and runs the binary; Debug runs it under the SDK's
 * lldb-dap. Configurations made from the editor build with debug info in a Before Launch task,
 * so Run and Debug both start a fresh build and a failed build runs nothing.
 */
import { parseArgs } from "@/platform/commandLine";
import { call, commands, nextRequestId, type RunConfig } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import type { RunConfigTypeContribution } from "@/workbench/contributions";
import { defaultOutput, resolve } from "./paths";

export const MOJO_KIND = "mojo-application";

/** A code example, shown as typed. */
const EXAMPLE_SOURCE = "main.mojo";

/** Whether `config` builds itself before launching (a `mojo build` Before Launch command). */
export const buildsBeforeLaunch = (config: RunConfig) =>
  !!config.beforeLaunch?.some(
    (t) => t.kind === "command" && / build /.test(t.target ?? "") && /mojo/.test(t.target ?? ""),
  );

/** Absolute source, output and working directory of a Mojo configuration. */
export function mojoPaths(config: Pick<RunConfig, "cwd" | "params">, root: string) {
  const cwd = config.cwd ? resolve(root, config.cwd) : root;
  const source = resolve(cwd, config.params?.source ?? "");
  const output = resolve(cwd, config.params?.output?.trim() || defaultOutput(source));
  return { cwd, source, output };
}

/** Run without a Before Launch build (a configuration made in Edit Configurations): build first. */
async function buildForLaunch(config: RunConfig): Promise<RunConfig> {
  const root = useProject.getState().project?.root;
  if (!root || buildsBeforeLaunch(config)) return config;
  const { source, output } = mojoPaths(config, root);
  const result = await call(
    commands.pyideaMojoBuild(source, output, parseArgs(config.params?.compilerArgs ?? ""), false, nextRequestId()),
  );
  if (!result.ok) throw new Error(result.output.trim() || "mojo build failed");
  return config;
}

export const mojoType: RunConfigTypeContribution = {
  id: MOJO_KIND,
  label: "Mojo Application",
  icon: "ext:fork/mojo",
  description: "Build a Mojo file and run it",
  debugAdapter: "lldb-dap",
  fields: [
    { key: "source", label: "Source file", mono: true, required: true, browse: "file", placeholder: EXAMPLE_SOURCE },
    { key: "programArgs", label: "Program arguments", mono: true },
    {
      key: "compilerArgs",
      label: "Compiler arguments",
      mono: true,
      hint: "Passed to mojo build; the output and the source are set here",
    },
    {
      key: "output",
      label: "Output path",
      mono: true,
      browse: "file",
      hint: "Blank: .openidea/mojo/bin under the working directory",
    },
  ],
  commandLine(p) {
    const source = p.source?.trim();
    if (!source) return null;
    return { command: p.output?.trim() || defaultOutput(source), args: parseArgs(p.programArgs ?? "") };
  },
  paramsFrom: (c: RunConfig) => (c.kind === MOJO_KIND ? (c.params ?? null) : null),
  prepareLaunch: buildForLaunch,
};
