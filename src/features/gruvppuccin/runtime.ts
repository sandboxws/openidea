/**
 * Applies the Gruvppuccin settings while a Gruvppuccin theme shows: the runtime stylesheet
 * (`css.ts`) and the `gruvppuccinActive` context key; `onActive` hears when that starts and
 * stops (the workbench turns keyword-role marks on in editors). The stylesheet is cached so
 * the next start shows the chosen accent before settings load. No editor imports: the
 * Settings window runs this too.
 */
import { setContext } from "@/platform/context";
import { call, commands, isTauri } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { trackVariant, type ActiveVariant } from "./activeTheme";
import { runtimeCss } from "./css";
import { PLUGIN_ID, effectiveSlots, readSettings, type GruvppuccinSettings } from "./model";

const STYLE_ID = "gp-runtime";
const CACHE_KEY = "openidea.gruvppuccin.runtime.v1";

/** The stored settings (defaults when none are). */
export function currentSettings(): GruvppuccinSettings {
  return readSettings(useProject.getState().settings?.plugins?.[PLUGIN_ID]);
}

/** Saves the settings globally, as the Settings page's Apply does. */
export async function saveSettings(next: GruvppuccinSettings): Promise<void> {
  await setGlobal(`plugins.${PLUGIN_ID}`, next);
}

export async function setGlobal(key: string, value: unknown): Promise<void> {
  if (!isTauri()) return;
  useProject.setState({ settings: await call(commands.settingsSet("global", key, JSON.stringify(value))) });
}

function luminance(color: string): number | null {
  const m = /^#([0-9a-f]{6})/i.exec(color.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** The ramp end (`crust`, `base` or `text`) with the best contrast on the chosen accent. */
export function onAccentStep(read: (token: string) => string, accent: string): string {
  const bg = luminance(read(`--gp-${accent}`));
  if (bg === null) return "crust";
  let best = "crust";
  let bestRatio = 0;
  for (const step of ["crust", "base", "text"]) {
    const fg = luminance(read(`--gp-${step}`));
    if (fg === null) continue;
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    if (ratio > bestRatio) [best, bestRatio] = [step, ratio];
  }
  return best;
}

function readCache(): string | null {
  try {
    return globalThis.localStorage?.getItem(CACHE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeCache(css: string | null) {
  try {
    if (css === null) globalThis.localStorage?.removeItem(CACHE_KEY);
    else globalThis.localStorage?.setItem(CACHE_KEY, css);
  } catch {
    // Storage unavailable: the next start shows the theme's default accent until settings load.
  }
}

export function startRuntime({ onActive }: { onActive?: (active: boolean) => void } = {}): () => void {
  const root = document.documentElement;
  let variant: ActiveVariant | null = null;
  let active = false;
  const setActive = (next: boolean) => {
    if (next === active) return;
    active = next;
    setContext("gruvppuccinActive", next);
    onActive?.(next);
  };

  const styleElement = () => {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    return el;
  };

  const apply = () => {
    if (!variant) {
      document.getElementById(STYLE_ID)?.remove();
      delete root.dataset.gp;
      setActive(false);
      return;
    }
    root.dataset.gp = "";
    const stored = useProject.getState().settings;
    // Before settings arrive, keep last session's stylesheet rather than flashing the defaults.
    const cached = stored ? null : readCache();
    if (cached !== null) styleElement().textContent = cached;
    else {
      const settings = currentSettings();
      const computed = getComputedStyle(root);
      const css = runtimeCss(settings, variant, {
        compact: root.hasAttribute("data-compact"),
        onAccent: onAccentStep((t) => computed.getPropertyValue(t), effectiveSlots(settings).accent),
      });
      styleElement().textContent = css;
      writeCache(css);
    }
    setActive(true);
  };

  const stopTracking = trackVariant((v) => {
    variant = v;
    apply();
  });
  const unsubscribe = useProject.subscribe((s, prev) => {
    if (s.settings?.plugins?.[PLUGIN_ID] !== prev.settings?.plugins?.[PLUGIN_ID] || (s.settings && !prev.settings))
      apply();
  });
  const compact = new MutationObserver(apply);
  compact.observe(root, { attributes: true, attributeFilter: ["data-compact"] });

  return () => {
    compact.disconnect();
    unsubscribe();
    stopTracking();
    variant = null;
    apply();
  };
}
