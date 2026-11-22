/**
 * Gruvppuccin's keyword roles: `import`/`from`/`export`, `return`/`yield`, control flow and
 * declaration keywords get their own colours (`--syn-keyword-<role>`, from the theme's editor
 * scheme), as the IntelliJ plugin's keyword annotator gave them. Like that annotator, it marks
 * tokens the language already highlights as keywords, by their text: Lezer keyword tags, or
 * keyword ranges of the tree-sitter highlighting. Visible ranges only.
 */
import { highlightingFor, syntaxTree } from "@codemirror/language";
import { Prec, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { getStyleTags, tags as t, type Tag } from "@lezer/highlight";
import { HEAVY_LIMIT } from "@/editor/api";
import { syntaxHighlightField } from "@/editor/core/cm/syntaxHighlight";
import { KEYWORD_ROLES, type KeywordRole } from "./css";

/** GruvppuccinKeywordAnnotator's word sets. */
const WORDS: Readonly<Record<string, KeywordRole>> = Object.fromEntries([
  ...["import", "from", "export"].map((w) => [w, "module"]),
  ...["return", "yield"].map((w) => [w, "return"]),
  ...[
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "match",
    "when",
    "guard",
    "default",
  ].map((w) => [w, "control"]),
  ...["function", "fun", "fn", "def", "let", "const", "var", "val", "mut"].map((w) => [w, "definition"]),
]);

export function keywordRole(text: string): KeywordRole | null {
  return Object.hasOwn(WORDS, text) ? WORDS[text]! : null;
}

const MARKS = Object.fromEntries(KEYWORD_ROLES.map((r) => [r, Decoration.mark({ class: `cm-gp-kw-${r}` })])) as Record<
  KeywordRole,
  Decoration
>;

const isKeyword = (tag: Tag) => tag.set.includes(t.keyword);

function marks(view: EditorView): DecorationSet {
  const { state } = view;
  if (state.doc.length > HEAVY_LIMIT) return Decoration.none;
  const out: Range<Decoration>[] = [];
  const add = (from: number, to: number) => {
    if (to - from > 8) return;
    const role = keywordRole(state.sliceDoc(from, to));
    if (role) out.push(MARKS[role].range(from, to));
  };
  const tree = syntaxTree(state);
  const treeSitter = state.field(syntaxHighlightField, false);
  const keywordClass = treeSitter ? highlightingFor(state, [t.keyword]) : null;
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const style = getStyleTags(node);
        if (!style?.tags.some(isKeyword)) return;
        add(node.from, node.to);
        return false;
      },
    });
    if (treeSitter && keywordClass)
      treeSitter.between(from, to, (f, e, deco) => {
        if (deco.spec.class === keywordClass) add(f, e);
      });
  }
  return Decoration.set(out, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = marks(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        syntaxTree(u.state) !== syntaxTree(u.startState) ||
        u.state.field(syntaxHighlightField, false) !== u.startState.field(syntaxHighlightField, false)
      )
        this.decorations = marks(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const roleStyle = (role: KeywordRole) => ({
  color: `var(--syn-keyword-${role}, var(--syn-keyword))`,
  fontWeight: `var(--syn-keyword-${role}-bold, var(--syn-keyword-bold, inherit))`,
  fontStyle: `var(--syn-keyword-${role}-italic, var(--syn-keyword-italic, inherit))`,
});

const theme = EditorView.baseTheme(
  Object.fromEntries(KEYWORD_ROLES.map((r) => [`.cm-gp-kw-${r}, .cm-gp-kw-${r} *`, roleStyle(r)])),
);

/** The innermost marks, so the role colour wins over the generic keyword span it sits in. */
export function keywordRoles(): Extension {
  return [Prec.highest(plugin), theme];
}
