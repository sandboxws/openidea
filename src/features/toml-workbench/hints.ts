/**
 * The locked (`uv.lock`) and installed version after each `pyproject.toml` requirement,
 * refreshed when the file is saved, the lock changes or the interpreter does. Clicking one
 * selects its requirement.
 */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from "@codemirror/view";
import { onEditorEvent, whenSynced, type EditorDocContext } from "@/editor/api";
import { tx } from "@/platform/i18n";
import { call, commands, isTauri, nextRequestId, onIdeEvent, type PythonVersionHint } from "@/platform/ipc";

export interface HintText {
  text: string;
  /** Installed differs from the lock, or isn't installed. */
  mismatch: boolean;
}

/** What a hint shows; null when neither the lock nor the interpreter knows the package. */
export function hintText(hint: PythonVersionHint): HintText | null {
  const locked = hint.locked.join(" | ");
  const parts: string[] = [];
  if (locked) parts.push(tx`locked ${locked}`);
  if (hint.installed) {
    const installed = hint.installed;
    parts.push(tx`installed ${installed}`);
  } else if (locked) parts.push(tx("not installed"));
  if (!parts.length) return null;
  const mismatch = !!locked && (!hint.installed || !hint.locked.includes(hint.installed));
  return { text: parts.join(" · "), mismatch };
}

/** The quoted string ending before `pos` on its line (quotes excluded), from the closing quote back. */
export function stringBefore(line: string, pos: number): { from: number; to: number } | null {
  const before = line.slice(0, pos);
  const close = Math.max(before.lastIndexOf('"'), before.lastIndexOf("'"));
  if (close < 0) return null;
  const open = before.lastIndexOf(before[close]!, close - 1);
  return open < 0 ? null : { from: open + 1, to: close };
}

/** Where a hint goes: the line's end when only a comma follows the requirement, else right after it. */
export function hintPosition(lineText: string, lineFrom: number, quoteEnd: number): number {
  return /^\s*,?\s*$/.test(lineText.slice(quoteEnd - lineFrom)) ? lineFrom + lineText.length : quoteEnd;
}

class HintWidget extends WidgetType {
  constructor(readonly hint: HintText) {
    super();
  }

  eq(other: HintWidget) {
    return other.hint.text === this.hint.text && other.hint.mismatch === this.hint.mismatch;
  }

  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = this.hint.mismatch ? "cm-pyi-version cm-pyi-version-mismatch" : "cm-pyi-version";
    span.textContent = this.hint.text;
    span.title = tx("Select the requirement");
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(span);
      const line = view.state.doc.lineAt(pos);
      const range = stringBefore(line.text, pos - line.from);
      if (!range) return;
      view.dispatch({
        selection: { anchor: line.from + range.from, head: line.from + range.to },
        scrollIntoView: true,
      });
      view.focus();
    });
    return span;
  }

  /** The widget handles its own clicks (the editor would place the caret at the click). */
  ignoreEvent() {
    return true;
  }
}

const setHints = StateEffect.define<PythonVersionHint[]>();

const hintsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setHints)) continue;
      const doc = tr.state.doc;
      const widgets = effect.value.flatMap((hint) => {
        const text = hintText(hint);
        // The closing quote follows the string's contents.
        const quoteEnd = hint.to + 1;
        if (!text || quoteEnd > doc.length) return [];
        const line = doc.lineAt(quoteEnd);
        const at = hintPosition(line.text, line.from, quoteEnd);
        return [Decoration.widget({ widget: new HintWidget(text), side: 1 }).range(at)];
      });
      next = Decoration.set(widgets, true);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.baseTheme({
  ".cm-pyi-version": {
    marginLeft: "1.5em",
    color: "var(--fg-muted)",
    fontSize: "0.9em",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  ".cm-pyi-version:hover": { color: "var(--fg)", textDecoration: "underline" },
  ".cm-pyi-version-mismatch": { color: "var(--warning)" },
});

function fetcher(doc: EditorDocContext) {
  return ViewPlugin.define((view) => {
    let request: number | null = null;
    let disposed = false;
    const refresh = async () => {
      if (!isTauri() || disposed) return;
      if (request !== null) void commands.cancelRequest(request);
      const id = nextRequestId();
      request = id;
      try {
        await whenSynced(view);
        const hints = await call(commands.pyideaTomlHints(doc.doc, id));
        if (!disposed && request === id) view.dispatch({ effects: setHints.of(hints) });
      } catch {
        /* cancelled, or no interpreter: keep what's shown */
      } finally {
        if (request === id) request = null;
      }
    };
    const dir = doc.path.slice(0, doc.path.lastIndexOf("/") + 1);
    const offEditor = onEditorEvent((e) => {
      if (e.type === "docSaved" && e.path === doc.path) void refresh();
    });
    const offFs = onIdeEvent("fsChanged", (e) => {
      const touched = [...e.created, ...e.modified, ...e.removed].map(String);
      // The lock (here or in a workspace above), or an install into a venv.
      if (touched.some((p) => p.endsWith("/uv.lock") || (p.startsWith(dir) && p.includes("/site-packages/"))))
        void refresh();
    });
    const offSettings = onIdeEvent("settingsChanged", (e) => {
      if (e.key.startsWith("languages.python")) void refresh();
    });
    void refresh();
    return {
      destroy() {
        disposed = true;
        if (request !== null) void commands.cancelRequest(request);
        offEditor();
        offFs();
        offSettings();
      },
    };
  });
}

export function versionHints(doc: EditorDocContext): Extension {
  return [hintsField, theme, fetcher(doc)];
}
