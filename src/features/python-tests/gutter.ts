/**
 * Editor gutter of Python files: a run marker beside each function or class with doctest
 * examples (click runs its examples; it shows their result once run), and a lane marker beside
 * tests whose result went stale because the file changed after they ran. pytest pass / fail
 * markers come from the Run tool window's own gutter.
 */
import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { GutterMarker, ViewPlugin, type EditorView } from "@codemirror/view";
import { LaneMarker, gutterLaneMarkers, iconAreaSource, type EditorDocContext } from "@/editor/api";
import { tx } from "@/platform/i18n";
import { iconNode } from "@/ui/iconNode";
import { doctestOwners, type DoctestOwner } from "./doctest";
import { runTests } from "./runner";
import { usePythonTests } from "./store";

const MAX_SCAN = 512 * 1024;

export function doctestId(path: string, owner: DoctestOwner): string {
  return `${path}::${owner.symbol}`;
}

class DoctestMarker extends GutterMarker {
  constructor(
    readonly id: string,
    readonly state: "idle" | "passed" | "failed",
    readonly label: string,
  ) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof DoctestMarker && other.id === this.id && other.state === this.state;
  }
  override toDOM(): Node {
    const icon = this.state === "passed" ? "gutter-run-passed" : this.state === "failed" ? "gutter-run-failed" : "run";
    const el = iconNode(icon, 14, "cm-pyi-doctest");
    el.title = this.label;
    return el;
  }
}

const refresh = StateEffect.define<null>();

/** Doctest owners of the document, recomputed as it changes. */
const ownersField = StateField.define<DoctestOwner[]>({
  create: (state) => (state.doc.length > MAX_SCAN ? [] : doctestOwners(state.doc.toString())),
  update: (owners, tr) =>
    tr.docChanged ? (tr.state.doc.length > MAX_SCAN ? [] : doctestOwners(tr.state.doc.toString())) : owners,
});

/** Stale tests' lines, from the store. */
const staleField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setStale)) return e.value;
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (f) => gutterLaneMarkers.from(f),
});
const setStale = StateEffect.define<RangeSet<GutterMarker>>();

function staleMarkers(view: EditorView, path: string): RangeSet<GutterMarker> {
  const { tests, status } = usePythonTests.getState();
  const doc = view.state.doc;
  const marks = [];
  for (const t of tests) {
    const line = t.line ?? 0;
    if (t.file !== path || status[t.id] !== "stale" || line >= doc.lines) continue;
    marks.push(
      new LaneMarker("var(--warning)", "bar", tx("Changed since this test ran")).range(doc.line(line + 1).from),
    );
  }
  return RangeSet.of(marks, true);
}

export function pythonTestsGutter(ctx: EditorDocContext): Extension {
  if (ctx.virtual || ctx.language !== "python") return [];
  const path = ctx.path;
  const sync = ViewPlugin.define((view) => {
    let destroyed = false;
    const update = () => {
      if (destroyed) return;
      view.dispatch({ effects: [setStale.of(staleMarkers(view, path)), refresh.of(null)] });
    };
    const unsub = usePythonTests.subscribe((s, prev) => {
      if (s.status !== prev.status || s.tests !== prev.tests) queueMicrotask(update);
    });
    queueMicrotask(update);
    return {
      destroy() {
        destroyed = true;
        unsub();
      },
    };
  });
  return [
    ownersField,
    staleField,
    sync,
    iconAreaSource.of({
      order: 12,
      markers(view) {
        const { status } = usePythonTests.getState();
        const doc = view.state.doc;
        const marks = [];
        for (const owner of view.state.field(ownersField)) {
          if (owner.line >= doc.lines) continue;
          const id = doctestId(path, owner);
          const st = status[id];
          const state = st === "passed" ? "passed" : st === "failed" ? "failed" : "idle";
          const label = owner.symbol ? tx`Run doctests of ${owner.symbol}` : tx("Run the module's doctests");
          marks.push(new DoctestMarker(id, state, label).range(doc.line(owner.line + 1).from));
        }
        return RangeSet.of(marks, true);
      },
      lineMarkerChange: (u) => u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh))),
      mousedown(view, block, event) {
        if (event.button !== 0) return false;
        const line = view.state.doc.lineAt(block.from).number - 1;
        const owner = view.state.field(ownersField).find((o) => o.line === line);
        if (!owner) return false;
        void runTests([doctestId(path, owner)], { framework: "doctest", debug: event.altKey });
        return true;
      },
    }),
  ];
}
