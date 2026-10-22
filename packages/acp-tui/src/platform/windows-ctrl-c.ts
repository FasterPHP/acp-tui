// Ctrl+C processing for acp-tui's console on Windows, through `bun:ffi`. A Windows process can be
// started with Ctrl+C ignored (`CREATE_NEW_PROCESS_GROUP`, `start /b`, some CI runners and shells),
// and the setting is inherited: such a process gets no `CTRL_C_EVENT`, so no SIGINT listener of
// Bun's ever runs. `SetConsoleCtrlHandler(NULL, FALSE)` turns the processing back on, as a POSIX
// program's own SIGINT handler replaces an inherited `SIG_IGN`; the programs acp-tui starts after
// it inherit the processing.
//
// Loaded only on Windows, with `require` from platform/ctrl-c.ts, so Linux and macOS never load
// `bun:ffi` or try to open a Windows library. `kernel32.dll` is opened by absolute path in
// `%SystemRoot%\System32`, never by bare name, so no DLL in the session directory can stand in.
import { dlopen, FFIType } from "bun:ffi";
import { win32 } from "node:path";

/** Turns Ctrl+C processing on for this process; false when Windows refused. Throws when the
 *  library or symbol cannot be opened. */
export function enableConsoleCtrlC(): boolean {
  const root = process.env["SystemRoot"] || process.env["windir"] || "C:\\Windows";
  const system32 = win32.join(win32.isAbsolute(root) ? root : "C:\\Windows", "System32");
  const kernel32 = dlopen(win32.join(system32, "kernel32.dll"), {
    // BOOL SetConsoleCtrlHandler(PHANDLER_ROUTINE HandlerRoutine, BOOL Add): with no routine,
    // FALSE restores the processing of Ctrl+C.
    SetConsoleCtrlHandler: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  });
  try {
    return kernel32.symbols.SetConsoleCtrlHandler(null, 0) !== 0;
  } finally {
    kernel32.close();
  }
}
