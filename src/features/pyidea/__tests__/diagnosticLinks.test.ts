import { afterEach, describe, expect, it } from "vitest";
import { diagnosticRowDecorators } from "@/editor/lsp/hover";
import type { EditorDiagnostic } from "@/editor/lsp/diagnostics";
import { docsUrl, pythonTool, registerDiagnosticLinks, rememberRuffRules } from "../diagnosticLinks";

describe("pythonTool", () => {
  it("names the reporting tool by server, then source", () => {
    expect(pythonTool({ server: "ruff", source: "Ruff" })).toBe("ruff");
    expect(pythonTool({ server: null, source: "Pyright" })).toBe("pyright");
    expect(pythonTool({ server: "basedpyright", source: "basedpyright" })).toBe("basedpyright");
    expect(pythonTool({ server: "rust-analyzer", source: "rustc" })).toBeNull();
  });
});

describe("docsUrl", () => {
  it("links each tool's rule documentation", () => {
    expect(docsUrl("ruff", "F401", "unused-import")).toBe("https://docs.astral.sh/ruff/rules/unused-import/");
    expect(docsUrl("ruff", "F401")).toBeNull();
    expect(docsUrl("basedpyright", "reportUnusedImport")).toBe(
      "https://docs.basedpyright.com/latest/configuration/config-files/#reportUnusedImport",
    );
    expect(docsUrl("pyright", "reportAttributeAccessIssue")).toBe(
      "https://microsoft.github.io/pyright/#/configuration?id=reportAttributeAccessIssue",
    );
    expect(docsUrl("ty", "unresolved-import")).toBe("https://docs.astral.sh/ty/reference/rules/#unresolved-import");
    expect(docsUrl("pyrefly", "bad-return")).toBe("https://pyrefly.org/en/docs/error-kinds/#bad-return");
  });
});

describe("problem hover rows", () => {
  let off: (() => void) | null = null;
  afterEach(() => off?.());

  const row = (problem: EditorDiagnostic["problem"]) => {
    const el = document.createElement("div");
    const d = { from: 0, to: 1, severity: "warning", message: "m", problem } as EditorDiagnostic;
    for (const decorate of diagnosticRowDecorators) decorate(el, d);
    return el;
  };
  const range = { start: { line: 0, col: 0 }, end: { line: 0, col: 1 } };

  it("adds the rule code and a documentation link to Python problems only", () => {
    off = registerDiagnosticLinks();
    rememberRuffRules([{ code: "F401", name: "unused-import" }]);
    const ruff = row({ range, severity: "warning", message: "m", source: "Ruff", code: "F401", server: "ruff" });
    expect(ruff.querySelector(".cm-pyi-diag-rule code")?.textContent).toBe("F401");
    expect(ruff.querySelector("button")?.title).toBe("https://docs.astral.sh/ruff/rules/unused-import/");

    const rust = row({
      range,
      severity: "error",
      message: "m",
      source: "rustc",
      code: "E0308",
      server: "rust-analyzer",
    });
    expect(rust.children).toHaveLength(0);
    const noCode = row({ range, severity: "error", message: "m", source: "Pyright", code: null, server: "pyright" });
    expect(noCode.children).toHaveLength(0);
  });

  it("puts the link beside a source line that already names the code", () => {
    off = registerDiagnosticLinks();
    const el = document.createElement("div");
    const source = document.createElement("span");
    source.className = "cm-lsp-diag-source";
    source.textContent = "ty unresolved-reference";
    el.appendChild(source);
    const problem = {
      range,
      severity: "error" as const,
      message: "m",
      source: "ty",
      code: "unresolved-reference",
      server: "ty",
    };
    for (const decorate of diagnosticRowDecorators)
      decorate(el, { from: 0, to: 1, severity: "error", message: "m", problem } as EditorDiagnostic);
    expect(el.querySelector(".cm-pyi-diag-rule")).toBeNull();
    expect(source.querySelector("button")?.title).toBe(
      "https://docs.astral.sh/ty/reference/rules/#unresolved-reference",
    );
  });

  it("stops decorating once disposed", () => {
    registerDiagnosticLinks()();
    expect(diagnosticRowDecorators.size).toBe(0);
  });
});
