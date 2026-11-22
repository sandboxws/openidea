/**
 * PyIdea's TOML Workbench in the editor (FORK.md): bundled schemas for `pyproject.toml`,
 * `uv.toml` and `ruff.toml` through taplo, Find TOML Section, and each `pyproject.toml`
 * requirement's locked / installed version and PyPI version completion.
 */
import { activeEditor, registerEditorContribution } from "@/editor/api";
import { registerActions } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { call, commands, isTauri, onIdeEvent, type Settings, type TomlSchemas } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { registerOverlay, showStatusInfo } from "@/workbench/contributions";
import { versionCompletion } from "./completion";
import { versionHints } from "./hints";
import { associationsOf, mergeAssociations, withAssociations } from "./schemas";
import { tomlSections } from "./sections";
import { FindSection } from "./ui/FindSection";
import { openFindSection } from "./ui/store";

/** Global `plugins.tomlWorkbench` (its own namespace: Phase 1 keeps `plugins.pyidea` per project). */
const NAMESPACE = "tomlWorkbench";

function ownSettings(settings: Settings): Record<string, unknown> {
  return ((settings.plugins as Record<string, unknown> | undefined)?.[NAMESPACE] ?? {}) as Record<string, unknown>;
}

/** `plugins.tomlWorkbench.bundledSchemas` (default on). */
const schemasEnabled = (global: Settings) => ownSettings(global).bundledSchemas !== false;

let bundled: TomlSchemas | null = null;
let syncing: Promise<void> | null = null;
/** As last read from the global settings, for the action's check mark. */
let enabled = true;

/** Brings taplo's global schema associations in line with the bundle and the toggle. */
async function syncSchemas(): Promise<void> {
  if (!isTauri()) return;
  bundled ??= await call(commands.pyideaTomlSchemas());
  const global = await commands.settingsGetGlobal();
  const taplo = (global.languageServers as Record<string, { settings?: unknown }> | undefined)?.taplo;
  const current = associationsOf(taplo?.settings);
  enabled = schemasEnabled(global);
  const next = mergeAssociations(current, bundled.associations, bundled.prefix, enabled);
  if (!next) return;
  const settings = withAssociations(taplo?.settings, next);
  const settingsNext = await call(
    commands.settingsSet("global", "languageServers.taplo.settings", JSON.stringify(settings)),
  );
  useProject.setState({ settings: settingsNext });
}

function scheduleSync() {
  syncing ??= syncSchemas()
    .catch((e) => console.warn("[toml-workbench] schema sync", e))
    .finally(() => (syncing = null));
}

async function toggleSchemas() {
  const global = await commands.settingsGetGlobal();
  const on = !schemasEnabled(global);
  enabled = on;
  const settings = await call(
    commands.settingsSet(
      "global",
      `plugins.${NAMESPACE}`,
      JSON.stringify({ ...ownSettings(global), bundledSchemas: on }),
    ),
  );
  useProject.setState({ settings });
  showStatusInfo(on ? tx("Bundled TOML schemas on") : tx("Bundled TOML schemas off"));
}

function findSection() {
  const editor = activeEditor();
  const path = editor?.ctx.path;
  if (!editor || !path?.endsWith(".toml")) {
    showStatusInfo(tx("Open a TOML file to find its sections"));
    return;
  }
  const sections = tomlSections(editor.view.state.doc.toString());
  if (!sections.length) {
    showStatusInfo(tx("This file has no tables"));
    return;
  }
  openFindSection(path, sections);
}

export function activate(): () => void {
  scheduleSync();
  const disposers = [
    registerOverlay({ id: "tomlWorkbench.findSection", component: FindSection }),
    registerActions([
      {
        id: "tomlWorkbench.findSection",
        title: "Find TOML Section",
        category: "Tools",
        when: "projectOpen",
        keywords: ["toml", "table", "heading", "pyproject"],
        run: () => findSection(),
      },
      {
        id: "tomlWorkbench.toggleBundledSchemas",
        title: "Use Bundled TOML Schemas",
        category: "Tools",
        keywords: ["toml", "schema", "pyproject", "uv", "ruff", "taplo"],
        toggled: () => enabled,
        run: () => toggleSchemas(),
      },
    ]),
    onIdeEvent("settingsChanged", (e) => {
      if (e.key === `plugins.${NAMESPACE}` || e.key.startsWith("languageServers")) scheduleSync();
    }),
    registerEditorContribution({
      id: "tomlWorkbench.pyproject",
      extensions: (doc) =>
        doc.path.endsWith("/pyproject.toml") && !doc.readOnly && !doc.virtual
          ? [versionHints(doc), versionCompletion(doc)]
          : [],
    }),
  ];
  return () => disposers.reverse().forEach((d) => d());
}
