// Test hooks (mvp-configuration design D14, task 9.4; spec tui-config "Spike
// switch retired"): behaviour only tests and the IDE checks reach, through the
// environment variable `ACP_TUI_TEST_HOOKS` (a comma list), read once at
// start-up. It is in no `--help`, no configuration setting and no palette
// entry, so a user cannot reach it from the command line, the configuration
// or the palette.
//
// `crash` (formerly `--spike crash`): F12 throws an error that nothing
// catches, so the PTY tests (`test/renderer/exit.pty.test.ts`) and the IDE
// checks' crash path can check the uncaught-error exit path in the real CLI:
// terminal restored, the error below the command line, exit status 1, no
// `session/cancel` or `session/close`. The throw happens in a timer, outside
// every OpenTUI and Solid handler, so it reaches `uncaughtException` as a real
// bug would. Without the hook, F12 does nothing.
//
// `no-host-clipboard` (windows-support D10): the host clipboard does not exist, whatever the
// platform and the environment say (`hostDisplay()` in `selection/clipboard.ts` returns null), so
// no clipboard program runs and no native backend is created. Linux tests only had to remove the
// display variables, but macOS and Windows have a clipboard with no variable to remove, so every
// test that starts acp-tui (the PTY harness, and the test preload for the process itself) sets it.
// Copies go to OSC 52 and pastes read nothing, exactly as in a session over SSH.
//
// `no-native-clipboard`: the narrower form for tests that put stub clipboard programs on a
// `PATH` of their own (`test/selection/clipboard-stub.ts`): the stubs are found and run, but the
// native backend is never created, so even a failing stub cannot fall through to the real
// clipboard. The PTY harness adds `no-host-clipboard` unless a test names this one.
//
// `short-change-timeout` (oc-model): a config option change the harness has not answered shows its
// waiting notice after 300 ms instead of 3 s and its warning after 2 s instead of 30 s
// (`overlay/Overlay.tsx`), so a PTY test can see both.
import type { CliRenderer, KeyEvent } from "@opentui/core";

/** The variable that names the test hooks to install. */
export const TEST_HOOKS_VAR = "ACP_TUI_TEST_HOOKS";

export type TestHook = "crash" | "no-host-clipboard" | "no-native-clipboard" | "short-change-timeout";
const TEST_HOOK_NAMES: readonly TestHook[] = ["crash", "no-host-clipboard", "no-native-clipboard", "short-change-timeout"];

/** The hooks `ACP_TUI_TEST_HOOKS` names; unknown names are ignored. */
export function testHooks(env: Readonly<Record<string, string | undefined>> = process.env): ReadonlySet<TestHook> {
  const names = (env[TEST_HOOKS_VAR] ?? "").split(",").map((n) => n.trim());
  return new Set(TEST_HOOK_NAMES.filter((hook) => names.includes(hook)));
}

export const CRASH_HOOK_MESSAGE = "crash test hook: F12 pressed";

/** Binds F12 to an uncaught error; returns a remover. */
export function installCrashHook(renderer: CliRenderer): () => void {
  const onKey = (key: KeyEvent): void => {
    if (key.name !== "f12") return;
    setTimeout(() => {
      throw new Error(CRASH_HOOK_MESSAGE);
    }, 0);
  };
  renderer.keyInput.on("keypress", onKey);
  return () => void renderer.keyInput.off("keypress", onKey);
}
