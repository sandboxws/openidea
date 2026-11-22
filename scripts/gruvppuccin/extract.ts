/**
 * Builds `plugins/gruvppuccin/data/palettes.json` (and copies the file icons) from the
 * Gruvppuccin IntelliJ theme plugin's sources, the one place the theme values come from:
 *
 *   node scripts/gruvppuccin/extract.ts <gruvppuccin-intellij-checkout>
 *
 * Per palette it keeps the classic theme's ramp, the accent picker's six swatches and
 * their labels (`GruvppuccinPalette.kt`), the IntelliJ `ui` keys the generator maps
 * (resolved to hex), how the Island and Soft Island files differ from the classic one,
 * and the editor scheme's colours and attributes, with `baseAttributes` chains resolved.
 * `generate.ts` reads only that file, so regenerating never needs the IntelliJ checkout.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCENTS,
  RAMP,
  SCHEME_ATTRIBUTE_KEYS,
  SCHEME_COLOR_KEYS,
  UI_KEYS_USED,
  type Accent,
  type Ramp,
} from "./model.ts";

export interface Attr {
  fg?: string;
  bg?: string;
  effect?: string;
  effectType?: number;
  /** 1 bold, 2 italic, 3 both. */
  fontType?: number;
  stripe?: string;
}

export type Family = "gruvppuccin" | "gruvbark" | "embark" | "nocturne";

export interface PaletteData {
  /** Theme id stem in the plugin: `mocha`, `gruvbark-nebula`, `nocturne-tidewater`. */
  id: string;
  /** IntelliJ resource stem: `gruvppuccin_mocha`. */
  stem: string;
  name: string;
  kind: "dark" | "light";
  family: Family;
  ramp: Record<Ramp, string>;
  /** The theme file's own accent slots (what its syntax and UI were built from). */
  accents: Record<Accent, string>;
  /** The accent picker's swatches (`GruvppuccinPalette.kt`), and their labels. */
  swatches: Record<Accent, string>;
  labels: Record<Accent, string>;
  /** Classic theme `ui`, resolved to hex, for the keys the generator maps. */
  ui: Record<string, string>;
  /** Keys whose resolved value differs from the classic file, per island style. */
  styles: { island: Record<string, string>; softIsland: Record<string, string> };
  scheme: { parent: string; colors: Record<string, string>; attributes: Record<string, Attr> };
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function hex(value: string): string {
  const m = HEX.exec(value.trim());
  if (!m) throw new Error(`not a colour: ${value}`);
  const digits = m[1]!.toLowerCase();
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  return `#${full}`;
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Flattens nested `ui` objects to dotted keys (`"*": {background}` → `*.background`). */
export function flattenUi(
  obj: { [k: string]: Json },
  prefix = "",
  out = new Map<string, string>(),
): Map<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flattenUi(v, key, out);
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out.set(key, String(v));
  }
  return out;
}

/** A `ui` value as hex: literal colours, or names from the theme's `colors` block. */
export function resolveUiColor(value: string, named: Record<string, string>): string | null {
  if (HEX.test(value)) return hex(value);
  const ref = named[value];
  return ref && HEX.test(ref) ? hex(ref) : null;
}

/**
 * The value IntelliJ uses for `key` in a theme's `ui`: the exact key, else the `*.prop`
 * wildcard for its last segment.
 */
export function uiValue(flat: Map<string, string>, key: string): string | undefined {
  const exact = flat.get(key);
  if (exact !== undefined) return exact;
  const prop = key.slice(key.lastIndexOf(".") + 1);
  return flat.get(`*.${prop}`);
}

function resolvedUi(json: { colors?: Record<string, string>; ui?: { [k: string]: Json } }, keys: readonly string[]) {
  const flat = flattenUi(json.ui ?? {});
  const out: Record<string, string> = {};
  for (const key of keys) {
    const raw = uiValue(flat, key);
    if (raw === undefined) continue;
    const value = /^\d+(\.\d+)?$/.test(raw) ? raw : resolveUiColor(raw, json.colors ?? {});
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * Reads an IntelliJ editor scheme: `<colors>` options and `<attributes>` options (an own
 * `<value>` block, or a `baseAttributes` reference resolved down its chain). A key defined
 * twice keeps its last definition, as IntelliJ does.
 */
export function parseScheme(xml: string): {
  name: string;
  parent: string;
  colors: Record<string, string>;
  attributes: Record<string, Attr>;
} {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  const head = /<scheme\s[^>]*>/.exec(text)?.[0] ?? "";
  const name = /\sname="([^"]*)"/.exec(head)?.[1] ?? "";
  const parent = /\sparent_scheme="([^"]*)"/.exec(head)?.[1] ?? "";

  const colors: Record<string, string> = {};
  const colorsBody = /<colors>([\s\S]*?)<\/colors>/.exec(text)?.[1] ?? "";
  for (const m of colorsBody.matchAll(/<option\s+name="([^"]*)"\s+value="([^"]*)"\s*\/>/g)) {
    if (m[2] && HEX.test(m[2])) colors[m[1]!] = hex(m[2]);
  }

  const own = new Map<string, Attr>();
  const base = new Map<string, string>();
  const attrsBody = /<attributes>([\s\S]*?)<\/attributes>/.exec(text)?.[1] ?? "";
  // Top-level options of <attributes>: either self-closing (baseAttributes) or with a <value> block.
  const top = /<option\s+name="([^"]*)"(?:\s+baseAttributes="([^"]*)")?\s*(\/>|>([\s\S]*?)<\/option>)/g;
  for (const m of attrsBody.matchAll(top)) {
    const key = m[1]!;
    if (m[3] === "/>") {
      own.delete(key);
      if (m[2]) base.set(key, m[2]);
      else base.delete(key);
      continue;
    }
    base.delete(key);
    const attr: Attr = {};
    for (const o of (m[4] ?? "").matchAll(/<option\s+name="([^"]*)"\s+value="([^"]*)"\s*\/>/g)) {
      const [, part, value] = o;
      if (!value) continue;
      if (part === "FOREGROUND" && HEX.test(value)) attr.fg = hex(value);
      else if (part === "BACKGROUND" && HEX.test(value)) attr.bg = hex(value);
      else if (part === "EFFECT_COLOR" && HEX.test(value)) attr.effect = hex(value);
      else if (part === "ERROR_STRIPE_COLOR" && HEX.test(value)) attr.stripe = hex(value);
      else if (part === "EFFECT_TYPE") attr.effectType = Number(value);
      else if (part === "FONT_TYPE") attr.fontType = Number(value);
    }
    own.set(key, attr);
  }

  const attributes: Record<string, Attr> = {};
  const resolve = (key: string, depth = 0): Attr | undefined => {
    if (depth > 16) return undefined;
    const value = own.get(key);
    if (value) return value;
    const parentKey = base.get(key);
    return parentKey ? resolve(parentKey, depth + 1) : undefined;
  };
  for (const key of new Set([...own.keys(), ...base.keys()])) {
    const value = resolve(key);
    if (value) attributes[key] = value;
  }
  return { name, parent, colors, attributes };
}

/** `private val NAME = mapOf("slot" to "#hex", …)` blocks and the `PALETTES` / `LABELS` maps of GruvppuccinPalette.kt. */
export function parseAccentPicker(kotlin: string): {
  swatches: Record<string, Record<string, string>>;
  labels: Record<string, Record<string, string>>;
} {
  const maps = new Map<string, Record<string, string>>();
  for (const m of kotlin.matchAll(/private val (\w+) = mapOf\(([\s\S]*?)\n\s*\)/g)) {
    const entries: Record<string, string> = {};
    for (const e of m[2]!.matchAll(/"(\w+)" to "(#[0-9a-fA-F]{6})"/g)) entries[e[1]!] = e[2]!.toLowerCase();
    if (Object.keys(entries).length) maps.set(m[1]!, entries);
  }
  const swatches: Record<string, Record<string, string>> = {};
  const palettes = /private val PALETTES = mapOf\(([\s\S]*?)\n\s*\)/.exec(kotlin)?.[1] ?? "";
  for (const e of palettes.matchAll(/"(\w+)" to (\w+)/g)) {
    const map = maps.get(e[2]!);
    if (map) swatches[e[1]!] = map;
  }
  const labels: Record<string, Record<string, string>> = {};
  const labelBlock = /private val LABELS = mapOf\(([\s\S]*?)\n\s*\)/.exec(kotlin)?.[1] ?? "";
  for (const line of labelBlock.matchAll(/"(\w+)" to mapOf\(([^)]*)\)/g)) {
    const entries: Record<string, string> = {};
    for (const e of line[2]!.matchAll(/"(\w+)" to "([^"]+)"/g)) entries[e[1]!] = e[2]!;
    labels[line[1]!] = entries;
  }
  return { swatches, labels };
}

export function family(stem: string): Family {
  if (stem.startsWith("gruvbark_")) return "gruvbark";
  if (stem.startsWith("gruvppuccin_nocturne_")) return "nocturne";
  if (/^gruvppuccin_(nebula|void|nova|haze)$/.test(stem)) return "embark";
  return "gruvppuccin";
}

/** `gruvppuccin_mocha` → `mocha`; `gruvbark_nebula` → `gruvbark-nebula`. */
export function paletteId(stem: string): string {
  return stem.replace(/^gruvppuccin_/, "").replaceAll("_", "-");
}

/** The picker's variant key for a resource stem (`gruvppuccin_mocha` → `mocha`). */
function variantKey(stem: string): string {
  return /^gruvppuccin_(macchiato|mocha|latte)$/.test(stem) ? stem.slice("gruvppuccin_".length) : stem;
}

/** The fork has no editions: "Gruvppuccin (Lifetime) Rosewood" is "Gruvppuccin Nocturne Rosewood". */
export function displayName(name: string): string {
  return name.replace("(Lifetime) ", "Nocturne ");
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function readJson(path: string): {
  name: string;
  dark: boolean;
  colors: Record<string, string>;
  ui: { [k: string]: Json };
} {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function extract(checkout: string): PaletteData[] {
  const res = join(checkout, "src/main/resources");
  const kotlin = readFileSync(join(checkout, "src/main/kotlin/com/gruvppuccin/theme/GruvppuccinPalette.kt"), "utf8");
  const picker = parseAccentPicker(kotlin);
  const stems = readdirSync(res)
    .filter((f) => f.endsWith(".theme.json") && !/_island\.theme\.json$/.test(f))
    .map((f) => f.slice(0, -".theme.json".length))
    .sort();

  return stems.map((stem): PaletteData => {
    const classic = readJson(join(res, `${stem}.theme.json`));
    const island = readJson(join(res, `${stem}_island.theme.json`));
    const soft = readJson(join(res, `${stem}_soft_island.theme.json`));
    const ramp = Object.fromEntries(RAMP.map((k) => [k, hex(classic.colors[k]!)])) as Record<Ramp, string>;
    const accents = Object.fromEntries(ACCENTS.map((k) => [k, hex(classic.colors[k]!)])) as Record<Accent, string>;
    const key = variantKey(stem);
    const swatches = picker.swatches[key] ?? accents;
    const labels = Object.fromEntries(ACCENTS.map((k) => [k, picker.labels[key]?.[k] ?? titleCase(k)])) as Record<
      Accent,
      string
    >;

    const ui = resolvedUi(classic, UI_KEYS_USED);
    const diff = (other: typeof island) => {
      const resolved = resolvedUi(other, UI_KEYS_USED);
      return Object.fromEntries(Object.entries(resolved).filter(([k, v]) => ui[k] !== v));
    };

    const scheme = parseScheme(readFileSync(join(res, `${stem}.xml`), "utf8"));
    const colors = Object.fromEntries(Object.entries(scheme.colors).filter(([k]) => SCHEME_COLOR_KEYS.includes(k)));
    const attributes = Object.fromEntries(
      Object.entries(scheme.attributes).filter(([k]) => SCHEME_ATTRIBUTE_KEYS.includes(k)),
    );

    return {
      id: paletteId(stem),
      stem,
      name: displayName(classic.name),
      kind: classic.dark ? "dark" : "light",
      family: family(stem),
      ramp,
      accents,
      swatches,
      labels,
      ui,
      styles: { island: diff(island), softIsland: diff(soft) },
      scheme: { parent: scheme.parent, colors, attributes },
    };
  });
}

function main(): void {
  const checkout = process.argv[2];
  if (!checkout) throw new Error("usage: node scripts/gruvppuccin/extract.ts <gruvppuccin-intellij-checkout>");
  const plugin = fileURLToPath(new URL("../../plugins/gruvppuccin/", import.meta.url));
  const palettes = extract(checkout);
  mkdirSync(join(plugin, "data"), { recursive: true });
  writeFileSync(join(plugin, "data/palettes.json"), JSON.stringify({ palettes }, null, 2) + "\n");

  for (const variant of ["dark", "light"]) {
    const from = join(checkout, "src/main/resources/icons", variant);
    const to = join(plugin, "icons", variant);
    mkdirSync(to, { recursive: true });
    for (const file of readdirSync(from).filter((f) => f.endsWith(".svg")))
      copyFileSync(join(from, file), join(to, file));
  }
  console.log(`extracted ${palettes.length} palettes into ${join(plugin, "data/palettes.json")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
