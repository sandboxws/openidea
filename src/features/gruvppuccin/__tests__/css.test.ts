import { describe, expect, it } from "vitest";
import { parseVariant } from "../activeTheme";
import { RUNTIME_SELECTOR, runtimeCss } from "../css";
import { BUILT_IN_PRESETS, DEFAULT_SETTINGS, withPreset } from "../model";

const island = parseVariant("gruvppuccin/mocha-island", "dark")!;
const classic = parseVariant("gruvppuccin/mocha", "dark")!;
const opts = { compact: false, onAccent: "crust" };

const declarations = (css: string) =>
  Object.fromEntries(
    [...css.slice(0, css.indexOf("}")).matchAll(/^\s+(--[a-z0-9-]+): (.+);$/gm)].map((m) => [m[1]!, m[2]!]),
  );

describe("runtimeCss", () => {
  it("re-points the accent slots and keeps the theme's radii by default", () => {
    const css = runtimeCss(DEFAULT_SETTINGS, island, opts);
    expect(css.startsWith(RUNTIME_SELECTOR)).toBe(true);
    const d = declarations(css);
    expect(d["--gp-accent"]).toBe("var(--gp-sapphire)");
    expect(d["--gp-accent-caret"]).toBe("var(--gp-sapphire)");
    expect(d["--fg-on-accent"]).toBe("var(--gp-crust)");
    expect(d["--syn-keyword-module-italic"]).toBe("normal");
    expect(d["--syn-keyword-bold"]).toBe("normal");
    expect(d["--radius-control"]).toBeUndefined();
    expect(d["--island-radius"]).toBeUndefined();
    // Tool window tabs take the tool window accent.
    expect(css).toContain(`${RUNTIME_SELECTOR} [data-slot] {\n  --border-tab-selected: var(--gp-accent-toolwindow);`);
  });

  it("applies a preset's slots, bold keywords and arcs", () => {
    const d = declarations(runtimeCss(withPreset(DEFAULT_SETTINGS, BUILT_IN_PRESETS[2]!), island, opts));
    expect(d["--gp-accent"]).toBe("var(--gp-mauve)");
    expect(d["--gp-accent-tab"]).toBe("var(--gp-sapphire)");
    expect(d["--syn-keyword-bold"]).toBe("normal");
    // Arc 10 scales the radii by 10/7; island arc 26 is a 13px radius.
    expect(d["--radius-control"]).toBe("5.5px");
    expect(d["--radius-popup"]).toBe("11.5px");
    expect(d["--island-radius"]).toBe("13px");
  });

  it("squares everything at arc 0 and follows compact mode", () => {
    const highContrast = withPreset(DEFAULT_SETTINGS, BUILT_IN_PRESETS[1]!);
    const d = declarations(runtimeCss(highContrast, island, { ...opts, compact: true }));
    expect(d["--radius-combo"]).toBe("0px");
    expect(d["--island-radius"]).toBe("0px");
    expect(d["--syn-keyword-control-bold"]).toBe("var(--fw-code-bold)");
    const compact = declarations(
      runtimeCss({ ...DEFAULT_SETTINGS, componentArc: 14, islandArc: 30 }, island, { ...opts, compact: true }),
    );
    expect(compact["--radius-combo"]).toBe("4px");
    expect(compact["--island-radius"]).toBe("12px");
  });

  it("leaves Classic's flat islands alone", () => {
    const d = declarations(runtimeCss({ ...DEFAULT_SETTINGS, islandArc: 30 }, classic, opts));
    expect(d["--island-radius"]).toBeUndefined();
  });
});
