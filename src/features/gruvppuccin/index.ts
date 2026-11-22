/**
 * Gruvppuccin runtime (FORK.md): applies the IntelliJ plugin's accent, override, bold keyword,
 * corner radius and preset settings to the Gruvppuccin themes of `plugins/gruvppuccin`, and
 * colours keyword roles in the editor while one of those themes shows.
 */
import { registerEditorContribution } from "@/editor/api";
import { executeAction, registerActions } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { showContextMenu } from "@/ui";
import { showStatusInfo } from "@/workbench/contributions";
import { readVariant } from "./activeTheme";
import { keywordRoles } from "./keywordRoles";
import { BUILT_IN_PRESETS, ICON_THEME, allPresets, nextSlot, slotLabel, withPreset, type Preset } from "./model";
import { currentSettings, saveSettings, setGlobal, startRuntime } from "./runtime";
import { SETTINGS_PAGE, activateSettingsPages } from "./settingsPages";

async function applyPreset(preset: Preset) {
  await saveSettings(withPreset(currentSettings(), preset));
  await setGlobal("appearance.compactMode", preset.compactMode);
  await setGlobal("appearance.fileIconTheme", preset.iconPack ? ICON_THEME : "");
  showStatusInfo(tx`Gruvppuccin preset: ${tx(preset.name)}`);
}

function activateActions(): () => void {
  return registerActions([
    {
      id: "gruvppuccin.nextAccent",
      title: "Next Gruvppuccin Accent Color",
      category: "View",
      when: "gruvppuccinActive",
      keywords: ["accent", "color", "theme"],
      run: async () => {
        const s = currentSettings();
        const accent = nextSlot(s.accent);
        await saveSettings({ ...s, accent, activePreset: "" });
        showStatusInfo(tx`Gruvppuccin accent: ${slotLabel(readVariant()?.palette ?? null, accent)}`);
      },
    },
    {
      id: "gruvppuccin.applyPreset",
      title: "Apply Gruvppuccin Preset…",
      category: "View",
      when: "gruvppuccinActive",
      keywords: ["preset", "accent", "theme"],
      run: async ({ arg }) => {
        const presets = allPresets(currentSettings());
        const named = typeof arg === "string" ? presets.find((p) => p.name === arg) : undefined;
        if (named) return applyPreset(named);
        const active = currentSettings().activePreset;
        showContextMenu(
          "center",
          presets.map((p) => ({
            label: p.name,
            // Custom preset names are the user's text; built-in ones are translated.
            verbatim: !BUILT_IN_PRESETS.some((b) => b.name === p.name),
            checked: p.name === active,
            run: () => void applyPreset(p),
          })),
          { title: tx("Gruvppuccin Presets") },
        );
      },
    },
    {
      id: "gruvppuccin.openSettings",
      title: "Gruvppuccin Settings…",
      category: "View",
      keywords: ["accent", "preset", "corner radius", "theme"],
      run: () => void executeAction("file.settings", SETTINGS_PAGE),
    },
  ]);
}

/** Keyword-role marks in editors, only while a Gruvppuccin theme shows. */
function keywordRolesWhileActive() {
  let dispose: (() => void) | null = null;
  return {
    onActive(active: boolean) {
      dispose?.();
      dispose = active
        ? registerEditorContribution({ id: "gruvppuccin.keywordRoles", extensions: () => keywordRoles() })
        : null;
    },
    dispose: () => dispose?.(),
  };
}

export function activate(): () => void {
  const roles = keywordRolesWhileActive();
  const disposers = [
    startRuntime({ onActive: roles.onActive }),
    roles.dispose,
    activateActions(),
    activateSettingsPages(),
  ];
  return () => disposers.reverse().forEach((d) => d());
}
