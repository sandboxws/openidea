/** Resolves a generated theme's tokens to concrete colours, for the contrast checks. */
import { over } from "./color.ts";
import { stripJsonComments } from "../theme/tokens.ts";

export interface ThemeJson {
  id: string;
  name: string;
  kind: "dark" | "light";
  tokens: Record<string, string>;
}

export function parseThemeFile(src: string): ThemeJson {
  return JSON.parse(stripJsonComments(src)) as ThemeJson;
}

const VAR = /^var\((--[a-z0-9-]+)(?:,\s*(.+))?\)$/;

/** Follows `var(--x[, fallback])` chains inside `tokens`; `null` for anything else that isn't a hex colour. */
export function resolveColor(tokens: Record<string, string>, name: string, depth = 0): string | null {
  const value = tokens[name];
  if (value === undefined || depth > 16) return null;
  const m = VAR.exec(value.trim());
  if (m) return resolveColor(tokens, m[1]!, depth + 1) ?? (m[2] ? literal(m[2]) : null);
  return literal(value);
}

function literal(value: string): string | null {
  return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/** An opaque colour: translucent ones composited over `background`. */
export function opaque(color: string, background: string): string {
  return color.length === 9 ? over(color, background) : color;
}
