/** Mojo settings (`settings.plugins.mojo`), per project or global. */
export const NAMESPACE = "mojo";

export interface MojoSettings {
  /** The environment holding `bin/mojo`, relative to the project; blank: look for it. */
  sdkDirectory: string;
  /** Extra import paths, one per line, relative to the project (source roots are added). */
  importPaths: string;
}

export function readMojo(raw: unknown): MojoSettings {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return { sdkDirectory: text(s.sdkDirectory), importPaths: text(s.importPaths) };
}
