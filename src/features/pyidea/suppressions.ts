/**
 * Completion in Python suppression comments, the counterpart of PyIdea's `# noinspection`
 * completion: after `#` the directives (`noqa`, `ruff: noqa`, `type: ignore[`,
 * `pyright: ignore[`, `pyrefly: ignore[`, `ty: ignore[`), and in a directive's code list the
 * codes of the line's own problems first, then the tool's other rules. Codes already listed
 * are left out; accepting a code while more problems on the line remain unlisted adds `, `
 * and opens the list again, which also opens after typing `# noqa: ` or `ignore[`.
 */
import {
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { diagnosticsFor } from "@/editor/lsp/diagnostics";
import type { Diagnostic } from "@/platform/ipc";
import { pythonTool, rememberRuffRules, type PythonTool } from "./diagnosticLinks";
import { ruffRules } from "./ruff";
import { BASEDPYRIGHT_RULES, MYPY_CODES, PYREFLY_CODES, PYRIGHT_RULES, TY_RULES } from "./staticRules";

export type Directive = "noqa" | "fileNoqa" | "typeIgnore" | "pyright" | "pyrefly" | "ty";

/** What a suppression comment's code list may name, by directive. */
const DIRECTIVE_TOOLS: Record<Directive, readonly PythonTool[]> = {
  noqa: ["ruff"],
  fileNoqa: ["ruff"],
  typeIgnore: ["mypy"],
  pyright: ["pyright", "basedpyright"],
  pyrefly: ["pyrefly"],
  ty: ["ty"],
};

/** Directives offered after `#`, with the tools whose problems make them rank first. */
export const DIRECTIVES: ReadonlyArray<{ directive: string; tools: readonly PythonTool[]; reopen: boolean }> = [
  { directive: "noqa: ", tools: ["ruff"], reopen: true },
  { directive: "noqa", tools: ["ruff"], reopen: false },
  { directive: "ruff: noqa: ", tools: ["ruff"], reopen: true },
  { directive: "type: ignore[", tools: ["mypy"], reopen: true },
  { directive: "pyright: ignore[", tools: ["pyright", "basedpyright"], reopen: true },
  { directive: "pyrefly: ignore[", tools: ["pyrefly"], reopen: true },
  { directive: "ty: ignore[", tools: ["ty"], reopen: true },
];

export type SuppressionContext =
  | { kind: "directive"; from: number; typed: string }
  | { kind: "codes"; directive: Directive; from: number; typed: string; listed: string[] };

const NOQA = /#\s*(ruff\s*:\s*)?noqa\s*:\s*((?:[A-Za-z]+\d*\s*,\s*)*)([A-Za-z]*\d*)$/i;
const IGNORE = /#\s*(type|pyright|pyrefly|ty)\s*:\s*ignore\s*\[((?:[\w-]+\s*,\s*)*)([\w-]*)$/;
const DIRECTIVE = /#\s*([a-z]+(?:\s*:\s*[a-z]*)?|)$/i;

/** The suppression completion that applies at the end of `before` (a line up to the caret, inside a comment). */
export function suppressionContext(before: string): SuppressionContext | null {
  const codes = (directive: Directive, list: string, typed: string): SuppressionContext => ({
    kind: "codes",
    directive,
    from: before.length - typed.length,
    typed,
    listed: list
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  });
  const noqa = NOQA.exec(before);
  if (noqa) return codes(noqa[1] ? "fileNoqa" : "noqa", noqa[2]!, noqa[3]!);
  const ignore = IGNORE.exec(before);
  if (ignore) {
    const directive: Directive = ignore[1] === "type" ? "typeIgnore" : (ignore[1] as "pyright" | "pyrefly" | "ty");
    return codes(directive, ignore[2]!, ignore[3]!);
  }
  const head = DIRECTIVE.exec(before);
  if (!head) return null;
  const typed = head[1]!;
  const normal = typed.replace(/\s+/g, "").toLowerCase();
  if (!DIRECTIVES.some((d) => d.directive.replace(/\s+/g, "").toLowerCase().startsWith(normal))) return null;
  return { kind: "directive", from: before.length - typed.length, typed };
}

/** Whether typing just opened a code list: `# noqa: `, `# ruff: noqa: `, `ignore[`, or `, ` inside one. */
export function opensCodeList(before: string): boolean {
  if (!/[\s[,]$/.test(before)) return false;
  const ctx = suppressionContext(before);
  return ctx?.kind === "codes" && ctx.typed === "";
}

/** Problems about suppression comments themselves, often the comment being typed: not offered first. */
const ABOUT_SUPPRESSIONS = new Set([
  "RUF100",
  "PGH003",
  "PGH004",
  "invalid-ignore-comment",
  "unused-ignore-comment",
  "unused-ignore",
  "ignore-without-code",
  "reportUnnecessaryTypeIgnoreComment",
  "reportIgnoreCommentWithoutRule",
]);

/** Codes of the problems on `line` (0-based) that `directive` can suppress, in reported order. */
export function lineCodes(diagnostics: readonly Diagnostic[], line: number, directive: Directive): Diagnostic[] {
  const tools = DIRECTIVE_TOOLS[directive];
  const seen = new Set<string>();
  return diagnostics.filter((d) => {
    const tool = pythonTool(d);
    if (!d.code || !tool || !tools.includes(tool) || ABOUT_SUPPRESSIONS.has(d.code)) return false;
    if (d.range.start.line > line || d.range.end.line < line || seen.has(d.code)) return false;
    seen.add(d.code);
    return true;
  });
}

async function catalog(directive: Directive, servers: ReadonlySet<string>): Promise<Completion[]> {
  switch (directive) {
    case "noqa":
    case "fileNoqa": {
      const rules = await ruffRules();
      rememberRuffRules(rules);
      return rules.map((r) => ({ label: r.code, detail: r.name, info: r.summary, type: "keyword" }));
    }
    case "typeIgnore":
      return MYPY_CODES.map((c) => ({ label: c, type: "keyword" }));
    case "pyright":
      return [...PYRIGHT_RULES, ...(servers.has("basedpyright") ? BASEDPYRIGHT_RULES : [])].map((c) => ({
        label: c,
        type: "keyword",
      }));
    case "pyrefly":
      return PYREFLY_CODES.map((c) => ({ label: c, type: "keyword" }));
    case "ty":
      return TY_RULES.map((c) => ({ label: c, type: "keyword" }));
  }
}

/** Inserts `code`; `, ` and the list again while more problems remain, else the closing `]` of a bracketed list. */
function insertCode(code: string, more: boolean, bracketed: boolean): Completion["apply"] {
  return (view, _completion, from, to) => {
    const closes = bracketed && !more && view.state.sliceDoc(to, to + 1) !== "]";
    const insert = more ? `${code}, ` : closes ? `${code}]` : code;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: "input.complete",
    });
    if (more) startCompletion(view);
  };
}

function inComment(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  // No parse tree (plain text): the patterns alone decide.
  if (!tree.length) return true;
  for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, -1); node; node = node.parent)
    if (node.name === "Comment") return true;
  return false;
}

export function suppressionSource(path: () => string): (ctx: CompletionContext) => Promise<CompletionResult | null> {
  return async (ctx) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    if (!before.includes("#") || !inComment(ctx.state, ctx.pos)) return null;
    const sc = suppressionContext(before);
    if (!sc) return null;
    const diagnostics = diagnosticsFor(path());
    const servers = new Set(diagnostics.map((d) => pythonTool(d)).filter((t) => t !== null));
    if (sc.kind === "directive") {
      if (!ctx.explicit && !sc.typed && !before.trimEnd().endsWith("#")) return null;
      return {
        from: line.from + sc.from,
        options: DIRECTIVES.map((d) => ({
          label: d.directive,
          type: "keyword",
          boost: d.tools.some((t) => servers.has(t)) ? 10 : 0,
          apply: d.reopen
            ? (view: EditorView, _c: Completion, from: number, to: number) => {
                view.dispatch({
                  changes: { from, to, insert: d.directive },
                  selection: { anchor: from + d.directive.length },
                });
                startCompletion(view);
              }
            : d.directive,
        })),
        validFor: /^[a-z: ]*$/i,
      };
    }
    const listed = new Set(sc.listed);
    const bracketed = sc.directive !== "noqa" && sc.directive !== "fileNoqa";
    const own = lineCodes(diagnostics, line.number - 1, sc.directive).filter((d) => !listed.has(d.code!));
    const ownCodes = new Set(own.map((d) => d.code!));
    const options: Completion[] = own.map((d, i) => ({
      label: d.code!,
      detail: d.message.split("\n")[0]!.slice(0, 80),
      type: "keyword",
      boost: 99 - i,
      apply: insertCode(d.code!, own.length > 1, bracketed),
    }));
    for (const option of await catalog(sc.directive, servers))
      if (!listed.has(option.label) && !ownCodes.has(option.label)) options.push(option);
    if (ctx.aborted) return null;
    return { from: line.from + sc.from, options, validFor: /^[\w-]*$/ };
  };
}

/** Opens the code list once a directive's list starts (`# noqa: `, `ignore[`, `, `). */
const reopen = EditorView.updateListener.of((u) => {
  if (!u.docChanged || !u.transactions.some((tr) => tr.isUserEvent("input.type"))) return;
  const head = u.state.selection.main.head;
  const line = u.state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);
  if (before.includes("#") && opensCodeList(before) && inComment(u.state, head)) startCompletion(u.view);
});

export function suppressionCompletion(path: () => string): Extension {
  return [EditorState.languageData.of(() => [{ openideaCompletion: suppressionSource(path) }]), reopen];
}
