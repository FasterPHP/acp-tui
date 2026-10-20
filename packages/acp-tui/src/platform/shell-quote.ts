// One word of a command line that acp-tui prints for the user to paste into their shell (the
// resume line of the exit text, the "reopen it with" message; spec tui-screen "Resume line quoted
// for PowerShell on Windows"). On Windows the shell is PowerShell, elsewhere a POSIX shell; both
// leave a word bare when it holds only characters the shell reads as themselves, and otherwise
// put it in single quotes with an inner single quote doubled (PowerShell) or written `'\''`
// (POSIX).
import type { Platform } from "./paths.ts";

const POSIX_PLAIN = /^[A-Za-z0-9_@%+=:,./-]+$/;
// PowerShell reads `@name` as a splat, `a,b` as an array, and `%` as ForEach-Object in command
// position, so none of them stays bare; a backslash is an ordinary character there.
const POWERSHELL_PLAIN = /^[A-Za-z0-9_+=:./\\-]+$/;
// PowerShell takes the typographic single quotes as quotes too, so inside a single-quoted string
// each is doubled just as the ASCII one is.
const POWERSHELL_QUOTES = /['‘’‚‛]/g;

/** `word` quoted for PowerShell: as is when it holds only plain characters, else in single quotes. */
export function powershellWord(word: string): string {
  if (POWERSHELL_PLAIN.test(word)) return word;
  return `'${word.replace(POWERSHELL_QUOTES, (quote) => quote + quote)}'`;
}

/** `word` quoted for a POSIX shell: as is when it holds only plain characters, else in single quotes. */
export function posixWord(word: string): string {
  if (POSIX_PLAIN.test(word)) return word;
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/** `word` quoted for the shell of `platform`: PowerShell on Windows, a POSIX shell elsewhere. */
export function shellWordFor(word: string, platform: Platform = process.platform): string {
  return platform === "win32" ? powershellWord(word) : posixWord(word);
}
