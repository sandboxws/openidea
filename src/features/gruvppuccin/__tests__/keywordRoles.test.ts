import { javascript } from "@codemirror/lang-javascript";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { openideaHighlightStyle } from "@/editor/core/cm/highlight";
import { setSyntaxHighlights, syntaxHighlightField } from "@/editor/core/cm/syntaxHighlight";
import { keywordRole, keywordRoles } from "../keywordRoles";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(doc: string, extensions: Extension) {
  view = new EditorView({ state: EditorState.create({ doc, extensions }), parent: document.body });
  return view;
}

const marked = (v: EditorView, role: string) =>
  [...v.dom.querySelectorAll(`.cm-gp-kw-${role}`)].map((e) => e.textContent);

describe("keywordRole", () => {
  it("uses the IntelliJ annotator's word sets", () => {
    expect(keywordRole("from")).toBe("module");
    expect(keywordRole("yield")).toBe("return");
    expect(keywordRole("match")).toBe("control");
    expect(keywordRole("def")).toBe("definition");
    expect(keywordRole("class")).toBeNull();
    expect(keywordRole("toString")).toBeNull();
  });
});

describe("keywordRoles", () => {
  it("marks keyword tokens by role, and leaves identifiers alone", () => {
    const v = mount(
      'import { a } from "a";\nexport const f = function (x) {\n  if (x) return x;\n  const from = 1;\n  return from;\n};\n',
      [javascript(), syntaxHighlighting(openideaHighlightStyle), keywordRoles()],
    );
    expect(marked(v, "module")).toEqual(["import", "from", "export"]);
    expect(marked(v, "definition")).toEqual(["const", "function", "const"]);
    expect(marked(v, "control")).toEqual(["if"]);
    expect(marked(v, "return")).toEqual(["return", "return"]);
    // The role mark is the innermost span around the keyword's text.
    const ret = v.dom.querySelector(".cm-gp-kw-return")!;
    expect(ret.children).toHaveLength(0);
  });

  it("marks keywords of the tree-sitter highlighting", () => {
    const v = mount("fun main() { return }\n", [
      syntaxHighlighting(openideaHighlightStyle),
      syntaxHighlightField,
      keywordRoles(),
    ]);
    v.dispatch({ effects: setSyntaxHighlights.of({ kinds: ["keyword"], data: [0, 3, 0, 13, 19, 0] }) });
    expect(marked(v, "definition")).toEqual(["fun"]);
    expect(marked(v, "return")).toEqual(["return"]);
  });

  it("does nothing without keyword highlighting", () => {
    const v = mount("import return if\n", [keywordRoles()]);
    expect(v.dom.querySelectorAll("[class*=cm-gp-kw-]")).toHaveLength(0);
  });
});
