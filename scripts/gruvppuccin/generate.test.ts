// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { themeTokenGroups, tokenSets } from "../theme/tokens.ts";
import { contrast } from "./color.ts";
import {
  ICON_EXTENSIONS,
  ICON_FILE_NAMES,
  ICON_OVERRIDES,
  PLUGIN_DIR,
  buildPackage,
  loadPalettes,
  orderPalettes,
  themeId,
} from "./generate.ts";
import { ACCENTS, RAMP, STYLES } from "./model.ts";
import { opaque, parseThemeFile, resolveColor, type ThemeJson } from "./resolve.ts";

const css = readFileSync("src/styles/tokens.css", "utf8");
const palettes = loadPalettes();
const files = buildPackage(palettes, css);
const sets = tokenSets(themeTokenGroups(css));

function theme(id: string): ThemeJson {
  return parseThemeFile(files.get(`themes/${id}.theme.json`)!);
}
function scheme(paletteId: string): ThemeJson {
  return parseThemeFile(files.get(`themes/${paletteId}.scheme.json`)!);
}
/** A theme as the host merges it: UI tokens, then the editor scheme over them. */
function merged(paletteId: string, style: (typeof STYLES)[number]): ThemeJson & { all: Record<string, string> } {
  const t = theme(
    themeId(
      palettes.find((p) => p.id === paletteId)!,
      style,
    ),
  );
  return { ...t, all: { ...t.tokens, ...scheme(paletteId).tokens } };
}

describe("Gruvppuccin plugin", () => {
  it("is generated from data/palettes.json (node scripts/gruvppuccin/generate.ts)", () => {
    const stale = [...files].filter(([rel, content]) => {
      const path = join(PLUGIN_DIR, rel);
      return !existsSync(path) || readFileSync(path, "utf8") !== content;
    });
    expect(stale.map(([rel]) => rel)).toEqual([]);
  });

  it("ships 21 palettes × 3 styles, 16 dark and 5 light", () => {
    expect(palettes).toHaveLength(21);
    expect(
      palettes
        .filter((p) => p.kind === "light")
        .map((p) => p.id)
        .sort(),
    ).toEqual(["gruvbark-haze", "gruvbark-nova", "haze", "latte", "nova"]);
    const manifest = files.get("plugin.toml")!;
    expect(manifest.match(/^\[\[contributes\.themes\]\]$/gm)).toHaveLength(63);
    expect(manifest.match(/^\[\[contributes\.iconThemes\]\]$/gm)).toHaveLength(1);
    expect(manifest).not.toMatch(/^wasm\s*=/m);
    expect(
      orderPalettes(palettes)
        .slice(0, 3)
        .map((p) => p.id),
    ).toEqual(["macchiato", "mocha", "latte"]);
  });

  it("drops the IntelliJ edition from names", () => {
    for (const p of palettes) expect(p.name).not.toContain("Lifetime");
    expect(palettes.find((p) => p.id === "nocturne-rosewood")?.name).toBe("Gruvppuccin Nocturne Rosewood");
  });

  it("gives every theme every UI token and every scheme every editor token", () => {
    for (const p of palettes) {
      const s = scheme(p.id).tokens;
      expect(
        sets.scheme.filter((t) => !(t in s)),
        p.id,
      ).toEqual([]);
      for (const style of STYLES) {
        const t = theme(themeId(p, style));
        expect(
          sets.ui.filter((k) => !(k in t.tokens)),
          t.id,
        ).toEqual([]);
        expect(t.kind).toBe(p.kind);
      }
    }
  });

  it("uses only names and values the plugin host accepts", () => {
    for (const p of palettes)
      for (const style of STYLES) {
        const { id, all } = merged(p.id, style);
        expect(Object.keys(all).length, id).toBeLessThanOrEqual(512);
        for (const [k, v] of Object.entries(all)) {
          expect(/^--[a-z0-9-]+$/.test(k) && k.length <= 64, k).toBe(true);
          expect(v.length, `${id} ${k}`).toBeLessThanOrEqual(256);
          expect(/[;{}<>\\\n]|url\(|image\(|@import|expression\(/i.test(v), `${id} ${k}: ${v}`).toBe(false);
        }
      }
  });

  it("carries the palette and accent slots the runtime re-points", () => {
    const t = theme("mocha").tokens;
    for (const k of [...ACCENTS, ...RAMP]) expect(t[`--gp-${k}`]).toMatch(/^#[0-9a-f]{6}$/);
    expect(t["--gp-accent"]).toBe("var(--gp-sapphire)");
    for (const k of ["--accent", "--link", "--fg-toggle-off"]) expect(t[k]).toBe("var(--gp-accent)");
    expect(t["--border-tab-selected"]).toBe("var(--gp-accent-tab)");
    expect(scheme("mocha").tokens["--caret"]).toBe("var(--gp-accent-caret)");
    // The picker's default slot is the theme's own accent.
    for (const p of palettes) expect(p.swatches.sapphire, p.id).toBe(p.accents.sapphire);
  });

  it("draws Classic flat and leaves island gap and radius to the runtime", () => {
    for (const p of palettes) {
      const classic = theme(p.id).tokens;
      expect(classic["--island-gap"]).toBe("1px");
      expect(classic["--island-radius"]).toBe("0px");
      for (const style of ["island", "soft-island"] as const) {
        const t = theme(themeId(p, style)).tokens;
        expect(t["--island-gap"]).toBeUndefined();
        expect(t["--island-radius"]).toBeUndefined();
      }
    }
    // Island: tool windows sink into the frame; the editor stays on base.
    const island = merged("mocha", "island").all;
    expect(island["--bg-frame"]).toBe(palettes.find((p) => p.id === "mocha")!.ramp.crust);
    expect(island["--bg-island"]).toBe(island["--bg-frame"]);
    expect(island["--bg-editor"]).toBe(palettes.find((p) => p.id === "mocha")!.ramp.base);
  });

  it("keeps the IntelliJ scheme's syntax colours and font styles", () => {
    const mocha = scheme("mocha").tokens;
    expect(mocha["--syn-keyword"]).toBe("#c28fd6");
    expect(mocha["--syn-param"]).toBe("#e07868");
    expect(mocha["--syn-keyword-module"]).toBe("#89b482");
    expect(mocha["--syn-keyword-module-italic"]).toBe("italic");
    expect(mocha["--syn-keyword-return"]).toBe("#e78a4e");
    expect(mocha["--syn-self-italic"]).toBe("italic");
    expect(scheme("macchiato").tokens["--syn-comment-style"]).toBe("italic");
    expect(mocha["--syn-comment-style"]).toBe("normal");
    // IntelliJ draws no effect without an effect colour.
    expect(mocha["--syn-doc-comment-tag-effect"]).toBe("none");
  });

  it("uses a magenta for ANSI magenta", () => {
    for (const p of palettes.filter((p) => p.kind === "dark")) {
      const s = scheme(p.id).tokens;
      expect(s["--ansi-magenta"], p.id).not.toBe(s["--ansi-cyan"]);
    }
  });
});

describe("Gruvppuccin contrast", () => {
  const ratio = (tokens: Record<string, string>, fg: string, bg: string) => {
    const back = opaque(resolveColor(tokens, bg)!, "#000000");
    return contrast(opaque(resolveColor(tokens, fg)!, back), back);
  };
  const failures = (kind: "dark" | "light", pairs: Array<[string, string]>, min: number) => {
    const out: string[] = [];
    for (const p of palettes.filter((p) => p.kind === kind))
      for (const style of STYLES) {
        const { id, all } = merged(p.id, style);
        for (const [fg, bg] of pairs) {
          const r = ratio(all, fg, bg);
          if (r < min) out.push(`${id}: ${fg} on ${bg} ${r.toFixed(2)} < ${min}`);
        }
      }
    return out;
  };

  const TEXT: Array<[string, string]> = [
    ["--fg", "--bg-app"],
    ["--fg", "--bg-island"],
    ["--fg-tooltip", "--bg-tooltip"],
  ];
  const STATUS = ["--danger", "--warning", "--success", "--info", "--vcs-modified", "--vcs-added", "--vcs-conflict"];
  const MAIN_SYNTAX = [
    "--syn-keyword",
    "--syn-string",
    "--syn-function",
    "--syn-type",
    "--syn-number",
    "--syn-param",
    "--syn-property",
  ];

  it("keeps editor and UI text readable", () => {
    for (const kind of ["dark", "light"] as const) {
      expect(
        failures(
          kind,
          [
            ["--fg-editor", "--bg-editor"],
            ["--fg-strong", "--bg-app"],
          ],
          7,
        ),
      ).toEqual([]);
      expect(failures(kind, TEXT, 4.5)).toEqual([]);
      expect(failures(kind, [["--fg", "--bg-selected"]], 3.5)).toEqual([]);
      expect(failures(kind, [["--fg-search-match", "--bg-search-match-current"]], 3.5)).toEqual([]);
    }
  });

  // Faithful port: the light palettes keep Gruvbox Light's syntax colours (~3:1 on cream) and
  // every palette keeps its low-contrast comments; status text is darkened to 3:1 on light.
  it("pins the palettes' syntax and status contrast", () => {
    expect(
      failures(
        "dark",
        MAIN_SYNTAX.map((t) => [t, "--bg-editor"]),
        4.5,
      ),
    ).toEqual([]);
    expect(
      failures(
        "light",
        MAIN_SYNTAX.map((t) => [t, "--bg-editor"]),
        2.5,
      ),
    ).toEqual([]);
    for (const kind of ["dark", "light"] as const) {
      expect(failures(kind, [["--syn-comment", "--bg-editor"]], 2.5)).toEqual([]);
      expect(
        failures(
          kind,
          STATUS.map((t) => [t, "--bg-app"]),
          3,
        ),
      ).toEqual([]);
      expect(failures(kind, [["--fg-on-accent", "--accent"]], 3)).toEqual([]);
    }
  });
});

describe("Gruvppuccin icons", () => {
  const theme = JSON.parse(files.get("icons/theme.json")!) as {
    iconDefinitions: Record<string, { light: string; dark: string }>;
    fileExtensions: Record<string, string>;
    fileNames: Record<string, string>;
    overrides: Record<string, string>;
  };

  it("maps the IntelliJ icon provider's extensions and file names", () => {
    expect(Object.keys(ICON_EXTENSIONS)).toHaveLength(23);
    expect(theme.fileExtensions.py).toBe("python");
    expect(theme.fileExtensions.kts).toBe("kotlin");
    expect(theme.fileNames.dockerfile).toBe("docker");
    expect(theme.overrides["folder-source"]).toBe("source-root");
    expect(Object.keys(theme.overrides).sort()).toEqual(Object.keys(ICON_OVERRIDES).sort());
    // The host's icon id rule.
    for (const id of Object.keys(theme.iconDefinitions)) expect(/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id), id).toBe(true);
    expect(Object.values(ICON_FILE_NAMES).every((i) => i in theme.iconDefinitions)).toBe(true);
  });

  it("references SVGs that exist in both variants, and keeps built-in icons for everything else", () => {
    for (const { light, dark } of Object.values(theme.iconDefinitions)) {
      expect(existsSync(join(PLUGIN_DIR, light)), light).toBe(true);
      expect(existsSync(join(PLUGIN_DIR, dark)), dark).toBe(true);
    }
    expect(theme).not.toHaveProperty("file");
    expect(theme).not.toHaveProperty("folder");
  });
});
