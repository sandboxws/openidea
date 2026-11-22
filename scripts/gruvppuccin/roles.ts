/**
 * Every OpenIDEA theme token as a role of a Gruvppuccin palette: its 12-step ramp, its six
 * accents, the editor scheme it shipped with in IntelliJ, and the UI style. Syntax, console
 * and VCS colours come straight from the IntelliJ scheme (they were tuned per palette);
 * surfaces and controls follow the IntelliJ theme's own role choices (the editor on `base`,
 * tabs, fields and tooltips on `mantle`, selection on `surface1`, labels in `subtext0`).
 *
 * Accent-following tokens are written as `var(--gp-accent…)` indirections: the theme ships
 * `--gp-accent: var(--gp-sapphire)`, and the Gruvppuccin settings page re-points it at another
 * slot at runtime, the way the IntelliJ plugin rewrote its accent keys.
 */
import { alpha, bestOn, distance, mix, readable } from "./color.ts";
import type { Attr, PaletteData } from "./extract.ts";
import { ACCENTS, RAMP, type Accent, type Ramp, type Style } from "./model.ts";

export interface Ctx {
  p: PaletteData;
  style: Style;
  dark: boolean;
  r: Record<Ramp, string>;
  a: Record<Accent, string>;
  attr(key: string): Attr | undefined;
  fg(key: string, fallback: string): string;
  color(key: string, fallback: string): string;
  ui(key: string, fallback: string): string;
  /** The editor's background (scheme `TEXT`). */
  editor: string;
}

export function context(p: PaletteData, style: Style): Ctx {
  const styleUi = style === "island" ? p.styles.island : style === "soft-island" ? p.styles.softIsland : {};
  const attr = (key: string) => p.scheme.attributes[key];
  return {
    p,
    style,
    dark: p.kind === "dark",
    r: p.ramp,
    a: p.accents,
    attr,
    fg: (key, fallback) => attr(key)?.fg ?? fallback,
    color: (key, fallback) => p.scheme.colors[key] ?? fallback,
    ui: (key, fallback) => styleUi[key] ?? p.ui[key] ?? fallback,
    editor: attr("TEXT")?.bg ?? p.ramp.base,
  };
}

type Role = (c: Ctx) => string;

const accentMix = (percent: number, over = "transparent") =>
  `color-mix(in srgb, var(--gp-accent) ${percent}%, ${over})`;
const tint = (c: Ctx, accent: string, t: number) => mix(c.r.base, accent, t);
/** Text on the default accent (primary buttons): whichever ramp end reads better on it. */
const onAccent = (c: Ctx) => bestOn(c.p.swatches.sapphire, [c.r.crust, c.r.base, c.r.text]);
/**
 * Status and VCS text on light themes: Gruvbox Light's yellows and greens sit near 2:1 on
 * the cream surfaces, so they are darkened toward the text colour until they reach 3:1.
 * Dark themes keep the palette's values (all above 4:1).
 */
const status = (c: Ctx, color: string) => (c.dark ? color : readable(color, c.r.base, c.r.text, 3));

/** UI theme file tokens (`tokens.css` groups outside the editor scheme). */
export const UI_ROLES: Record<string, Role> = {
  // Surfaces
  "--bg-app": (c) => c.r.base,
  "--bg-elev": (c) => c.r.mantle,
  "--bg-popup": (c) => c.ui("Popup.background", c.r.base),
  "--bg-floating-toolbar": (c) => c.r.surface0,
  "--bg-hover": (c) => c.r.surface0,
  "--bg-selected": (c) => c.ui("List.selectionBackground", c.r.surface1),
  "--bg-selected-strong": (c) => c.r.surface2,
  "--bg-current-line": (c) => c.color("CARET_ROW_COLOR", c.r.surface0),
  "--bg-debug-line": (c) => tint(c, c.a.sapphire, 0.28),
  "--bg-backdrop": (c) => c.r.mantle,
  "--bg-input": (c) => c.ui("TextField.background", c.r.mantle),

  // Lines
  "--border": (c) => c.ui("Borders.color", c.r.mantle),
  "--border-popup": (c) => c.r.surface1,
  "--border-strong": (c) => c.r.surface2,
  "--border-window": (c) => c.r.surface2,
  "--control-off": (c) => c.r.overlay0,

  // Text
  "--fg-strong": (c) => c.r.text,
  "--fg-emphasis": (c) => c.r.subtext1,
  "--fg": (c) => c.ui("Label.foreground", c.r.subtext0),
  "--fg-secondary": (c) => c.r.overlay2,
  "--fg-muted": (c) => c.r.overlay1,
  "--fg-subtle": (c) => c.r.overlay0,
  "--fg-faint": (c) => c.r.surface2,
  "--fg-gutter": (c) => c.color("LINE_NUMBERS_COLOR", c.r.overlay0),
  "--fg-icon": (c) => c.r.subtext1,

  // Accent
  "--accent": () => "var(--gp-accent)",
  "--link": () => "var(--gp-accent)",
  "--link-hover": () => "color-mix(in srgb, var(--gp-accent) 75%, var(--gp-text))",

  // Charts
  "--chart-series": (c) => c.a.red,

  // Status
  "--danger": (c) => status(c, c.a.red),
  "--warning": (c) => status(c, c.a.yellow),
  "--success": (c) => status(c, c.a.green),
  "--db-connected": (c) => c.a.green,
  "--db-connected-ring": (c) => mix(c.a.green, c.r.base, 0.5),
  "--info": (c) => status(c, c.a.sapphire),

  // Vcs
  "--vcs-modified": (c) => status(c, c.color("FILESTATUS_MODIFIED", c.a.sapphire)),
  "--vcs-added": (c) => status(c, c.color("FILESTATUS_ADDED", c.a.green)),
  "--vcs-deleted": (c) => c.color("FILESTATUS_DELETED", c.r.overlay0),
  "--vcs-untracked": (c) => status(c, c.color("FILESTATUS_UNKNOWN", c.a.red)),
  "--vcs-ignored": (c) => c.color("FILESTATUS_IDEA_FILESTATUS_IGNORED", c.r.overlay0),
  "--vcs-conflict": (c) => status(c, c.color("FILESTATUS_IDEA_FILESTATUS_MERGED_WITH_CONFLICTS", c.a.red)),
  "--gutter-modified": (c) => c.color("MODIFIED_LINES_COLOR", c.a.sapphire),
  "--gutter-added": (c) => c.color("ADDED_LINES_COLOR", c.a.green),
  "--gutter-deleted": (c) => c.color("DELETED_LINES_COLOR", c.a.red),
  "--diff-modified": (c) => c.attr("DIFF_MODIFIED")?.bg ?? tint(c, c.a.sapphire, 0.15),
  "--diff-inserted": (c) => c.attr("DIFF_INSERTED")?.bg ?? tint(c, c.a.green, 0.15),
  "--diff-deleted": (c) => c.attr("DIFF_DELETED")?.bg ?? c.r.surface0,
  "--diff-modified-stripe": (c) => c.attr("DIFF_MODIFIED")?.stripe ?? c.a.sapphire,
  "--diff-inserted-stripe": (c) => c.attr("DIFF_INSERTED")?.stripe ?? c.a.green,
  "--diff-deleted-stripe": (c) => c.attr("DIFF_DELETED")?.stripe ?? c.r.overlay1,
  "--diff-conflict-stripe": (c) => c.attr("DIFF_CONFLICT")?.stripe ?? c.a.red,
  "--diff-separator-wave": () => "var(--fg-subtle)",

  // Shadows and window controls
  "--shadow-popup": (c) => (c.dark ? "0 6px 20px rgba(0, 0, 0, 0.45)" : "0 6px 20px rgba(0, 0, 0, 0.14)"),
  "--shadow-dialog": (c) =>
    c.dark
      ? "0 0 0 0.5px rgba(0, 0, 0, 0.6), 0 10px 24px rgba(0, 0, 0, 0.35), 0 24px 72px rgba(0, 0, 0, 0.45)"
      : "0 0 0 0.5px rgba(0, 0, 0, 0.18), 0 10px 24px rgba(0, 0, 0, 0.12), 0 24px 72px rgba(0, 0, 0, 0.14)",
  "--traffic-close": () => "#ff5f57",
  "--traffic-close-border": () => "#e0443e",
  "--traffic-close-pressed": () => "#bf4942",
  "--traffic-glyph": () => "#4d0000",
  "--traffic-off": (c) => c.r.surface1,
  "--traffic-off-border": (c) => c.r.surface0,

  // Additive
  "--bg-stripe-tooltip": () => "var(--bg-tooltip)",
  "--fg-stripe-tooltip": () => "var(--fg-tooltip)",
  "--border-stripe-tooltip": () => "var(--border-tooltip)",
  "--shadow-stripe-tooltip": () => "var(--shadow-tooltip)",
  "--bg-tooltip": (c) => c.ui("ToolTip.background", c.r.mantle),
  "--fg-tooltip": (c) => c.r.subtext1,
  "--border-tooltip": (c) => c.r.surface1,
  "--bg-control": (c) => c.r.surface0,
  "--bg-control-hover": (c) => c.r.surface1,
  "--bg-active": (c) => c.r.surface2,
  "--bg-scrim": (c) => (c.dark ? "rgba(0, 0, 0, 0.45)" : "rgba(0, 0, 0, 0.16)"),
  "--fg-on-accent": onAccent,
  "--shadow-tooltip": (c) => (c.dark ? "0 4px 12px rgba(0, 0, 0, 0.4)" : "0 4px 12px rgba(0, 0, 0, 0.12)"),
  "--shadow-balloon": (c) => (c.dark ? "0 8px 24px rgba(0, 0, 0, 0.45)" : "0 8px 24px rgba(0, 0, 0, 0.14)"),

  // Islands contract
  "--bg-frame": (c) =>
    c.style === "classic" ? c.ui("Borders.color", c.r.mantle) : c.ui("Island.borderColor", c.r.crust),
  "--bg-island": (c) => c.ui("ToolWindow.background", c.r.base),
  "--bg-stripe-hover": (c) => alpha(c.r.text, 0.09),
  "--bg-stripe-selected": (c) => alpha(c.r.text, 0.16),
  "--fg-stripe-selected-active": (c) => c.r.text,
  "--fg-stripe-label": (c) => c.r.overlay2,
  "--bg-tab-selected": (c) => c.ui("EditorTabs.underlinedTabBackground", c.r.surface0),
  "--border-tab-selected": () => "var(--gp-accent-tab)",
  "--bg-tab-selected-inactive": (c) => c.r.mantle,
  "--border-tab-selected-inactive": (c) => c.r.surface2,
  "--bg-tab-hover": (c) => c.ui("EditorTabs.hoverBackground", c.r.surface0),
  "--border-editor-tabs": (c) => c.ui("Borders.color", c.r.mantle),
  "--bg-tree-selected": (c) => c.ui("Tree.selectionBackground", c.r.surface0),
  "--bg-tree-selected-inactive": (c) => c.ui("Tree.selectionInactiveBackground", c.r.surface0),
  "--bg-tree-hover": (c) => alpha(c.r.text, 0.06),
  "--bg-toolbar-hover": () => accentMix(12),
  "--bg-toolbar-pressed": () => accentMix(22),
  "--bg-toolbar-selected": () => accentMix(28, "var(--gp-base)"),
  "--bg-toolbar-selected-hover": () => accentMix(36, "var(--gp-base)"),
  "--bg-button-primary-hover": () => "var(--accent-hover)",
  "--fg-button-primary": onAccent,
  "--bg-button": () => "transparent",
  "--border-button": (c) => c.r.surface2,
  "--bg-field": (c) => c.ui("TextField.background", c.r.mantle),
  "--bg-checkbox": (c) => c.r.mantle,
  "--border-checkbox": (c) => c.r.overlay0,
  "--bg-toggle-on": () => accentMix(56),
  "--fg-toggle-on": (c) => c.r.text,
  "--bg-toggle-off": (c) => c.ui("Table.background", c.r.crust),
  "--fg-toggle-off": () => "var(--gp-accent)",
  "--border-toggle": (c) => c.r.overlay0,
  "--bg-toggle-knob": (c) => c.r.overlay1,
  "--focus-ring-soft": () => accentMix(45),
  "--scrollbar-thumb": (c) => alpha(c.r.overlay0, 0.5),
  "--scrollbar-thumb-hover": (c) => alpha(c.r.overlay0, 0.85),
  "--bg-search-match": (c) => mix(c.r.base, c.ui("SearchMatch.startBackground", c.a.yellow), 0.7),
  "--bg-search-match-current": (c) => c.ui("SearchMatch.startBackground", c.a.yellow),
  "--fg-search-match": (c) => (c.dark ? c.r.crust : c.r.text),
  "--bg-dialog": (c) => c.r.base,
  "--bg-popup-inline": (c) => c.r.mantle,
  "--bg-popup-advertiser": (c) => c.r.mantle,
  "--bg-feedback-info": (c) => tint(c, c.a.sapphire, 0.14),
  "--border-feedback-info": (c) => tint(c, c.a.sapphire, 0.35),
  "--bg-feedback-error": (c) => tint(c, c.a.red, 0.14),
  "--border-feedback-error": (c) => tint(c, c.a.red, 0.35),
  "--bg-feedback-warning": (c) => tint(c, c.a.yellow, 0.14),
  "--border-feedback-warning": (c) => tint(c, c.a.yellow, 0.35),
  "--bg-feedback-success": (c) => tint(c, c.a.green, 0.14),
  "--border-feedback-success": (c) => tint(c, c.a.green, 0.35),
  "--bg-counter": () => accentMix(38),
  "--fg-counter": (c) => c.r.text,
  "--bg-progress-track": (c) => c.r.surface1,
};

/** IntelliJ `FONT_TYPE` / `EFFECT_TYPE` → the `-bold`, `-italic`, `-effect` suffix tokens. */
export function fontTokens(name: string, attr: Attr | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!attr?.fontType) return out;
  if (attr.fontType & 1) out[`${name}-bold`] = "var(--fw-code-bold)";
  if (attr.fontType & 2) out[`${name}-italic`] = "italic";
  return out;
}

/** IntelliJ draws an effect only with an `EFFECT_COLOR`. */
function effect(attr: Attr | undefined): string {
  if (!attr?.effectType || !attr.effect) return "none";
  if (attr.effectType === 1) return `underline ${attr.effect}`;
  if (attr.effectType === 2) return `underline wavy ${attr.effect}`;
  if (attr.effectType === 3) return `line-through ${attr.effect}`;
  return "none";
}

/** Syntax tokens fed by one IntelliJ attribute, whose font style they carry too. */
export const SYNTAX_ATTRIBUTES: Record<string, [string, Role]> = {
  "--syn-keyword": ["DEFAULT_KEYWORD", (c) => c.a.mauve],
  "--syn-string": ["DEFAULT_STRING", (c) => c.a.green],
  "--syn-type": ["DEFAULT_CLASS_NAME", (c) => c.a.yellow],
  "--syn-function": ["DEFAULT_FUNCTION_DECLARATION", (c) => c.a.sapphire],
  "--syn-function-call": ["DEFAULT_FUNCTION_CALL", (c) => c.a.sapphire],
  "--syn-shell-command": ["BASH.EXTERNAL_COMMAND", (c) => c.a.sapphire],
  "--syn-doc-comment": ["DEFAULT_DOC_COMMENT", (c) => c.r.overlay1],
  "--syn-doc-comment-tag": ["DEFAULT_DOC_COMMENT_TAG", (c) => c.a.sapphire],
  "--syn-doc-comment-tag-value": ["DEFAULT_DOC_COMMENT_TAG_VALUE", (c) => c.r.subtext0],
  "--syn-doc-markup": ["DEFAULT_DOC_MARKUP", (c) => c.r.overlay0],
  "--syn-docstring": ["DEFAULT_DOC_COMMENT", (c) => c.r.overlay1],
  "--syn-annotation": ["DEFAULT_METADATA", (c) => c.a.sapphire],
  "--syn-decorator": ["PY.DECORATOR", (c) => c.fg("DEFAULT_METADATA", c.a.sapphire)],
  "--syn-number": ["DEFAULT_NUMBER", (c) => c.a.peach],
  "--syn-punct": ["DEFAULT_OPERATION_SIGN", (c) => c.r.overlay2],
  "--syn-variable": ["DEFAULT_LOCAL_VARIABLE", (c) => c.fg("DEFAULT_IDENTIFIER", c.r.text)],
  "--syn-global": ["DEFAULT_GLOBAL_VARIABLE", (c) => c.a.yellow],
  "--syn-param": ["DEFAULT_PARAMETER", (c) => c.r.text],
  "--syn-property": ["DEFAULT_INSTANCE_FIELD", (c) => c.r.subtext1],
  "--syn-constant": ["DEFAULT_CONSTANT", (c) => c.a.peach],
  "--syn-python-class-attribute": ["DEFAULT_STATIC_FIELD", () => "var(--syn-property)"],
  "--syn-python-parentheses": ["DEFAULT_PARENTHS", () => "var(--syn-punct)"],
  "--syn-python-brackets": ["DEFAULT_BRACKETS", () => "var(--syn-punct)"],
  "--syn-python-braces": ["DEFAULT_BRACES", () => "var(--syn-punct)"],
  "--syn-python-builtin": ["PY.BUILTIN_NAME", () => "var(--syn-builtin)"],
  "--syn-python-predefined-definition": ["PY.PREDEFINED_DEFINITION", () => "var(--syn-predefined)"],
  "--syn-python-predefined-usage": ["PY.PREDEFINED_USAGE", () => "var(--syn-predefined)"],
  "--syn-python-bytes": ["PY.STRING.B", () => "var(--syn-string)"],
  "--syn-builtin": ["DEFAULT_PREDEFINED_SYMBOL", (c) => c.a.sapphire],
  "--syn-self": ["PY.SELF_PARAMETER", (c) => c.a.mauve],
  "--syn-keyword-arg": ["PY.KEYWORD_ARGUMENT", (c) => c.r.text],
  "--syn-predefined": ["PY.BUILTIN_NAME", (c) => c.a.sapphire],
  "--syn-escape": ["DEFAULT_VALID_STRING_ESCAPE", (c) => c.a.green],
  "--syn-regexp": ["REGEXP.CHAR_CLASS", () => "var(--syn-escape)"],
  "--syn-tag": ["DEFAULT_TAG", (c) => c.a.mauve],
  "--syn-attribute": ["DEFAULT_ATTRIBUTE", (c) => c.a.yellow],
  "--syn-todo": ["TODO_DEFAULT_ATTRIBUTES", (c) => c.a.yellow],
  "--syn-link": ["MARKDOWN_LINK_TEXT", (c) => c.fg("HYPERLINK_ATTRIBUTES", c.a.sapphire)],
  "--syn-markup-heading": ["MARKDOWN_HEADER_LEVEL_1", (c) => c.a.red],
  "--syn-markup-code": ["MARKDOWN_CODE_SPAN", (c) => c.a.green],
  "--syn-inline-value": ["DEBUGGER_INLINED_VALUES", (c) => c.r.overlay0],
  "--syn-rainbow-1": ["RAINBOW_COLOR1", (c) => c.a.mauve],
  "--syn-rainbow-2": ["RAINBOW_COLOR2", (c) => c.a.sapphire],
  "--syn-rainbow-3": ["RAINBOW_COLOR3", (c) => c.a.yellow],
  "--syn-rainbow-4": ["RAINBOW_COLOR4", (c) => c.a.green],
  "--syn-rainbow-5": ["RAINBOW_COLOR5", (c) => c.a.peach],
  // Gruvppuccin's keyword roles: read by the runtime's keyword marks (fall back to --syn-keyword).
  "--syn-keyword-module": ["GRUVPPUCCIN.IMPORT", () => "var(--syn-keyword)"],
  "--syn-keyword-return": ["GRUVPPUCCIN.RETURN", () => "var(--syn-keyword)"],
  "--syn-keyword-control": ["GRUVPPUCCIN.CONTROL_FLOW", () => "var(--syn-keyword)"],
  "--syn-keyword-definition": ["GRUVPPUCCIN.DECLARATION", () => "var(--syn-keyword)"],
};

const waveError = (c: Ctx) => c.attr("ERRORS_ATTRIBUTES")?.effect ?? c.a.red;
const waveWarning = (c: Ctx) => c.attr("WARNING_ATTRIBUTES")?.effect ?? c.a.yellow;

/** IntelliJ's console magenta in the generated dark schemes repeats the operator colour (a cyan); use the palette's mauve. */
function magenta(c: Ctx): string {
  const own = c.fg("CONSOLE_MAGENTA_OUTPUT", c.a.mauve);
  const cyan = c.fg("CONSOLE_CYAN_OUTPUT", c.a.sapphire);
  return distance(own, cyan) < distance(own, c.a.mauve) ? c.a.mauve : own;
}

const ANSI: Record<string, Role> = {
  black: (c) => c.fg("CONSOLE_BLACK_OUTPUT", c.r.crust),
  red: (c) => c.fg("CONSOLE_RED_OUTPUT", c.a.red),
  green: (c) => c.fg("CONSOLE_GREEN_OUTPUT", c.a.green),
  yellow: (c) => c.fg("CONSOLE_YELLOW_OUTPUT", c.a.yellow),
  blue: (c) => c.fg("CONSOLE_BLUE_OUTPUT", c.a.sapphire),
  magenta,
  cyan: (c) => c.fg("CONSOLE_CYAN_OUTPUT", c.a.sapphire),
  // ANSI white is ordinary output text: IntelliJ's CONSOLE_GRAY_OUTPUT (overlay0) reads as disabled there.
  white: (c) => c.r.subtext1,
  "bright-black": (c) => c.fg("CONSOLE_DARK_GRAY_OUTPUT", c.r.overlay2),
  "bright-red": (c) => c.fg("CONSOLE_DARK_RED_OUTPUT", c.a.red),
  "bright-green": (c) => c.fg("CONSOLE_DARK_GREEN_OUTPUT", c.a.green),
  "bright-yellow": (c) => c.fg("CONSOLE_DARK_YELLOW_OUTPUT", c.a.yellow),
  "bright-blue": (c) => c.fg("CONSOLE_DARK_BLUE_OUTPUT", c.a.sapphire),
  "bright-magenta": (c) => c.fg("CONSOLE_DARK_MAGENTA_OUTPUT", c.a.mauve),
  "bright-cyan": (c) => c.fg("CONSOLE_DARK_CYAN_OUTPUT", c.a.sapphire),
  "bright-white": (c) => c.fg("CONSOLE_WHITE_OUTPUT", c.r.text),
};

/** Editor scheme file tokens. */
export const SCHEME_ROLES: Record<string, Role> = {
  ...Object.fromEntries(
    Object.entries(SYNTAX_ATTRIBUTES).map(([name, [key, fallback]]) => [name, (c: Ctx) => c.fg(key, fallback(c))]),
  ),
  "--syn-comment": (c) => c.fg("DEFAULT_LINE_COMMENT", c.r.overlay1),
  "--syn-comment-style": (c) => ((c.attr("DEFAULT_LINE_COMMENT")?.fontType ?? 0) & 2 ? "italic" : "normal"),
  "--syn-doc-comment-tag-effect": (c) => effect(c.attr("DEFAULT_DOC_COMMENT_TAG")),
  "--syn-doc-markup-bg": (c) => c.attr("DEFAULT_DOC_MARKUP")?.bg ?? "transparent",
  "--syn-namespace": () => "var(--fg-editor)",
  "--syn-python-local-variable": () => "var(--syn-variable)",
  "--syn-python-global-variable": () => "var(--syn-global)",
  "--syn-python-instance-attribute": () => "var(--syn-property)",
  "--syn-python-constant": () => "var(--syn-constant)",
  "--syn-python-property": () => "var(--syn-property)",
  "--syn-python-type-parameter": () => "var(--syn-type)",
  "--syn-python-nested-function": () => "var(--syn-function)",
  "--syn-python-method-call": () => "var(--syn-function-call)",
  "--syn-python-annotation": () => "var(--syn-type)",
  "--syn-python-format": () => "var(--syn-escape)",
  "--syn-python-fstring": () => "var(--syn-string)",
  "--syn-python-docstring-tag": () => "var(--syn-doc-comment-tag)",
  "--syn-python-docstring-tag-effect": () => "var(--syn-doc-comment-tag-effect)",
  "--syn-python-docstring-keyword": () => "var(--syn-doc-comment-tag-value)",
  "--syn-php-variable": () => "var(--syn-property)",
  "--syn-php-function-call": () => "var(--syn-function)",
  "--syn-invalid": (c) => c.fg("BAD_CHARACTER", waveError(c)),
  "--syn-bracket-1": (c) => c.a.yellow,
  "--syn-bracket-2": (c) => c.a.mauve,
  "--syn-bracket-3": (c) => c.a.sapphire,
  "--syn-bracket-4": (c) => c.a.green,
  "--syn-bracket-5": (c) => c.a.peach,

  // Editor
  "--fg-editor": (c) => c.fg("TEXT", c.r.text),
  "--caret": () => "var(--gp-accent-caret)",
  "--fg-line-number": (c) => c.color("LINE_NUMBERS_COLOR", c.r.overlay0),
  "--fg-line-number-current": () => "var(--gp-accent-caret)",
  "--border-gutter": (c) => c.editor,
  "--border-indent-guide": (c) => c.color("INDENT_GUIDE", c.r.surface1),
  "--border-indent-guide-active": (c) => c.color("SELECTED_INDENT_GUIDE", c.r.surface2),
  "--border-right-margin": (c) => c.color("RIGHT_MARGIN_COLOR", c.r.surface1),
  "--bg-editor-selection": (c) => c.color("SELECTION_BACKGROUND", c.r.surface2),
  "--bg-editor-selection-inactive": (c) => mix(c.editor, c.color("SELECTION_BACKGROUND", c.r.surface2), 0.6),
  "--fg-editor-selection": () => "inherit",
  "--bg-text-search-result": (c) => c.attr("TEXT_SEARCH_RESULT_ATTRIBUTES")?.bg ?? c.r.surface2,
  "--bg-text-search-result-current": (c) => alpha(c.a.yellow, c.dark ? 0.45 : 0.55),
  "--bg-search-result": (c) => c.attr("SEARCH_RESULT_ATTRIBUTES")?.bg ?? c.r.surface2,
  "--bg-matched-brace": (c) => c.attr("MATCHED_BRACE_ATTRIBUTES")?.bg ?? c.r.surface2,
  "--matched-brace-weight": () => "var(--fw-code-bold)",
  "--bg-matched-tag": (c) => c.attr("MATCHED_BRACE_ATTRIBUTES")?.bg ?? c.r.surface2,
  "--bg-fold-placeholder": (c) => c.attr("FOLDED_TEXT_ATTRIBUTES")?.bg ?? c.r.surface0,
  "--fg-fold-placeholder": (c) => c.fg("FOLDED_TEXT_ATTRIBUTES", c.r.overlay2),
  "--fg-fold-marker": (c) => c.r.overlay0,
  "--fg-whitespace": (c) => c.color("WHITESPACES", c.r.overlay0),
  "--fg-unused": (c) => c.fg("NOT_USED_ELEMENT_ATTRIBUTES", c.r.overlay0),
  "--wave-typo": (c) => c.attr("TYPO")?.effect ?? c.a.green,
  "--fg-deprecated": (c) => c.fg("DEPRECATED_ATTRIBUTES", c.r.overlay0),
  "--bg-identifier-under-caret": (c) => c.attr("IDENTIFIER_UNDER_CARET_ATTRIBUTES")?.bg ?? c.r.surface1,
  "--bg-identifier-under-caret-write": (c) =>
    c.attr("WRITE_IDENTIFIER_UNDER_CARET_ATTRIBUTES")?.bg ?? tint(c, c.a.red, 0.2),
  "--fg-identifier-under-caret": () => "inherit",
  "--fg-identifier-under-caret-write": () => "inherit",
  "--fg-inlay": (c) => c.fg("INLINE_PARAMETER_HINT", c.r.overlay2),
  "--bg-inlay": (c) => c.attr("INLINE_PARAMETER_HINT")?.bg ?? c.r.surface0,
  "--wave-error": waveError,
  "--wave-warning": waveWarning,
  "--editor-error-decoration": (c) => `underline wavy ${waveError(c)}`,
  "--editor-warning-decoration": (c) => `underline wavy ${waveWarning(c)}`,
  "--editor-warning-background": () => "transparent",
  "--bg-breakpoint-line": (c) => mix(c.editor, c.a.red, 0.18),
  "--fg-completion-match": () => "var(--gp-accent)",
  "--bg-editor-inline": (c) => c.r.mantle,
  "--bg-editor-banner": (c) => tint(c, c.a.sapphire, 0.14),
  "--fg-weak-warning": (c) => c.r.overlay1,
  "--fg-bulb": (c) => c.a.yellow,

  ...Object.fromEntries(
    Object.entries(ANSI).flatMap(([name, role]) => [
      [`--ansi-${name}`, role],
      [`--terminal-ansi-${name}`, role],
    ]),
  ),
};

/** Fork tokens every theme file carries: the palette as `--gp-*`, and the accent indirections. */
export function paletteTokens(p: PaletteData): Record<string, string> {
  return {
    ...Object.fromEntries(ACCENTS.map((k) => [`--gp-${k}`, p.swatches[k]])),
    ...Object.fromEntries(RAMP.map((k) => [`--gp-${k}`, p.ramp[k]])),
    "--gp-accent": "var(--gp-sapphire)",
    "--gp-accent-tab": "var(--gp-accent)",
    "--gp-accent-toolwindow": "var(--gp-accent)",
    "--gp-accent-caret": "var(--gp-accent)",
  };
}

/**
 * Style tokens of the theme file. Classic draws hairline borders instead of islands; island
 * gap and radius are left to the runtime for the island styles, so compact mode keeps working
 * (a theme's tokens outrank `:root[data-compact]`).
 */
export function styleTokens(c: Ctx): Record<string, string> {
  return c.style === "classic" ? { "--island-gap": "1px", "--island-radius": "0px" } : {};
}

/** Scheme extras outside the token reference: the editor and console surfaces, and font styles. */
export function schemeExtras(c: Ctx): Record<string, string> {
  const out: Record<string, string> = {
    "--bg-editor": c.editor,
    "--bg-console": c.color("CONSOLE_BACKGROUND_KEY", c.editor),
  };
  for (const [name, [key]] of Object.entries(SYNTAX_ATTRIBUTES)) Object.assign(out, fontTokens(name, c.attr(key)));
  return out;
}
