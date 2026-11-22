/** Small sRGB helpers for the Gruvppuccin generator. Colours are `#rrggbb` or `#rrggbbaa`. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parse(hex: string): Rgba {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb[aa] colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

const byte = (v: number) =>
  Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, "0");

export function format({ r, g, b, a }: Rgba): string {
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a * 255) : ""}`;
}

/** `t` of the way from `from` to `to` (alpha ignored). */
export function mix(from: string, to: string, t: number): string {
  const x = parse(from);
  const y = parse(to);
  return format({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: 1 });
}

/** `color` at opacity `alpha` (0–1). */
export function alpha(color: string, value: number): string {
  return format({ ...parse(color), a: value });
}

/** A translucent colour composited over an opaque background. */
export function over(color: string, background: string): string {
  const c = parse(color);
  const bg = parse(background);
  return format({
    r: c.r * c.a + bg.r * (1 - c.a),
    g: c.g * c.a + bg.g * (1 - c.a),
    b: c.b * c.a + bg.b * (1 - c.a),
    a: 1,
  });
}

/** Euclidean distance in sRGB bytes. */
export function distance(x: string, y: string): number {
  const a = parse(x);
  const b = parse(y);
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function luminance(hex: string): number {
  const { r, g, b } = parse(hex);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio of two opaque colours. */
export function contrast(x: string, y: string): number {
  const a = luminance(x);
  const b = luminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The candidate with the best contrast against `background`. */
export function bestOn(background: string, candidates: readonly string[]): string {
  return candidates.reduce((best, c) => (contrast(c, background) > contrast(best, background) ? c : best));
}

/**
 * `color` moved toward `ink` just far enough to reach `min` contrast on `background`
 * (status colours on light surfaces), never more than `limit` of the way.
 */
export function readable(color: string, background: string, ink: string, min: number, limit = 0.6): string {
  for (let t = 0; t <= limit + 1e-9; t += 0.05) {
    const c = t === 0 ? color : mix(color, ink, t);
    if (contrast(c, background) >= min) return c;
  }
  return mix(color, ink, limit);
}
