// The console's title on Windows, read with `GetConsoleTitleW` through `bun:ffi`, so acp-tui can
// tell when something sharing its console has retitled the tab (renderer/terminal-signals.ts). A
// harness on Windows shares acp-tui's console: npm's `.cmd` shims run `title %COMSPEC%`, Claude
// Code sets `process.title` as each of its processes starts, and a command a tool runs may do the
// same. The console title follows both kinds of write, an OSC title on the output and
// `SetConsoleTitle`, in Windows Terminal and in an IDE's ConPTY alike; a read costs about 25 µs.
//
// Loaded only on Windows, with `require` from terminal-signals.ts, so Linux and macOS never load
// `bun:ffi` or try to open a Windows library. `kernel32.dll` is opened by absolute path in
// `%SystemRoot%\System32`, never by bare name, so no DLL in the session directory can stand in.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { win32 } from "node:path";

/** Characters read back: more than any title acp-tui sets (60 columns); a longer one still differs. */
const TITLE_CHARS = 1024;

/** A reader of the console's title: the text, or null when there is none or it cannot be read. */
export type ConsoleTitleReader = () => string | null;

/** Opens `kernel32.dll` and returns the reader; throws when the library or symbol cannot be opened. */
export function consoleTitleReader(): ConsoleTitleReader {
  const root = process.env["SystemRoot"] || process.env["windir"] || "C:\\Windows";
  const system32 = win32.join(win32.isAbsolute(root) ? root : "C:\\Windows", "System32");
  const kernel32 = dlopen(win32.join(system32, "kernel32.dll"), {
    // DWORD GetConsoleTitleW(LPWSTR lpConsoleTitle, DWORD nSize): the length copied, 0 on failure.
    GetConsoleTitleW: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  });
  const buffer = new Uint16Array(TITLE_CHARS);
  const pointer = ptr(buffer);
  return () => {
    const length = kernel32.symbols.GetConsoleTitleW(pointer, TITLE_CHARS);
    if (length === 0) return null;
    return String.fromCharCode(...buffer.subarray(0, Math.min(length, TITLE_CHARS - 1)));
  };
}
