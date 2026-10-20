// Key settings: the `interrupt` setting of `tui-config` (mvp-configuration
// task 4.6, design D13). The configuration store holds it (`config().interrupt`);
// <App> hands the key controller a function reading it at each Esc, so a
// reload applies at once. Tests may override it through `RunAppExtras`
// (app/run.tsx) and `<App interrupt>`.

/**
 * `interrupt` (spec tui-keymap "Escape", tui-config "Interrupt setting"): `double` (the default)
 * arms interrupt on the first Esc and cancels on a second within 2 s; `single` cancels on the Esc
 * that would arm it. Every other meaning of Esc (closing an overlay, the find bar or a selection,
 * returning focus from the conversation or a card) is the same under both, and never cancels.
 */
export type InterruptSetting = "double" | "single";

export const DEFAULT_INTERRUPT: InterruptSetting = "double";
