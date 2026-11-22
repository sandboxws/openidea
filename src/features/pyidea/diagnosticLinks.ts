/**
 * Python problem hovers link the rule that reported a problem (`F401`, `reportUnusedImport`)
 * to its documentation, for Ruff, basedpyright, Pyright, ty, Pyrefly and mypy; the rule's code
 * is shown too when the hover doesn't already name it.
 */
import { EditorView } from "@codemirror/view";
import type { EditorDiagnostic } from "@/editor/lsp/diagnostics";
import { diagnosticRowDecorators } from "@/editor/lsp/hover";
import type { Diagnostic } from "@/platform/ipc";
import { tx } from "@/platform/i18n";
import { openExternalUrl } from "@/platform/openUrl";

export type PythonTool = "ruff" | "basedpyright" | "pyright" | "ty" | "pyrefly" | "mypy";

/** The Python tool that reported a problem, by its server, else its source. */
export function pythonTool(d: Pick<Diagnostic, "server" | "source">): PythonTool | null {
  const name = (d.server ?? d.source ?? "").toLowerCase();
  if (name === "ruff") return "ruff";
  if (name === "basedpyright") return "basedpyright";
  if (name === "pyright") return "pyright";
  if (name === "ty") return "ty";
  if (name === "pyrefly") return "pyrefly";
  if (name === "mypy") return "mypy";
  return null;
}

/** Documentation of `code`; Ruff's pages are named after the rule (`ruffName`). */
export function docsUrl(tool: PythonTool, code: string, ruffName?: string): string | null {
  const c = encodeURIComponent(code);
  switch (tool) {
    case "ruff":
      return ruffName ? `https://docs.astral.sh/ruff/rules/${encodeURIComponent(ruffName)}/` : null;
    case "basedpyright":
      return `https://docs.basedpyright.com/latest/configuration/config-files/#${c}`;
    case "pyright":
      return `https://microsoft.github.io/pyright/#/configuration?id=${c}`;
    case "ty":
      return `https://docs.astral.sh/ty/reference/rules/#${c}`;
    case "pyrefly":
      return `https://pyrefly.org/en/docs/error-kinds/#${c}`;
    case "mypy":
      return "https://mypy.readthedocs.io/en/stable/error_code_list.html";
  }
}

/** `ruff` code → rule name, filled once the catalog is loaded. */
const ruffNames = new Map<string, string>();

export function rememberRuffRules(rules: ReadonlyArray<{ code: string; name: string }>) {
  for (const r of rules) ruffNames.set(r.code, r.name);
}

function documentationLink(url: string): HTMLElement {
  const link = document.createElement("button");
  link.type = "button";
  link.className = "cm-lsp-link-button cm-pyi-diag-docs";
  link.textContent = tx("Documentation");
  link.title = url;
  link.addEventListener("mousedown", (e) => e.preventDefault());
  link.addEventListener("click", () => void openExternalUrl(url));
  return link;
}

function decorate(row: HTMLElement, d: EditorDiagnostic) {
  const problem = d.problem;
  if (!problem?.code) return;
  const tool = pythonTool(problem);
  if (!tool) return;
  const url = docsUrl(tool, problem.code, ruffNames.get(problem.code));
  // The hover's source line already names the code ("Ruff F401"): the link goes beside it.
  const source = row.querySelector<HTMLElement>(".cm-lsp-diag-source");
  if (source?.textContent?.includes(problem.code)) {
    if (url) source.append(" ", documentationLink(url));
    return;
  }
  const line = document.createElement("div");
  line.className = "cm-pyi-diag-rule";
  const code = document.createElement("code");
  code.textContent = problem.code;
  line.appendChild(code);
  if (url) line.appendChild(documentationLink(url));
  row.appendChild(line);
}

export const diagnosticRuleTheme = EditorView.baseTheme({
  ".cm-pyi-diag-rule": {
    gridColumn: "2",
    display: "flex",
    alignItems: "baseline",
    gap: "var(--space-2)",
    color: "var(--fg-subtle)",
    fontSize: "var(--fs-small)",
  },
  ".cm-pyi-diag-rule code": { fontFamily: "var(--font-mono)" },
  ".cm-pyi-diag-docs": { marginInlineStart: "var(--space-2)", fontSize: "var(--fs-small)" },
});

export function registerDiagnosticLinks(): () => void {
  diagnosticRowDecorators.add(decorate);
  return () => void diagnosticRowDecorators.delete(decorate);
}
