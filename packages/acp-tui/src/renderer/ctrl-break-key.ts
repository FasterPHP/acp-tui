// Ctrl+Break as a key (windows-support design D8). Windows Terminal raises Ctrl+Break as a console
// control event (SIGBREAK), which the lifecycle handles. From 1.25, though, once an application has
// asked for kitty keyboard flags (OpenTUI does whenever the terminal answers `CSI ? u`), Windows
// Terminal encodes Ctrl+Break as a key instead and raises no event: code point 3 with Ctrl, as
// `CSI 3;5u` with flags 1 and `CSI 3::57359;5u` with OpenTUI's flags 5. Unhandled, it did nothing.
// On Windows this handler takes that key ahead of the key dispatch and ends acp-tui as SIGBREAK
// would, so Ctrl+Break behaves the same in 1.24 and 1.25.
import type { CliRenderer } from "@opentui/core";

/** `CSI 3 [:alternates] ; modifiers [:event] u`, a kitty key report for code point 3. */
const KITTY_CODE_POINT_3 = /^\x1b\[3(?::\d*)*;(\d+)(?::(\d+))?u$/;

/** True for a kitty press or repeat of code point 3 with Ctrl held (Ctrl+Break), not its release. */
export function isCtrlBreakKey(sequence: string): boolean {
  const match = KITTY_CODE_POINT_3.exec(sequence);
  if (!match) return false;
  const modifiers = Number(match[1]) - 1;
  const event = match[2] === undefined ? 1 : Number(match[2]);
  return (modifiers & 4) !== 0 && event !== 3;
}

/** Installs the handler on Windows (nothing elsewhere); `onBreak` runs once per press. */
export function installCtrlBreakKey(
  renderer: Pick<CliRenderer, "prependInputHandler">,
  onBreak: () => void,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32") return;
  renderer.prependInputHandler((sequence) => {
    if (!isCtrlBreakKey(sequence)) return false;
    onBreak();
    return true;
  });
}
