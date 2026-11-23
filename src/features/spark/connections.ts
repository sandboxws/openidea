/** Saving connections to the project's settings and their credentials to the OS credential store. */
import { call, commands } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { NAMESPACE, readConnections, type SecretKind, type SparkConnection } from "./model";
import { disconnect } from "./session";
import { useSpark } from "./store";

const selectedKey = (root: string) => `openidea.spark.selected:${root}`;

function rawSettings(): Record<string, unknown> {
  const plugins = useProject.getState().settings?.plugins as Record<string, unknown> | undefined;
  const raw = plugins?.[NAMESPACE];
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function storedSelection(root: string | undefined): string | null {
  if (!root) return null;
  try {
    return localStorage.getItem(selectedKey(root));
  } catch {
    return null;
  }
}

/** Reads the connections from the project's settings (after a load or a change). */
export function syncConnections() {
  const connections = readConnections(rawSettings());
  const root = useProject.getState().project?.root;
  useSpark.setState((s) => {
    const ids = new Set(connections.map((c) => c.id));
    for (const id of Object.keys(s.sessions)) if (!ids.has(id)) disconnect(id);
    const wanted = s.selected ?? storedSelection(root);
    const selected = wanted && ids.has(wanted) ? wanted : (connections[0]?.id ?? null);
    return { connections, selected };
  });
}

export function selectConnection(id: string) {
  useSpark.setState({ selected: id });
  const root = useProject.getState().project?.root;
  if (!root) return;
  try {
    localStorage.setItem(selectedKey(root), id);
  } catch {
    // Remembering the choice is a convenience.
  }
}

async function writeConnections(connections: SparkConnection[]) {
  const next = { ...rawSettings(), connections };
  const settings = await call(commands.settingsSet("project", `plugins.${NAMESPACE}`, JSON.stringify(next)));
  useProject.setState({ settings });
  syncConnections();
}

/** Credentials to save: a string replaces the saved one, `null` forgets it, absent keeps it. */
export type SecretChanges = Partial<Record<SecretKind, string | null>>;

export async function saveConnection(connection: SparkConnection, secrets: SecretChanges) {
  const list = useSpark.getState().connections;
  const next = list.some((c) => c.id === connection.id)
    ? list.map((c) => (c.id === connection.id ? connection : c))
    : [...list, connection];
  for (const [kind, value] of Object.entries(secrets) as Array<[SecretKind, string | null | undefined]>)
    if (value !== undefined) await call(commands.pyideaSparkSetSecret(connection.id, kind, value || null));
  await writeConnections(next);
  selectConnection(connection.id);
}

export async function removeConnection(id: string) {
  disconnect(id);
  for (const kind of ["token", "authorization", "conf"] as const)
    await call(commands.pyideaSparkSetSecret(id, kind, null)).catch(() => {});
  await writeConnections(useSpark.getState().connections.filter((c) => c.id !== id));
  useSpark.setState((s) => {
    const { [id]: _gone, ...sessions } = s.sessions;
    return { sessions, results: s.results.filter((r) => r.connection !== id) };
  });
}

export const readSecret = (id: string, kind: SecretKind) => call(commands.pyideaSparkSecret(id, kind));

export const resetSpark = () =>
  useSpark.setState({ sessions: {}, results: [], selected: null, editing: null, connections: [] });
