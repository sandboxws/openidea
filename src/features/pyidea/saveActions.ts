/**
 * PyIdea's Python save actions: with Ruff available, an explicit save applies Ruff's safe
 * lint fixes and then formats with Ruff, before Code Cleanup and Format on Save. Both run
 * through the Ruff the project would use (its environment's first, as in PyIdea) with the
 * project's Ruff configuration and exclusions. Without Ruff nothing happens (nothing is
 * installed), and a file Format on Save or Ruff's Run on Save already formats isn't
 * formatted twice.
 */
import { registerSaveParticipant } from "@/editor/api";
import { formatsOnSave } from "@/editor/lsp/actions";
import { call, commands, nextRequestId } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { ruffInfo } from "./ruff";
import { pyideaSettings } from "./settings";

/** The smallest single replacement turning `before` into `after`. */
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end))
    end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

export function registerRuffOnSave(): () => void {
  return registerSaveParticipant({
    id: "pyidea.ruffOnSave",
    order: 44,
    beforeSave: async (ctx, handle) => {
      if (!handle || ctx.readOnly || ctx.virtual || ctx.language !== "python") return;
      const s = pyideaSettings();
      const fix = s.ruffFixOnSave;
      const format = s.ruffFormatOnSave && !formatsOnSave(useProject.getState().settings, "python");
      if ((!fix && !format) || !(await ruffInfo())) return;
      const view = handle.view;
      const text = view.state.doc.toString();
      const result = await call(commands.pyideaRuffApply(ctx.path, text, fix, format, nextRequestId())).catch(
        () => null,
      );
      // Typing during the run makes its result stale.
      if (result === null || view.state.doc.toString() !== text) return;
      const change = minimalChange(text, result);
      if (change) view.dispatch({ changes: change, userEvent: "format" });
    },
  });
}
