/**
 * The Ruff the project would use (`pyidea_ruff_info`) and its rule catalog, asked once per
 * project and forgotten when the Ruff or Python interpreter settings change.
 */
import { call, commands, isTauri, type RuffInfo, type RuffRule } from "@/platform/ipc";
import { useProject } from "@/platform/project";

let root: string | null = null;
let info: Promise<RuffInfo | null> | null = null;
let rules: Promise<RuffRule[]> | null = null;

function current(): string | null {
  const r = useProject.getState().project?.root ?? null;
  if (r !== root) {
    root = r;
    info = null;
    rules = null;
  }
  return r;
}

export function ruffInfo(): Promise<RuffInfo | null> {
  if (!isTauri() || !current()) return Promise.resolve(null);
  info ??= call(commands.pyideaRuffInfo()).catch(() => null);
  return info;
}

export function ruffRules(): Promise<RuffRule[]> {
  if (!isTauri() || !current()) return Promise.resolve([]);
  rules ??= call(commands.pyideaRuffRules()).catch(() => {
    rules = null;
    return [];
  });
  return rules;
}

/** Ask again (Ruff installed, upgraded, or its settings changed). */
export function forgetRuff() {
  info = null;
  rules = null;
}

/** Forgets Ruff when the settings that choose it change. */
export function watchRuffSettings(): () => void {
  return useProject.subscribe((s, prev) => {
    const a = s.settings?.languages;
    const b = prev.settings?.languages;
    if (a?.ruff !== b?.ruff || a?.python !== b?.python) forgetRuff();
  });
}
