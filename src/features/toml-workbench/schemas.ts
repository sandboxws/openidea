/**
 * The bundled TOML schemas (`ide_pyidea::toml::schemas`) as taplo associations in the global
 * `languageServers.taplo.settings.evenBetterToml.schema.associations`, beside the user's own.
 * Ours are recognized by their URL prefix: they follow the bundle and disappear when turned off.
 * A user association matching one of our files' names wins over ours.
 */
import type { TomlSchemaAssociation } from "@/platform/ipc";

type Associations = Record<string, string>;

/** Whether `pattern` (a taplo document pattern) matches a file named `file`. */
function matchesFile(pattern: string, file: string): boolean {
  try {
    return new RegExp(pattern).test(`file:///project/${file}`);
  } catch {
    return false;
  }
}

/** The associations to keep: `current` with ours replaced; null when nothing changes. */
export function mergeAssociations(
  current: Associations,
  ours: readonly TomlSchemaAssociation[],
  prefix: string,
  enabled: boolean,
): Associations | null {
  const user = Object.entries(current).filter(([, url]) => !url.startsWith(prefix));
  const next: Associations = Object.fromEntries(user);
  if (enabled) {
    for (const a of ours) {
      const overridden = user.some(([pattern]) => a.files.some((file) => matchesFile(pattern, file)));
      if (!overridden) next[a.pattern] = a.schema;
    }
  }
  const same =
    Object.keys(next).length === Object.keys(current).length &&
    Object.entries(next).every(([pattern, url]) => current[pattern] === url);
  return same ? null : next;
}

type Json = Record<string, unknown>;
const object = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** taplo's settings with `associations` in place (dropping objects that end up empty). */
export function withAssociations(settings: unknown, associations: Associations): Json | null {
  const root = { ...object(settings) };
  const toml = { ...object(root.evenBetterToml) };
  const schema = { ...object(toml.schema) };
  if (Object.keys(associations).length) schema.associations = associations;
  else delete schema.associations;
  if (Object.keys(schema).length) toml.schema = schema;
  else delete toml.schema;
  if (Object.keys(toml).length) root.evenBetterToml = toml;
  else delete root.evenBetterToml;
  return Object.keys(root).length ? root : null;
}

/** The associations in taplo's settings. */
export function associationsOf(settings: unknown): Associations {
  const found = object(object(object(settings).evenBetterToml).schema).associations;
  return Object.fromEntries(
    Object.entries(object(found)).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}
