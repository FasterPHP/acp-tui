// Screen options from the command line (phase-1a task 4.4, spec tui-screen
// "Screen options on the command line", design D10): the mouse policy, the
// wheel step override, what is printed on exit and the clipboard choice.
// Since mvp-configuration they are settings of the configuration file under
// the same names (`mouse`, `wheel_lines`, `exit.print`, `clipboard`), and the
// options are per-run overrides of them (its design D5).
//
// cli.ts parses them into `ScreenOptions` and passes them to the app in
// `StartAppOptions.screen`, with the options given in `overrides`; runApp
// (src/app/run.tsx) merges them over the configuration and hands them on: the
// mouse policy to the renderer (create.ts, mouse.ts) and the store, the wheel
// step to the conversation (wheel.ts).

export type MousePolicy = "full" | "wheel" | "off";
export const MOUSE_POLICIES: readonly MousePolicy[] = ["full", "wheel", "off"];

/** What is printed below the command line on exit; `last-answer` and `transcript` print the
 *  conversation's projection after the resume line (src/find/hand-back.ts). */
export type ExitPrint = "summary" | "none" | "last-answer" | "transcript";
export const EXIT_PRINTS: readonly ExitPrint[] = ["summary", "none", "last-answer", "transcript"];

/** The `clipboard` setting and `--clipboard`: `auto` the host clipboard, then OSC 52; `host` the
 *  host only; `osc52` OSC 52 only; `none` copies nothing (src/selection/clipboard.ts). */
export type ClipboardMode = "auto" | "host" | "osc52" | "none";
export const CLIPBOARD_MODES: readonly ClipboardMode[] = ["auto", "host", "osc52", "none"];

export interface ScreenOptions {
  readonly mouse: MousePolicy;
  /** `--wheel-lines`: rows per wheel event for every terminal; null uses the per-terminal table. */
  readonly wheelLines: number | null;
  readonly exitPrint: ExitPrint;
  /** `--clipboard`: the copy paths. */
  readonly clipboard: ClipboardMode;
}

export const DEFAULT_SCREEN_OPTIONS: ScreenOptions = {
  mouse: "full",
  wheelLines: null,
  exitPrint: "summary",
  clipboard: "auto",
};
