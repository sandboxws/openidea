import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PRESETS,
  DEFAULT_SETTINGS,
  allPresets,
  effectiveSlots,
  nextSlot,
  presetFrom,
  readSettings,
  slotLabel,
  withPreset,
} from "../model";

describe("readSettings", () => {
  it("falls back to the defaults for missing or invalid values", () => {
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings("x")).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ accent: "blue", tabAccent: "teal", componentArc: "7", boldKeywords: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("keeps valid values and clamps the arcs", () => {
    const s = readSettings({
      accent: "mauve",
      caretAccent: "yellow",
      componentArc: 99,
      islandArc: -3,
      boldKeywords: true,
    });
    expect(s).toMatchObject({
      accent: "mauve",
      caretAccent: "yellow",
      componentArc: 20,
      islandArc: 0,
      boldKeywords: true,
    });
  });

  it("drops custom presets without a name", () => {
    const s = readSettings({ customPresets: [{ name: " " }, { name: "Mine", accent: "green" }, null] });
    expect(s.customPresets.map((p) => [p.name, p.accent, p.componentArc])).toEqual([["Mine", "green", 7]]);
  });
});

describe("accent slots", () => {
  it("lets blank overrides follow the main accent", () => {
    const s = { ...DEFAULT_SETTINGS, accent: "peach" as const, caretAccent: "yellow" as const };
    expect(effectiveSlots(s)).toEqual({ accent: "peach", tab: "peach", toolWindow: "peach", caret: "yellow" });
  });

  it("cycles through the six slots", () => {
    expect(nextSlot("sapphire")).toBe("mauve");
    expect(nextSlot("peach")).toBe("sapphire");
  });

  it("names slots by the palette's own labels", () => {
    expect(slotLabel("nocturne-rosewood", "sapphire")).toBe("Coral");
    expect(slotLabel("mocha", "sapphire")).toBe("Sapphire");
    expect(slotLabel(null, "peach")).toBe("Peach");
  });
});

describe("presets", () => {
  it("ships the IntelliJ plugin's four presets", () => {
    expect(BUILT_IN_PRESETS.map((p) => p.name)).toEqual([
      "Warm Focus",
      "High Contrast",
      "Soft Island",
      "Classic Dense",
    ]);
    expect(BUILT_IN_PRESETS[1]).toMatchObject({ accent: "red", compactMode: true, componentArc: 0, islandArc: 0 });
  });

  it("applies a preset and remembers it", () => {
    const s = withPreset(DEFAULT_SETTINGS, BUILT_IN_PRESETS[0]!);
    expect(s).toMatchObject({
      accent: "peach",
      toolWindowAccent: "yellow",
      boldKeywords: true,
      activePreset: "Warm Focus",
    });
  });

  it("saves the current settings as a preset, never shadowing a built-in one", () => {
    const mine = presetFrom("Mine", { ...DEFAULT_SETTINGS, accent: "green" }, true, false);
    expect(mine).toMatchObject({ name: "Mine", accent: "green", compactMode: true, iconPack: false });
    const s = { ...DEFAULT_SETTINGS, customPresets: [mine, { ...mine, name: "Warm Focus", accent: "red" as const }] };
    expect(allPresets(s).map((p) => p.name)).toEqual([
      "Warm Focus",
      "High Contrast",
      "Soft Island",
      "Classic Dense",
      "Mine",
    ]);
    expect(allPresets(s)[0]!.accent).toBe("peach");
  });
});
