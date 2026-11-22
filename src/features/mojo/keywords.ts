/** Mojo's words that Python's highlighting doesn't know, marked as keywords outside strings and comments. */
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/** Mojo keywords beyond Python's (PyIdea's list, minus what Python highlights already). */
export const MOJO_KEYWORDS = new Set([
  "alias",
  "comptime",
  "fn",
  "mut",
  "out",
  "owned",
  "raises",
  "read",
  "ref",
  "struct",
  "trait",
  "var",
]);

const mark = Decoration.mark({ class: "cm-mojo-keyword" });
const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;

/** Offsets of Mojo keywords in `text` (starting at `from`) that `skip` doesn't exclude. */
export function keywordRanges(text: string, from: number, skip: (pos: number) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(WORD)) {
    if (!MOJO_KEYWORDS.has(m[0])) continue;
    const start = from + m.index;
    if (!skip(start)) out.push([start, start + m[0].length]);
  }
  return out;
}

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  const inText = (pos: number) => {
    const name = tree.resolveInner(pos, 1).name;
    return /String|Comment/.test(name);
  };
  for (const { from, to } of view.visibleRanges) {
    for (const [a, b] of keywordRanges(view.state.sliceDoc(from, to), from, inText)) builder.add(a, b, mark);
  }
  return builder.finish();
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
        this.decorations = decorate(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  ".cm-mojo-keyword": { color: "var(--syn-keyword)", fontWeight: "var(--syn-keyword-bold, normal)" },
});

export const mojoKeywords: Extension = [plugin, theme];
