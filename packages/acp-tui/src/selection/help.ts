// What help says about selecting text (spec tui-selection "Native selection
// stays one step away"): `acp-tui`'s plain drag, and the terminal's own
// selection by Shift+drag or F2 (lower case, as every key acp-tui shows,
// mvp-chrome-and-keys task 12.8). One wording, shown by `--help` (cli.ts) and
// meant for key help (`tui-palette`) when mvp-chrome-and-keys builds it. Pure.

/** The lines of the help's "Mouse and selection" paragraph, without indentation. */
export const SELECTION_HELP: readonly string[] = [
  "Plain drag in the conversation is acp-tui's own selection: on release it",
  "copies the text as the conversation holds it, unwrapped, and ctrl+c",
  "copies it again. shift+drag is the terminal's native selection, and f2",
  "turns acp-tui's mouse reporting off and on, leaving the mouse to the",
  "terminal; native selection copies text wrapped as shown on screen.",
];
