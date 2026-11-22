// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  displayName,
  family,
  flattenUi,
  paletteId,
  parseAccentPicker,
  parseScheme,
  resolveUiColor,
  uiValue,
} from "./extract.ts";

describe("parseScheme", () => {
  const xml = `<scheme name="Gruvppuccin Test" version="142" parent_scheme="Darcula">
    <!-- <option name="EDITOR_FONT_SIZE" value="12" /> -->
    <colors>
      <option name="CARET_COLOR" value="7DAEA3" />
      <option name="INDENT_GUIDE" value="32302f50" />
      <option name="EMPTY" value="" />
    </colors>
    <attributes>
      <option name="DEFAULT_KEYWORD">
        <value>
          <!-- <option name="FOREGROUND" value="FFFFFF" /> -->
          <option name="FOREGROUND" value="C28FD6" />
          <option name="FONT_TYPE" value="1" />
        </value>
      </option>
      <option name="SLIM_CALL" baseAttributes="DEFAULT_KEYWORD" />
      <option name="CHAINED" baseAttributes="SLIM_CALL" />
      <option name="DANGLING" baseAttributes="MISSING" />
      <option name="DEFAULT_LINE_COMMENT">
        <value><option name="FOREGROUND" value="6E655A" /></value>
      </option>
      <option name="DEFAULT_LINE_COMMENT">
        <value><option name="FOREGROUND" value="6E655A" /><option name="FONT_TYPE" value="2" /></value>
      </option>
      <option name="ERRORS_ATTRIBUTES">
        <value>
          <option name="EFFECT_COLOR" value="EA6962" />
          <option name="ERROR_STRIPE_COLOR" value="EA6962" />
          <option name="EFFECT_TYPE" value="2" />
        </value>
      </option>
      <option name="DIFF_INSERTED">
        <value><option name="BACKGROUND" value="2A351A50" /></value>
      </option>
    </attributes>
  </scheme>`;
  const scheme = parseScheme(xml);

  it("reads the header and colours, skipping comments and empty values", () => {
    expect(scheme.name).toBe("Gruvppuccin Test");
    expect(scheme.parent).toBe("Darcula");
    expect(scheme.colors).toEqual({ CARET_COLOR: "#7daea3", INDENT_GUIDE: "#32302f50" });
  });

  it("follows baseAttributes chains and keeps font and effect types", () => {
    expect(scheme.attributes.DEFAULT_KEYWORD).toEqual({ fg: "#c28fd6", fontType: 1 });
    expect(scheme.attributes.CHAINED).toEqual({ fg: "#c28fd6", fontType: 1 });
    expect(scheme.attributes.DANGLING).toBeUndefined();
    expect(scheme.attributes.ERRORS_ATTRIBUTES).toEqual({ effect: "#ea6962", stripe: "#ea6962", effectType: 2 });
    expect(scheme.attributes.DIFF_INSERTED).toEqual({ bg: "#2a351a50" });
  });

  it("keeps a key's last definition", () => {
    expect(scheme.attributes.DEFAULT_LINE_COMMENT).toEqual({ fg: "#6e655a", fontType: 2 });
  });
});

describe("theme json", () => {
  it("flattens nested ui keys and resolves wildcards and named colours", () => {
    const flat = flattenUi({ "*": { background: "base" }, Tree: { rowHeight: 28 }, "Popup.background": "#1D2021" });
    expect(uiValue(flat, "Panel.background")).toBe("base");
    expect(uiValue(flat, "Popup.background")).toBe("#1D2021");
    expect(uiValue(flat, "Tree.rowHeight")).toBe("28");
    expect(resolveUiColor("base", { base: "#1d2021" })).toBe("#1d2021");
    expect(resolveUiColor("#abc", {})).toBe("#aabbcc");
    expect(resolveUiColor("missing", {})).toBeNull();
  });
});

describe("accent picker", () => {
  it("reads the per-palette swatches and labels of GruvppuccinPalette.kt", () => {
    const kotlin = `
    private val MOCHA = mapOf(
        "sapphire" to "#7daea3",
        "mauve" to "#C28FD6",
    )
    private val PALETTES = mapOf(
        "mocha" to MOCHA,
        "gruvppuccin_nocturne_gruv" to MOCHA,
    )
    private val LABELS = mapOf(
        "gruvppuccin_nocturne_rosewood" to mapOf("sapphire" to "Coral", "mauve" to "Lilac"),
    )`;
    const { swatches, labels } = parseAccentPicker(kotlin);
    expect(swatches.mocha).toEqual({ sapphire: "#7daea3", mauve: "#c28fd6" });
    expect(swatches.gruvppuccin_nocturne_gruv).toEqual(swatches.mocha);
    expect(labels.gruvppuccin_nocturne_rosewood).toEqual({ sapphire: "Coral", mauve: "Lilac" });
  });
});

describe("naming", () => {
  it("derives ids, families and edition-free names", () => {
    expect(paletteId("gruvppuccin_mocha")).toBe("mocha");
    expect(paletteId("gruvbark_nebula")).toBe("gruvbark-nebula");
    expect(paletteId("gruvppuccin_nocturne_pine_shadow")).toBe("nocturne-pine-shadow");
    expect(family("gruvppuccin_nebula")).toBe("embark");
    expect(family("gruvbark_haze")).toBe("gruvbark");
    expect(family("gruvppuccin_nocturne_gruv")).toBe("nocturne");
    expect(family("gruvppuccin_latte")).toBe("gruvppuccin");
    expect(displayName("Gruvppuccin (Lifetime) Gopher Sand")).toBe("Gruvppuccin Nocturne Gopher Sand");
  });
});
