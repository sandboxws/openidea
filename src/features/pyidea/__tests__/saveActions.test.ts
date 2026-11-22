import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const state = {
  ruff: { version: "0.13.5" } as { version: string } | null,
  result: null as string | null,
  formatsOnSave: false,
  settings: {} as Record<string, unknown>,
};

vi.mock("@/editor/lsp/actions", () => ({ formatsOnSave: () => state.formatsOnSave }));
vi.mock("../ruff", () => ({ ruffInfo: async () => state.ruff }));
vi.mock("@/platform/ipc", () => ({
  call: async (v: unknown) => v,
  nextRequestId: () => 1,
  commands: {
    pyideaRuffApply: (_path: string, _text: string, fix: boolean, format: boolean) => {
      calls.push(`ruff fix=${fix} format=${format}`);
      return state.result;
    },
  },
}));
vi.mock("@/platform/project", () => ({
  useProject: { getState: () => ({ settings: { plugins: { pyidea: state.settings } } }) },
}));

import { _saveParticipants } from "@/editor/api";
import { minimalChange, registerRuffOnSave } from "../saveActions";

function fakeView(text: string) {
  const view = {
    doc: text,
    state: { doc: { toString: () => view.doc } },
    dispatch: vi.fn(({ changes }: { changes: { from: number; to: number; insert: string } }) => {
      view.doc = view.doc.slice(0, changes.from) + changes.insert + view.doc.slice(changes.to);
      calls.push("apply");
    }),
  };
  return view;
}

const ctx = (language = "python") => ({ doc: 1, path: "/p/a.py", language, uiMode: "Python", readOnly: false });

async function save(view: ReturnType<typeof fakeView>, language = "python") {
  const off = registerRuffOnSave();
  try {
    const p = _saveParticipants().find((x) => x.id === "pyidea.ruffOnSave")!;
    await p.beforeSave(ctx(language), { view } as never, "explicit");
  } finally {
    off();
  }
}

beforeEach(() => {
  calls.length = 0;
  Object.assign(state, { ruff: { version: "0.13.5" }, result: null, formatsOnSave: false, settings: {} });
});

describe("minimalChange", () => {
  it("replaces only what differs", () => {
    expect(minimalChange("import os\nx=1\n", "import os\nx = 1\n")).toEqual({ from: 11, to: 12, insert: " = " });
    expect(minimalChange("abc", "abc")).toBeNull();
    expect(minimalChange("import os, sys\n", "import sys\n")).toEqual({ from: 7, to: 11, insert: "" });
  });
});

describe("Ruff on save", () => {
  it("runs before Code Cleanup and Format on Save", () => {
    const off = registerRuffOnSave();
    expect(_saveParticipants().find((x) => x.id === "pyidea.ruffOnSave")?.order).toBe(44);
    off();
  });

  it("fixes and formats with Ruff in one run and applies the result", async () => {
    state.result = "import sys\n";
    const view = fakeView("import os, sys\n");
    await save(view);
    expect(calls).toEqual(["ruff fix=true format=true", "apply"]);
    expect(view.doc).toBe("import sys\n");
  });

  it("leaves the file alone when Ruff changes nothing", async () => {
    await save(fakeView("x = 1\n"));
    expect(calls).toEqual(["ruff fix=true format=true"]);
  });

  it("doesn't format twice when Format on Save already formats Python", async () => {
    state.formatsOnSave = true;
    await save(fakeView("x=1\n"));
    expect(calls).toEqual(["ruff fix=true format=false"]);
  });

  it("follows the project's toggles", async () => {
    state.settings = { ruffFixOnSave: false };
    await save(fakeView("x=1\n"));
    expect(calls).toEqual(["ruff fix=false format=true"]);
    calls.length = 0;
    state.settings = { ruffFixOnSave: false, ruffFormatOnSave: false };
    await save(fakeView("x=1\n"));
    expect(calls).toEqual([]);
  });

  it("does nothing without Ruff or outside Python", async () => {
    state.ruff = null;
    await save(fakeView("x=1\n"));
    state.ruff = { version: "0.13.5" };
    await save(fakeView("x=1\n"), "rust");
    expect(calls).toEqual([]);
  });
});
