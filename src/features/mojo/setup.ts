/**
 * Points the project at its Mojo SDK: the SDK's language server as the project's
 * `languageServers.mojo` (for `mojo` files, with the import paths) and its LLDB debug adapter
 * launcher as `tools.lldb-dap.path`. Written to the project's settings only when they differ,
 * and only for a project with an SDK.
 */
import { call, commands, isTauri, type Settings } from "@/platform/ipc";
import { useProject } from "@/platform/project";

type Json = unknown;

/** Structural equality of JSON values (key order ignored). */
export function sameJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, Json>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, Json>)[k] !== undefined);
  return (
    ka.length === kb.length && ka.every((k) => sameJson((a as Record<string, Json>)[k], (b as Record<string, Json>)[k]))
  );
}

/** The keys of `server` the settings hold now (other keys of the entry are the user's). */
export function serverDiffers(current: Json, server: Record<string, Json>): boolean {
  const entry = (current && typeof current === "object" ? current : {}) as Record<string, Json>;
  return Object.entries(server).some(([k, v]) => !sameJson(entry[k], v));
}

let syncing: Promise<boolean> | null = null;

async function write(key: string, value: Json): Promise<void> {
  const settings = await call(commands.settingsSet("project", key, JSON.stringify(value)));
  useProject.setState({ settings });
}

/** Configures the project for its SDK; false when it has none. */
export function syncMojoSetup(): Promise<boolean> {
  syncing ??= (async () => {
    if (!isTauri() || !useProject.getState().project) return false;
    const setup = await call(commands.pyideaMojoSetup());
    if (!setup) return false;
    const settings: Settings | null = useProject.getState().settings;
    const servers = settings?.languageServers as Record<string, Json> | undefined;
    const server = setup.server as Record<string, Json>;
    if (serverDiffers(servers?.mojo, server)) {
      const entry = servers?.mojo && typeof servers.mojo === "object" ? (servers.mojo as Record<string, Json>) : {};
      await write("languageServers.mojo", { ...entry, ...server });
    }
    const tools = settings?.tools as Record<string, { path?: string }> | undefined;
    if (setup.adapter && tools?.["lldb-dap"]?.path !== String(setup.adapter))
      await write("tools.lldb-dap", { ...tools?.["lldb-dap"], path: String(setup.adapter) });
    return true;
  })().finally(() => (syncing = null));
  return syncing;
}
