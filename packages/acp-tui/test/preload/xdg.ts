// Test preload (mvp-sessions): every `bun test` run gets its own temporary
// XDG_CONFIG_HOME and XDG_STATE_HOME, so no test, and no acp-tui process a
// test starts (PTY children inherit `process.env`), reads the user's own
// `~/.config/acp-tui/config.jsonc` or writes their `~/.local/state/acp-tui`
// session index. Tests that need a configuration or an index set their own
// directories on top of these.
//
// parallel-tests (design D6): under `--parallel` (which implies `--isolate`) the preload runs once
// per test file, so each file would leave its directory behind: an `afterAll` registered here
// removes it when the file's tests are done (in a serial run, once at the end, as the directory is
// shared). The PTY children have exited by then; each test disposes its session.
import { afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-test-xdg-"));
process.env.XDG_CONFIG_HOME = join(base, "config");
process.env.XDG_STATE_HOME = join(base, "state");
mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true });
// No real clipboard from a test or a process it starts (renderer/test-hooks.ts `no-host-clipboard`):
// on macOS and Windows the host clipboard exists whatever the environment says.
process.env.ACP_TUI_TEST_HOOKS = [...(process.env.ACP_TUI_TEST_HOOKS ?? "").split(",").map((n) => n.trim()).filter(Boolean), "no-host-clipboard"].join(",");
afterAll(() => rmSync(base, { recursive: true, force: true }));
