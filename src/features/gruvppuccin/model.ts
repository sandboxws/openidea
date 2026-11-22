/**
 * Gruvppuccin runtime settings (`settings.plugins.gruvppuccin`): the IntelliJ plugin's accent
 * slot with its tab / tool window / caret overrides, bold keywords, corner radii and presets.
 * Compact mode is OpenIDEA's own (`appearance.compactMode`), and the icon pack is the
 * Gruvppuccin icon theme (`appearance.fileIconTheme`); presets set both.
 */
import labelData from "./palettes.generated.json";

/** Plugin id of `plugins/gruvppuccin` and the `settings.plugins` namespace. */
export const PLUGIN_ID = "gruvppuccin";
export const ICON_THEME = `${PLUGIN_ID}/gruvppuccin`;

/** Accent slots: keys of saved settings and presets; what they look like depends on the palette. */
export const SLOTS = ["sapphire", "mauve", "red", "green", "yellow", "peach"] as const;
export type Slot = (typeof SLOTS)[number];
/** An override slot; empty follows the main accent. */
export type OverrideSlot = Slot | "";

export const COMPONENT_ARC = { min: 0, max: 20, default: 7 } as const;
export const ISLAND_ARC = { min: 0, max: 30, default: 20 } as const;

export interface Preset {
  name: string;
  accent: Slot;
  tabAccent: OverrideSlot;
  toolWindowAccent: OverrideSlot;
  caretAccent: OverrideSlot;
  boldKeywords: boolean;
  compactMode: boolean;
  iconPack: boolean;
  componentArc: number;
  islandArc: number;
}

export interface GruvppuccinSettings {
  accent: Slot;
  tabAccent: OverrideSlot;
  toolWindowAccent: OverrideSlot;
  caretAccent: OverrideSlot;
  boldKeywords: boolean;
  componentArc: number;
  islandArc: number;
  /** The preset last applied (cleared once a setting departs from it). */
  activePreset: string;
  customPresets: Preset[];
}

export const DEFAULT_SETTINGS: GruvppuccinSettings = {
  accent: "sapphire",
  tabAccent: "",
  toolWindowAccent: "",
  caretAccent: "",
  boldKeywords: false,
  componentArc: COMPONENT_ARC.default,
  islandArc: ISLAND_ARC.default,
  activePreset: "",
  customPresets: [],
};

/** The IntelliJ plugin's built-in presets. */
export const BUILT_IN_PRESETS: readonly Preset[] = [
  {
    name: "Warm Focus",
    accent: "peach",
    tabAccent: "peach",
    toolWindowAccent: "yellow",
    caretAccent: "yellow",
    boldKeywords: true,
    compactMode: false,
    iconPack: true,
    componentArc: 7,
    islandArc: 20,
  },
  {
    name: "High Contrast",
    accent: "red",
    tabAccent: "red",
    toolWindowAccent: "red",
    caretAccent: "yellow",
    boldKeywords: true,
    compactMode: true,
    iconPack: true,
    componentArc: 0,
    islandArc: 0,
  },
  {
    name: "Soft Island",
    accent: "mauve",
    tabAccent: "sapphire",
    toolWindowAccent: "sapphire",
    caretAccent: "mauve",
    boldKeywords: false,
    compactMode: false,
    iconPack: true,
    componentArc: 10,
    islandArc: 26,
  },
  {
    name: "Classic Dense",
    accent: "sapphire",
    tabAccent: "green",
    toolWindowAccent: "sapphire",
    caretAccent: "yellow",
    boldKeywords: false,
    compactMode: true,
    iconPack: true,
    componentArc: 4,
    islandArc: 12,
  },
];

const isSlot = (v: unknown): v is Slot => typeof v === "string" && (SLOTS as readonly string[]).includes(v);
const overrideSlot = (v: unknown): OverrideSlot => (isSlot(v) ? v : "");
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const arc = (v: unknown, range: { min: number; max: number; default: number }) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, Math.round(v))) : range.default;
const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "");

function readPreset(raw: unknown): Preset | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const name = text(p.name).trim();
  if (!name) return null;
  return {
    name,
    accent: isSlot(p.accent) ? p.accent : DEFAULT_SETTINGS.accent,
    tabAccent: overrideSlot(p.tabAccent),
    toolWindowAccent: overrideSlot(p.toolWindowAccent),
    caretAccent: overrideSlot(p.caretAccent),
    boldKeywords: bool(p.boldKeywords, false),
    compactMode: bool(p.compactMode, false),
    iconPack: bool(p.iconPack, true),
    componentArc: arc(p.componentArc, COMPONENT_ARC),
    islandArc: arc(p.islandArc, ISLAND_ARC),
  };
}

/** Stored settings, validated: anything unknown or out of range falls back to the default. */
export function readSettings(raw: unknown): GruvppuccinSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const s = raw as Record<string, unknown>;
  const presets = Array.isArray(s.customPresets) ? s.customPresets.map(readPreset).filter((p) => p !== null) : [];
  return {
    accent: isSlot(s.accent) ? s.accent : DEFAULT_SETTINGS.accent,
    tabAccent: overrideSlot(s.tabAccent),
    toolWindowAccent: overrideSlot(s.toolWindowAccent),
    caretAccent: overrideSlot(s.caretAccent),
    boldKeywords: bool(s.boldKeywords, DEFAULT_SETTINGS.boldKeywords),
    componentArc: arc(s.componentArc, COMPONENT_ARC),
    islandArc: arc(s.islandArc, ISLAND_ARC),
    activePreset: text(s.activePreset),
    customPresets: presets.slice(0, 32),
  };
}

/** The slot each accent target uses, overrides resolved. */
export function effectiveSlots(s: GruvppuccinSettings): Record<"accent" | "tab" | "toolWindow" | "caret", Slot> {
  return {
    accent: s.accent,
    tab: s.tabAccent || s.accent,
    toolWindow: s.toolWindowAccent || s.accent,
    caret: s.caretAccent || s.accent,
  };
}

/** The slot after `slot`, wrapping around (Next Accent Color). */
export function nextSlot(slot: Slot): Slot {
  return SLOTS[(SLOTS.indexOf(slot) + 1) % SLOTS.length]!;
}

/** Settings with `preset` applied (its compact mode and icon pack are applied separately). */
export function withPreset(s: GruvppuccinSettings, preset: Preset): GruvppuccinSettings {
  return {
    ...s,
    accent: preset.accent,
    tabAccent: preset.tabAccent,
    toolWindowAccent: preset.toolWindowAccent,
    caretAccent: preset.caretAccent,
    boldKeywords: preset.boldKeywords,
    componentArc: preset.componentArc,
    islandArc: preset.islandArc,
    activePreset: preset.name,
  };
}

/** The current settings saved as a preset named `name`. */
export function presetFrom(name: string, s: GruvppuccinSettings, compactMode: boolean, iconPack: boolean): Preset {
  return {
    name,
    accent: s.accent,
    tabAccent: s.tabAccent,
    toolWindowAccent: s.toolWindowAccent,
    caretAccent: s.caretAccent,
    boldKeywords: s.boldKeywords,
    compactMode,
    iconPack,
    componentArc: s.componentArc,
    islandArc: s.islandArc,
  };
}

/** Every preset: built-in first, then custom ones (a custom preset may not shadow a built-in name). */
export function allPresets(s: GruvppuccinSettings): Preset[] {
  const builtIn = new Set(BUILT_IN_PRESETS.map((p) => p.name));
  return [...BUILT_IN_PRESETS, ...s.customPresets.filter((p) => !builtIn.has(p.name))];
}

const LABELS = (labelData as { labels: Record<string, Partial<Record<Slot, string>>> }).labels;

/** What a slot is called in a palette: "Coral" for Rosewood's sapphire slot, else the slot name. */
export function slotLabel(palette: string | null, slot: Slot): string {
  return (palette && LABELS[palette]?.[slot]) || slot.charAt(0).toUpperCase() + slot.slice(1);
}
