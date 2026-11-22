/** The Project Dependencies tree: declared groups with their requirements, then transitive packages. */
import { tx } from "@/platform/i18n";
import type {
  PythonDeclaredRequirement,
  PythonDependencyGroupRef,
  PythonDependencyModel,
  PythonPackageState,
} from "@/platform/ipc";
import { groupKey, groupLabel } from "./model";

export interface DepsNode {
  key: string;
  label: string;
  detail?: string;
  icon: string;
  kind: "group" | "requirement" | "transitive" | "package";
  children: DepsNode[];
  group?: PythonDependencyGroupRef;
  requirement?: PythonDeclaredRequirement;
  package?: PythonPackageState;
}

/** `locked 3.1.3 · installed 3.1.2` for what's known. */
export function versionText(p: PythonPackageState | undefined): string | undefined {
  if (!p) return undefined;
  const parts: string[] = [];
  const locked = p.locked.join(" | ");
  if (locked) parts.push(tx`locked ${locked}`);
  const installed = p.installed;
  if (installed) parts.push(tx`installed ${installed}`);
  else if (locked) parts.push(tx("not installed"));
  return parts.join(" · ") || undefined;
}

export function buildTree(model: PythonDependencyModel): DepsNode[] {
  const byName = new Map(model.packages.map((p) => [p.name, p]));
  const groups: DepsNode[] = model.groups.map((g) => {
    const key = groupKey(g.group);
    return {
      key: `group:${key}`,
      label: groupLabel(g.group),
      detail: String(g.requirements.length),
      icon: g.group.kind === "build" ? "toolwindow-build" : "layers",
      kind: "group",
      group: g.group,
      children: g.requirements.map((r, i) => ({
        key: `req:${key}:${i}:${r.text}`,
        label: r.text,
        detail: r.staged ? tx("staged") : g.group.kind === "build" ? undefined : versionText(byName.get(r.package)),
        icon: r.staged ? "plus" : "package",
        kind: "requirement",
        group: g.group,
        requirement: r,
        package: byName.get(r.package),
        children: [],
      })),
    };
  });
  const transitive = model.packages.filter((p) => !p.direct);
  if (!transitive.length) return groups;
  return [
    ...groups,
    {
      key: "transitive",
      label: tx("Transitive packages"),
      detail: String(transitive.length),
      icon: "library",
      kind: "transitive",
      children: transitive.map((p) => ({
        key: `pkg:${p.name}`,
        label: p.name,
        detail: versionText(p),
        icon: "library",
        kind: "package",
        package: p,
        children: [],
      })),
    },
  ];
}

/** The node with `key`. */
export function findNode(roots: readonly DepsNode[], key: string | null): DepsNode | null {
  if (!key) return null;
  for (const n of roots) {
    if (n.key === key) return n;
    const found = findNode(n.children, key);
    if (found) return found;
  }
  return null;
}
