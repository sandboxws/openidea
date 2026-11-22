import { afterEach, describe, expect, it, vi } from "vitest";
import { parseVariant, trackVariant } from "../activeTheme";

describe("parseVariant", () => {
  it("reads the palette and style of Gruvppuccin themes only", () => {
    expect(parseVariant("gruvppuccin/mocha", "dark")).toEqual({
      theme: "mocha",
      palette: "mocha",
      style: "classic",
      kind: "dark",
    });
    expect(parseVariant("gruvppuccin/nocturne-pine-shadow-soft-island", "dark")).toMatchObject({
      palette: "nocturne-pine-shadow",
      style: "soft-island",
    });
    expect(parseVariant("gruvppuccin/latte-island", "light")).toMatchObject({
      palette: "latte",
      style: "island",
      kind: "light",
    });
    expect(parseVariant("openidea.harbor-night/harbor-night", "dark")).toBeNull();
    expect(parseVariant("gruvppuccin/", "dark")).toBeNull();
    expect(parseVariant(undefined, undefined)).toBeNull();
  });
});

describe("trackVariant", () => {
  const root = document.documentElement;
  afterEach(() => {
    delete root.dataset.pluginTheme;
    delete root.dataset.pluginThemeKind;
  });

  it("reports the current variant and each change of the plugin theme", async () => {
    root.dataset.pluginTheme = "gruvppuccin/mocha";
    root.dataset.pluginThemeKind = "dark";
    const seen = vi.fn();
    const stop = trackVariant((v) => seen(v?.theme ?? null));
    expect(seen).toHaveBeenLastCalledWith("mocha");

    root.dataset.pluginTheme = "gruvppuccin/mocha-island";
    await Promise.resolve();
    expect(seen).toHaveBeenLastCalledWith("mocha-island");

    root.dataset.pluginTheme = "";
    await Promise.resolve();
    expect(seen).toHaveBeenLastCalledWith(null);
    stop();

    root.dataset.pluginTheme = "gruvppuccin/latte";
    await Promise.resolve();
    expect(seen).toHaveBeenCalledTimes(3);
  });
});
