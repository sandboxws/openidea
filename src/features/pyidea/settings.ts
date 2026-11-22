/**
 * PyIdea settings (`settings.plugins.pyidea`): both Python save actions start enabled, as in
 * PyIdea, and either can be turned off for a project.
 */
import { useProject } from "@/platform/project";

export const NAMESPACE = "pyidea";

export interface PyideaSettings {
  /** Apply Ruff's safe lint fixes to a Python file before it's saved. */
  ruffFixOnSave: boolean;
  /** Format a Python file with Ruff before it's saved. */
  ruffFormatOnSave: boolean;
}

export const DEFAULT_PYIDEA: PyideaSettings = { ruffFixOnSave: true, ruffFormatOnSave: true };

export function readPyidea(raw: unknown): PyideaSettings {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    ruffFixOnSave: bool(s.ruffFixOnSave, DEFAULT_PYIDEA.ruffFixOnSave),
    ruffFormatOnSave: bool(s.ruffFormatOnSave, DEFAULT_PYIDEA.ruffFormatOnSave),
  };
}

/** The effective settings (project over global). */
export function pyideaSettings(): PyideaSettings {
  return readPyidea(useProject.getState().settings?.plugins?.[NAMESPACE]);
}
