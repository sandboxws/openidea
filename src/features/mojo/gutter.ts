/** ▶ beside a Mojo file's `main`: click runs it, Alt-click debugs it (a fresh debug build either way). */
import { RangeSet, type Extension } from "@codemirror/state";
import { GutterMarker } from "@codemirror/view";
import { iconAreaSource, type EditorDocContext } from "@/editor/api";
import { tx } from "@/platform/i18n";
import { iconNode } from "@/ui/iconNode";
import { runMojoFile } from "./runner";

/** 0-based lines declaring a top-level `main`. */
export function mainLines(text: string): number[] {
  const out: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (/^(def|fn) main\(/.test(line)) out.push(i);
  });
  return out;
}

class MainMarker extends GutterMarker {
  override eq(other: GutterMarker) {
    return other instanceof MainMarker;
  }
  override toDOM(): Node {
    const el = iconNode("run", 14, "cm-mojo-main");
    el.title = tx("Run main (Alt-click: Debug)");
    return el;
  }
}

export function mojoGutter(ctx: EditorDocContext): Extension {
  return iconAreaSource.of({
    order: 12,
    markers(view) {
      const doc = view.state.doc;
      const text = doc.length > 512 * 1024 ? "" : doc.toString();
      return RangeSet.of(
        mainLines(text).map((line) => new MainMarker().range(doc.line(line + 1).from)),
        true,
      );
    },
    lineMarkerChange: (u) => u.docChanged,
    mousedown(view, block, event) {
      if (event.button !== 0) return false;
      const line = view.state.doc.lineAt(block.from).number - 1;
      if (!mainLines(view.state.doc.toString()).includes(line)) return false;
      void runMojoFile(ctx.path, event.altKey);
      return true;
    },
  });
}
