/**
 * Settings › Appearance › Gruvppuccin: the IntelliJ plugin's accent, override, keyword,
 * corner radius and preset settings. Edits are staged like any settings page and applied
 * on Apply / OK.
 */
import { useState, useSyncExternalStore } from "react";
import { tx } from "@/platform/i18n";
import { Button, Checkbox, Input, Select, T } from "@/ui";
import { useSettingsForm } from "@/workbench/contributions";
import { readVariant, trackVariant, type ActiveVariant } from "./activeTheme";
import {
  COMPONENT_ARC,
  ICON_THEME,
  ISLAND_ARC,
  PLUGIN_ID,
  SLOTS,
  allPresets,
  presetFrom,
  readSettings,
  slotLabel,
  withPreset,
  type GruvppuccinSettings,
  type OverrideSlot,
  type Preset,
  type Slot,
} from "./model";
import styles from "./Gruvppuccin.module.css";

let variantSnapshot: ActiveVariant | null = null;
function subscribeVariant(onChange: () => void) {
  return trackVariant((v) => {
    variantSnapshot = v;
    onChange();
  });
}
function useActiveVariant(): ActiveVariant | null {
  return useSyncExternalStore(
    subscribeVariant,
    () => variantSnapshot ?? readVariant(),
    () => null,
  );
}

const OVERRIDES: Array<{ key: "tabAccent" | "toolWindowAccent" | "caretAccent"; label: string }> = [
  { key: "tabAccent", label: "Editor tab accent" },
  { key: "toolWindowAccent", label: "Tool window tab accent" },
  { key: "caretAccent", label: "Caret accent" },
];

function Swatches({
  palette,
  value,
  onChange,
}: {
  palette: string | null;
  value: Slot;
  onChange: (slot: Slot) => void;
}) {
  return (
    <div className={styles.swatches} role="radiogroup" aria-label={tx("Accent color")}>
      {SLOTS.map((slot) => {
        const label = slotLabel(palette, slot);
        return (
          <button
            key={slot}
            type="button"
            role="radio"
            aria-checked={value === slot}
            aria-label={label}
            title={label}
            className={styles.swatch}
            data-slot-color={slot}
            onClick={() => onChange(slot)}
          />
        );
      })}
    </div>
  );
}

function ArcRow({
  label,
  value,
  range,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number };
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.arc} data-disabled={disabled || undefined}>
      <span className={styles.label}>
        <T>{label}</T>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={tx(label)}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <span className={styles.value}>{value}</span>
    </label>
  );
}

export function GruvppuccinSettingsPage() {
  const form = useSettingsForm();
  const plugins = form.useValue("plugins") as Record<string, unknown> | undefined;
  const s = readSettings(plugins?.[PLUGIN_ID]);
  const compact = form.useValue("appearance.compactMode") === true;
  const iconPack = form.useValue("appearance.fileIconTheme") === ICON_THEME;
  const variant = useActiveVariant();
  const palette = variant?.palette ?? null;
  const [presetName, setPresetName] = useState("");

  const stage = (patch: Partial<GruvppuccinSettings>) => {
    for (const [key, value] of Object.entries(patch)) form.setMapEntry("plugins", [PLUGIN_ID, key], value);
  };
  /** A change that departs from the last preset. */
  const change = (patch: Partial<GruvppuccinSettings>) => stage({ ...patch, activePreset: "" });

  const applyPreset = (preset: Preset) => {
    const next = withPreset(s, preset);
    stage({
      accent: next.accent,
      tabAccent: next.tabAccent,
      toolWindowAccent: next.toolWindowAccent,
      caretAccent: next.caretAccent,
      boldKeywords: next.boldKeywords,
      componentArc: next.componentArc,
      islandArc: next.islandArc,
      activePreset: next.activePreset,
    });
    form.set("appearance.compactMode", preset.compactMode);
    form.set("appearance.fileIconTheme", preset.iconPack ? ICON_THEME : "");
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name || allPresets(s).some((p) => p.name === name && !s.customPresets.includes(p))) return;
    const preset = presetFrom(name, s, compact, iconPack);
    stage({ customPresets: [...s.customPresets.filter((p) => p.name !== name), preset], activePreset: name });
    setPresetName("");
  };
  const deletePreset = (name: string) =>
    stage({
      customPresets: s.customPresets.filter((p) => p.name !== name),
      ...(s.activePreset === name ? { activePreset: "" } : {}),
    });

  const overrideOptions = [
    { value: "" as OverrideSlot, label: tx("Follow main accent") },
    ...SLOTS.map((slot) => ({ value: slot as OverrideSlot, label: slotLabel(palette, slot) })),
  ];
  const custom = new Set(s.customPresets.map((p) => p.name));

  return (
    <div className={styles.page}>
      {!variant && (
        <p className={styles.hint}>
          <T>
            Choose a Gruvppuccin theme in Settings › Appearance to see these settings. They apply to every Gruvppuccin
            theme.
          </T>
        </p>
      )}

      <section className={styles.section} aria-label={tx("Accent")}>
        <h3 className={styles.heading}>
          <T>Accent</T>
        </h3>
        <div className={styles.row}>
          <span className={styles.label}>
            <T>Accent color</T>
          </span>
          <Swatches palette={palette} value={s.accent} onChange={(accent) => change({ accent })} />
          <span className={styles.value}>{slotLabel(palette, s.accent)}</span>
        </div>
        {OVERRIDES.map(({ key, label }) => (
          <div className={styles.row} key={key}>
            <span className={styles.label}>
              <T>{label}</T>
            </span>
            <Select
              value={s[key]}
              options={overrideOptions}
              onChange={(value) => change({ [key]: value })}
              aria-label={tx(label)}
            />
          </div>
        ))}
      </section>

      <section className={styles.section} aria-label={tx("Editor and layout")}>
        <h3 className={styles.heading}>
          <T>Editor and layout</T>
        </h3>
        <Checkbox
          checked={s.boldKeywords}
          onChange={(boldKeywords) => change({ boldKeywords })}
          label="Bold keywords"
        />
        <Checkbox
          checked={compact}
          onChange={(value) => form.set("appearance.compactMode", value)}
          label="Compact mode"
        />
        <Checkbox
          checked={iconPack}
          onChange={(value) => form.set("appearance.fileIconTheme", value ? ICON_THEME : "")}
          label="Gruvppuccin file icons"
        />
        <ArcRow
          label="Component corner radius"
          value={s.componentArc}
          range={COMPONENT_ARC}
          onChange={(componentArc) => change({ componentArc })}
        />
        <ArcRow
          label="Island corner radius"
          value={s.islandArc}
          range={ISLAND_ARC}
          disabled={variant?.style === "classic"}
          onChange={(islandArc) => change({ islandArc })}
        />
      </section>

      <section className={styles.section} aria-label={tx("Presets")}>
        <h3 className={styles.heading}>
          <T>Presets</T>
        </h3>
        <ul className={styles.presets}>
          {allPresets(s).map((preset) => (
            <li key={preset.name} className={styles.preset} data-active={s.activePreset === preset.name || undefined}>
              <Button size="small" onClick={() => applyPreset(preset)}>
                {custom.has(preset.name) ? <span>{preset.name}</span> : <T>{preset.name}</T>}
              </Button>
              {custom.has(preset.name) && (
                <Button
                  size="small"
                  variant="ghost"
                  icon="close"
                  aria-label={tx`Delete preset ${preset.name}`}
                  onClick={() => deletePreset(preset.name)}
                />
              )}
            </li>
          ))}
        </ul>
        <div className={styles.row}>
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.currentTarget.value)}
            placeholder={tx("Preset name")}
            aria-label={tx("Preset name")}
          />
          <Button size="small" disabled={!presetName.trim()} onClick={savePreset}>
            Save Current as Preset
          </Button>
        </div>
      </section>
    </div>
  );
}
