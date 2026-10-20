// Recorded terminal palettes (mvp-rendering task 3.3): the 16 ANSI colours and the default
// foreground and background of the themes the legibility test (spec tui-theme "Legible defaults in
// low-contrast themes") and the highlight surfaces are checked against. Test fixtures, and since
// mvp-configuration task 5.6 also the palettes `config --check` measures a user's theme on
// (src/theme/legibility.ts).
//
// Sources, as recorded on 8 October 2026:
// - PhpStorm 2026.2.3 (build PS-262.10968.76, installed under ~/.local/share/JetBrains/Toolbox/apps/
//   phpstorm): the IDE's own colour scheme files. The terminal takes ANSI n from the scheme's
//   console keys in ConsoleHighlighter's order (CONSOLE_BLACK_OUTPUT, RED, GREEN, YELLOW, BLUE,
//   MAGENTA, CYAN, GRAY, DARKGRAY, RED_BRIGHT, GREEN_BRIGHT, YELLOW_BRIGHT, BLUE_BRIGHT,
//   MAGENTA_BRIGHT, CYAN_BRIGHT, WHITE; read from the class in lib/intellij.platform.ide.jar), the
//   background from CONSOLE_BACKGROUND_KEY and the foreground from CONSOLE_NORMAL_OUTPUT.
//   - Islands Dark: lib/intellij.platform.ide.impl.jar themes/islands/IslandSchemeDark.xml (scheme
//     "Islands Dark", parent "Darcula": background 191A1C, foreground bcbec4, as PhpStorm answered
//     OSC 10 and 11 in S2), its ANSI colours inherited from "Darcula" in DefaultColorSchemesManager.xml
//     (same jar).
//   - Islands Light: the theme's editor scheme is "Light" (themes/expUI/expUI_lightScheme.xml, parent
//     "Default"), which sets no console colours, so all of them come from "Default" in
//     DefaultColorSchemesManager.xml (background ffffff, foreground 000000). S2's screenshots showed
//     the pane as about 252,254,254; the scheme value is recorded.
// - Zed 1.18.1: captured live on 9 October 2026 with the IDE check kit's `osc4-capture.ts` (OSC 4
//   for the 16 colours, OSC 10 and 11 for the foreground and background), theme by theme (One
//   Light, One Dark, Ayu Light). The values differ from the theme files (`terminal.*` keys of
//   assets/themes/one/one.json and assets/themes/ayu/ayu.json at the zed-industries/zed tag v1.18.1,
//   used on 8 October 2026) by one unit in one channel at most (Zed's colour conversion), so the
//   earlier result stands. Zed raises low-contrast ANSI text towards APCA 45 when it draws, so
//   these are the harsher case.
// - Solarized Light: Ethan Schoonover's palette (altercation/solarized, xresources/solarized, the
//   sixteen colours unchanged between the dark and light modes, as terminal ports such as Alacritty's
//   and iTerm2's do), with the light mode's background base3 #fdf6e3 and body text base00 #657b83.

export interface RecordedPalette {
  readonly name: string;
  readonly source: string;
  readonly background: string;
  readonly foreground: string;
  /** ANSI 0 to 15. */
  readonly ansi: readonly string[];
}

export const ISLANDS_DARK: RecordedPalette = {
  name: "PhpStorm Islands Dark",
  source: "PhpStorm 2026.2.3 IslandSchemeDark.xml (parent Darcula, DefaultColorSchemesManager.xml)",
  background: "#191a1c",
  foreground: "#bcbec4",
  // prettier-ignore
  ansi: ["#000000", "#f0524f", "#5c962c", "#a68a0d", "#3993d4", "#a771bf", "#00a3a3", "#808080",
         "#595959", "#ff4050", "#4fc414", "#e5bf00", "#1fb0ff", "#ed7eed", "#00e5e5", "#ffffff"],
};

export const ISLANDS_LIGHT: RecordedPalette = {
  name: "PhpStorm Islands Light",
  source: "PhpStorm 2026.2.3 expUI_lightScheme.xml (parent Default, DefaultColorSchemesManager.xml)",
  background: "#ffffff",
  foreground: "#000000",
  // prettier-ignore
  ansi: ["#000000", "#ce0505", "#067d17", "#b28c00", "#063fdb", "#b309b3", "#028e8e", "#929292",
         "#656565", "#ff1616", "#16b42c", "#ecc32c", "#2d61f0", "#e617e6", "#15c1c1", "#c9c9c9"],
};

export const ZED_ONE_LIGHT: RecordedPalette = {
  name: "Zed One Light",
  source: "captured live by OSC 4 in Zed 1.18.1, theme One Light, 2026-10-09",
  background: "#fafafa",
  foreground: "#2a2c33",
  // prettier-ignore
  ansi: ["#000000", "#de3d34", "#3e9539", "#d2b67c", "#2f5af3", "#950095", "#0897b3", "#bbbbbb",
         "#000000", "#de3d34", "#3e9539", "#d2b67c", "#2f5af3", "#a00095", "#0abbd6", "#ffffff"],
};

export const ZED_ONE_DARK: RecordedPalette = {
  name: "Zed One Dark",
  source: "captured live by OSC 4 in Zed 1.18.1, theme One Dark, 2026-10-09",
  background: "#282c33",
  foreground: "#abb2bf",
  // prettier-ignore
  ansi: ["#282c33", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c677dd", "#56b6c2", "#abb2bf",
         "#636d83", "#ea858a", "#aad581", "#ffd885", "#85c0ff", "#d397ea", "#6ed5de", "#fafafa"],
};

export const ZED_AYU_LIGHT: RecordedPalette = {
  name: "Zed Ayu Light",
  source: "captured live by OSC 4 in Zed 1.18.1, theme Ayu Light, 2026-10-09",
  background: "#fcfcfc",
  foreground: "#5c6166",
  // prettier-ignore
  ansi: ["#5c6166", "#ef7271", "#84b303", "#f1ad49", "#3b9ee5", "#55b4d3", "#4dbf99", "#fcfcfc",
         "#3b9ee5", "#febab6", "#c7d98f", "#fed5a3", "#abcdf2", "#b1d7e8", "#ace0cb", "#ffffff"],
};

export const SOLARIZED_LIGHT: RecordedPalette = {
  name: "Solarized Light",
  source: "altercation/solarized xresources/solarized; light mode background base3, foreground base00",
  background: "#fdf6e3",
  foreground: "#657b83",
  // prettier-ignore
  ansi: ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
         "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"],
};

/** Every recorded palette, dark and light. */
export const RECORDED_PALETTES: readonly RecordedPalette[] = [ISLANDS_DARK, ISLANDS_LIGHT, ZED_ONE_LIGHT, ZED_ONE_DARK, ZED_AYU_LIGHT, SOLARIZED_LIGHT];
