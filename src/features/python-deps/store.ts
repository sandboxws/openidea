import { create } from "zustand";
import type {
  PythonDependencyGroupRef,
  PythonDependencyModel,
  PythonDependencyPreview,
  PythonStagedEdit,
  PythonSyncSelection,
} from "@/platform/ipc";
import { DEFAULT_SELECTION } from "./model";

export type DepsDialog =
  | { kind: "add" }
  | { kind: "edit"; group: PythonDependencyGroupRef; requirement: string }
  | { kind: "move"; group: PythonDependencyGroupRef; requirement: string }
  | { kind: "groups" };

export interface DepsState {
  /** The `pyproject.toml` shown. */
  path: string | null;
  model: PythonDependencyModel | null;
  loading: boolean;
  error: string | null;
  edits: PythonStagedEdit[];
  selection: PythonSyncSelection;
  preview: PythonDependencyPreview | null;
  /** Something the preview resolved changed since (files, edits, selection, interpreter). */
  stale: boolean;
  previewing: boolean;
  previewError: string | null;
  syncing: boolean;
  /** How the last sync ended. */
  synced: "ok" | "failed" | null;
  selected: string | null;
  tab: "details" | "changes";
  dialog: DepsDialog | null;
}

export const initialDeps = (): DepsState => ({
  path: null,
  model: null,
  loading: false,
  error: null,
  edits: [],
  selection: DEFAULT_SELECTION,
  preview: null,
  stale: false,
  previewing: false,
  previewError: null,
  syncing: false,
  synced: null,
  selected: null,
  tab: "details",
  dialog: null,
});

export const useDeps = create<DepsState>(initialDeps);
