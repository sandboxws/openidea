/**
 * Catalog completion in Spark SQL files: the selected session's tables and views, and the
 * columns of the ones the file names (`table.` completes that table's columns). The SQL mode
 * completes keywords itself. Columns are read once per table and cached with the catalog.
 */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { loadColumns } from "./session";
import { sessionOf, useSpark } from "./store";

const MAX_MENTIONED = 8;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function catalogSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const word = ctx.matchBefore(/[\w.]+/);
  if (!word && !ctx.explicit) return null;
  const id = useSpark.getState().selected;
  const catalog = sessionOf(id).catalog;
  if (!id || !catalog) return null;
  const typed = word?.text ?? "";
  const from = word?.from ?? ctx.pos;
  const dot = typed.lastIndexOf(".");
  if (dot > 0) {
    const columns = await loadColumns(id, typed.slice(0, dot));
    if (ctx.aborted || !columns.length) return null;
    return {
      from: from + dot + 1,
      options: columns.map((c) => ({ label: c.name, type: "property", detail: c.type })),
      validFor: /^\w*$/,
    };
  }
  const options: Completion[] = catalog.tables.map((t) => ({
    label: t.name,
    type: "class",
    detail: t.temporary ? "temporary view" : t.type.toLowerCase(),
    boost: 2,
  }));
  const text = ctx.state.doc.toString();
  const mentioned = catalog.tables
    .filter((t) => new RegExp(`\\b${escape(t.name)}\\b`, "i").test(text))
    .slice(0, MAX_MENTIONED);
  const seen = new Set<string>();
  for (const t of mentioned)
    for (const c of await loadColumns(id, t.database ? `${t.database}.${t.name}` : t.name))
      if (!seen.has(c.name)) {
        seen.add(c.name);
        options.push({ label: c.name, type: "property", detail: `${t.name} · ${c.type}`, boost: 4 });
      }
  if (ctx.aborted) return null;
  return { from, options, validFor: /^\w*$/ };
}

export const sparkSqlCompletion = (): Extension =>
  EditorState.languageData.of(() => [{ openideaCompletion: catalogSource }]);
