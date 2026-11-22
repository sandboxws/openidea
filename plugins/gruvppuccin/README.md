# Gruvppuccin

Gruvbox × Catppuccin for OpenIDEA, ported from the Gruvppuccin IntelliJ theme: 21 palettes, each in
Classic, Island and Soft Island styles (63 themes), and the Gruvppuccin file icon theme.

| Family                      | Palettes                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Gruvppuccin                 | Macchiato, Mocha, Latte (light)                                                                                               |
| Gruvppuccin Embark blends   | Nebula, Void, Nova (light), Haze (light)                                                                                      |
| Gruvbark (Gruvbox × Embark) | Nebula, Void, Nova (light), Haze (light)                                                                                      |
| Gruvppuccin Nocturne        | Gopher Macchiato, Gopher Sand, Gruv, Midnight Mocha, Nebula Ember, Neon Gopher, Pine Shadow, Rosewood, Tidewater, Void Gopher |

- **Classic** draws hairline borders between flat panels.
- **Island** sinks the tool windows into the frame and floats the editor.
- **Soft Island** does the same with a gentler frame.

Pick a theme in Settings › Appearance › Theme and the icons in Settings › Plugins › Gruvppuccin Icons.
The accent slot, its tab / tool window / caret overrides, presets, bold keywords and corner radius
are on the fork's Settings › Appearance › Gruvppuccin page.

## Install from this repository

```sh
cargo run -p ide-host --bin openidea-plugin -- link plugins/gruvppuccin
```

## Regenerate

The themes are generated; don't edit `themes/` or `icons/theme.json` by hand.

```sh
node scripts/gruvppuccin/extract.ts <gruvppuccin-intellij-checkout>  # refresh data/palettes.json and icons/
node scripts/gruvppuccin/generate.ts                                 # rewrite the plugin
node scripts/gruvppuccin/generate.ts --check                         # what CI runs (via vitest)
```

Token values are roles of each palette (`scripts/gruvppuccin/roles.ts`): syntax, console and VCS
colours come from the IntelliJ editor schemes; surfaces follow the IntelliJ theme's role choices.

Third-party attributions are in [NOTICE](NOTICE).
