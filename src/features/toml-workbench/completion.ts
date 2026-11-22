/** PyPI versions after a comparison operator inside a `pyproject.toml` requirement string. */
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { whenSynced, type EditorDocContext } from "@/editor/api";
import { tx } from "@/platform/i18n";
import { call, commands, isTauri, nextRequestId } from "@/platform/ipc";
import { typedVersion, versionOptions } from "./versions";

export function versionCompletion(doc: EditorDocContext): Extension {
  const completion = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (!isTauri()) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const typed = typedVersion(line.text.slice(0, ctx.pos - line.from));
    if (typed === null) return null;
    const text = ctx.state.doc;
    const id = nextRequestId();
    ctx.addEventListener("abort", () => void commands.cancelRequest(id), { onDocChange: true });
    try {
      const view = ctx.view;
      if (!view) return null;
      await whenSynced(view);
      if (ctx.aborted || view.state.doc !== text) return null;
      const found = await call(commands.pyideaTomlVersions(doc.doc, ctx.pos, id));
      if (ctx.aborted || view.state.doc !== text) return null;
      const item = found.find(({ dependency }) => dependency.from <= ctx.pos && ctx.pos <= dependency.to);
      if (!item?.versions.length) return null;
      const latest = item.versions[0];
      const options = versionOptions(item.versions, typed, (v) => (v === latest ? tx("latest") : undefined));
      return { from: ctx.pos - typed.length, options, filter: false };
    } catch {
      return null;
    }
  };
  return EditorState.languageData.of(() => [{ openideaCompletion: completion }]);
}
