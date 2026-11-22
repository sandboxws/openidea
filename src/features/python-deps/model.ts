/** Labels and parsing for the Project Dependencies tool window. */
import { tx } from "@/platform/i18n";
import type {
  PythonDependencyGroupRef,
  PythonEnvironmentChange,
  PythonStagedEdit,
  PythonSyncSelection,
} from "@/platform/ipc";

export const groupKey = (g: PythonDependencyGroupRef) => `${g.kind}:${g.name}`;

export function groupLabel(g: PythonDependencyGroupRef): string {
  const name = g.name;
  switch (g.kind) {
    case "runtime":
      return tx("Runtime");
    case "extra":
      return tx`Extra: ${name}`;
    case "group":
      return tx`Group: ${name}`;
    case "uvDev":
      return tx("uv dev dependencies");
    case "build":
      return tx("Build requirements");
  }
}

/** A staged edit as the Changes list shows it. */
export function editLabel(e: PythonStagedEdit): string {
  switch (e.op) {
    case "add": {
      const { requirement } = e;
      const group = groupLabel(e.group);
      return tx`Add ${requirement} to ${group}`;
    }
    case "remove": {
      const { requirement } = e;
      const group = groupLabel(e.group);
      return tx`Remove ${requirement} from ${group}`;
    }
    case "replace": {
      const { requirement, with: replacement } = e;
      return tx`Change ${requirement} to ${replacement}`;
    }
    case "move": {
      const { requirement } = e;
      const group = groupLabel(e.to);
      return tx`Move ${requirement} to ${group}`;
    }
    case "upgrade": {
      const { package: name } = e;
      return tx`Upgrade ${name}`;
    }
  }
}

/** Dependency groups as typed: blank for uv's defaults, `-` for none, else a comma list. */
export function parseGroups(input: string): string[] | null {
  const text = input.trim();
  if (!text) return null;
  if (text === "-") return [];
  return text
    .split(/[\s,]+/)
    .map((g) => g.trim())
    .filter(Boolean);
}

export function formatGroups(groups: readonly string[] | null | undefined): string {
  if (groups == null) return "";
  return groups.length ? groups.join(", ") : "-";
}

export const DEFAULT_SELECTION: PythonSyncSelection = { extras: [], allExtras: false, groups: null, inexact: false };

/** Numeric-first comparison of two versions (enough to tell an upgrade from a downgrade). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.+-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    return String(p) < String(q) ? -1 : 1;
  }
  return 0;
}

export type ChangeKind = "install" | "remove" | "upgrade" | "downgrade" | "reinstall";

export function changeKind(c: PythonEnvironmentChange): ChangeKind {
  if (!c.before) return "install";
  if (!c.after) return "remove";
  const order = compareVersions(c.after, c.before);
  return order > 0 ? "upgrade" : order < 0 ? "downgrade" : "reinstall";
}
