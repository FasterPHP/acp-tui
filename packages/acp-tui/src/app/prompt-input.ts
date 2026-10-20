// What text the prompt box takes (opentui-0-6 design D5; spec tui-layout "Prompt box"): one rule
// for every way text enters it (the bracketed paste, the clipboard read, palette commands and
// file mentions). Terminal escape sequences are removed with OpenTUI's own `stripAnsiSequences`
// (a lone or cut-off ESC included), a carriage return followed by a line feed becomes one line
// feed and any other carriage return a line feed (terminals send pasted line breaks as CR), and
// every other C0 control character except tab and line feed, DEL and every C1 control character
// is dropped.
//
// Why drop them: OpenTUI 0.6.1's editor keeps such characters and draws them as caret notation
// (`^G`, `<85>`), two or four cells each, while the prompt is sent to an agent, where they are
// noise from a terminal or log copy (acp-model's sanitiser removes the same set from agent text);
// and acp-tui's mention offsets (./mentions.ts, `Bun.stringWidth`, which gives a control no
// cells) would no longer match the editor's. Without them, what is shown is what is sent.
import { stripAnsiSequences } from "@opentui/core";

/** C0 controls but tab (U+0009) and line feed (U+000A), DEL and the C1 controls. */
const DROPPED = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** `text` as the prompt box takes it (see the module header). */
export function promptInput(text: string): string {
  return stripAnsiSequences(text).replace(/\r\n?/g, "\n").replace(DROPPED, "");
}
