/**
 * Which Gruvppuccin theme is showing, read from the attributes the plugin theme runtime
 * sets on `<html>` (`data-plugin-theme="gruvppuccin/mocha-island"`), so Quick Switch
 * previews count too.
 */
import { PLUGIN_ID } from "./model";

export type GruvppuccinStyle = "classic" | "island" | "soft-island";

export interface ActiveVariant {
  /** Theme id within the plugin: `mocha-island`. */
  theme: string;
  /** Palette id: `mocha`. */
  palette: string;
  style: GruvppuccinStyle;
  kind: "dark" | "light";
}

export function parseVariant(pluginTheme: string | undefined, kind: string | undefined): ActiveVariant | null {
  const prefix = `${PLUGIN_ID}/`;
  if (!pluginTheme?.startsWith(prefix)) return null;
  const theme = pluginTheme.slice(prefix.length);
  if (!theme) return null;
  const style: GruvppuccinStyle = theme.endsWith("-soft-island")
    ? "soft-island"
    : theme.endsWith("-island")
      ? "island"
      : "classic";
  const palette = style === "classic" ? theme : theme.slice(0, -(style.length + 1));
  return { theme, palette, style, kind: kind === "light" ? "light" : "dark" };
}

export function readVariant(root: HTMLElement = document.documentElement): ActiveVariant | null {
  return parseVariant(root.dataset.pluginTheme, root.dataset.pluginThemeKind);
}

/** Calls `onChange` with the active variant now and whenever the plugin theme changes. */
export function trackVariant(onChange: (v: ActiveVariant | null) => void, root = document.documentElement): () => void {
  let last = readVariant(root);
  onChange(last);
  const observer = new MutationObserver(() => {
    const next = readVariant(root);
    if (next?.theme === last?.theme && next?.kind === last?.kind) return;
    last = next;
    onChange(next);
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-plugin-theme", "data-plugin-theme-kind"] });
  return () => observer.disconnect();
}
