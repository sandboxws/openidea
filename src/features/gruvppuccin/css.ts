/**
 * The stylesheet that applies Gruvppuccin settings over the active Gruvppuccin theme. The
 * theme files point every accent-following token at `--gp-accent…`; this re-points those at
 * the chosen slots, the way the IntelliJ plugin rewrote its accent keys. The selector outranks
 * the plugin theme block (`:root[data-plugin-theme]:not(…)`), and a custom Appearance accent
 * (an inline `--accent`) still wins over both.
 */
import type { ActiveVariant } from "./activeTheme";
import { COMPONENT_ARC, ISLAND_ARC, effectiveSlots, type GruvppuccinSettings } from "./model";

export const RUNTIME_SELECTOR = ':root[data-plugin-theme^="gruvppuccin/"][data-gp]:not([data-plugin-theme=""])';

/** Gruvppuccin's keyword roles (`cm-gp-kw-<role>`, `--syn-keyword-<role>`). */
export const KEYWORD_ROLES = ["module", "return", "control", "definition"] as const;
export type KeywordRole = (typeof KEYWORD_ROLES)[number];

/**
 * Component radii at Gruvppuccin's default arc (7), which match OpenIDEA's own: [token,
 * normal, compact]. Another arc scales them all; dialogs are native windows and keep theirs.
 */
const RADII: ReadonlyArray<readonly [string, number, number?]> = [
  ["--radius-small", 4],
  ["--radius-row", 4],
  ["--radius-selection", 5],
  ["--radius-control", 4, 3],
  ["--radius-combo", 4, 2],
  ["--radius-tab", 6],
  ["--radius-toolbar-button", 6, 4],
  ["--radius-toolbar-dropdown", 6],
  ["--radius-floating-toolbar", 3],
  ["--radius-tooltip", 6],
  ["--radius-popup", 8],
  ["--radius-popup-large", 10],
];

const px = (n: number) => `${Math.round(n * 2) / 2}px`;

export interface RuntimeOptions {
  compact: boolean;
  /** The ramp step whose text reads best on the chosen accent (`crust`, `base` or `text`). */
  onAccent: string;
}

export function runtimeCss(s: GruvppuccinSettings, variant: ActiveVariant, opts: RuntimeOptions): string {
  const slots = effectiveSlots(s);
  const decl: string[] = [
    `--gp-accent: var(--gp-${slots.accent})`,
    `--gp-accent-tab: var(--gp-${slots.tab})`,
    `--gp-accent-toolwindow: var(--gp-${slots.toolWindow})`,
    `--gp-accent-caret: var(--gp-${slots.caret})`,
    `--fg-on-accent: var(--gp-${opts.onAccent})`,
    `--fg-button-primary: var(--gp-${opts.onAccent})`,
  ];

  // Bold keywords: bold, or plain (the IntelliJ plugin resets the keys to PLAIN, italic included).
  const weight = s.boldKeywords ? "var(--fw-code-bold)" : "normal";
  for (const token of ["--syn-keyword", ...KEYWORD_ROLES.map((r) => `--syn-keyword-${r}`)])
    decl.push(`${token}-bold: ${weight}`, `${token}-italic: normal`);

  if (s.componentArc !== COMPONENT_ARC.default) {
    const k = s.componentArc / COMPONENT_ARC.default;
    for (const [token, normal, compact] of RADII)
      decl.push(`${token}: ${px((opts.compact ? (compact ?? normal) : normal) * k)}`);
  }
  // Island arcs are IntelliJ arcs (a diameter); compact islands are 8px where normal ones are 10px.
  if (variant.style !== "classic" && s.islandArc !== ISLAND_ARC.default)
    decl.push(`--island-radius: ${px(s.islandArc * (opts.compact ? 0.4 : 0.5))}`);

  const body = decl.map((d) => `  ${d};`).join("\n");
  // Tool window tabs share the editor tabs' strip; inside tool window areas they take their own accent.
  return `${RUNTIME_SELECTOR} {\n${body}\n}\n${RUNTIME_SELECTOR} [data-slot] {\n  --border-tab-selected: var(--gp-accent-toolwindow);\n}\n`;
}
