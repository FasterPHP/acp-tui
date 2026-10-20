// mvp-configuration task 9.4 (design D14; spec tui-config "Spike switch retired"): the crash test
// hook is read from ACP_TUI_TEST_HOOKS only, and nothing a user sees names it: not --help, not
// the configuration's schema, not the palette's commands. The PTY scenarios (the hook set, and
// "Crash hook unreachable" without it) are in exit.pty.test.ts.
import { describe, expect, test } from "bun:test";
import { HELP_TEXT } from "../../src/cli.ts";
import { configJsonSchemaText } from "../../src/config/json-schema.ts";
import { COMMAND_TITLES, KEY_ACTIONS, KEY_CONTEXTS } from "../../src/keys/keymap.ts";
import { TEST_HOOKS_VAR, testHooks } from "../../src/renderer/test-hooks.ts";

describe("the crash test hook (task 9.4)", () => {
  test("read from ACP_TUI_TEST_HOOKS, a comma list; nothing else turns it on", () => {
    expect(TEST_HOOKS_VAR).toBe("ACP_TUI_TEST_HOOKS");
    expect([...testHooks({ ACP_TUI_TEST_HOOKS: "crash" })]).toEqual(["crash"]);
    expect([...testHooks({ ACP_TUI_TEST_HOOKS: "other, crash" })]).toEqual(["crash"]);
    expect([...testHooks({})]).toEqual([]);
    expect([...testHooks({ ACP_TUI_TEST_HOOKS: "" })]).toEqual([]);
    expect([...testHooks({ ACP_TUI_SPIKES: "crash" })]).toEqual([]);
  });

  test("absent from --help, the configuration's JSON Schema and the palette's commands", () => {
    for (const text of [HELP_TEXT, configJsonSchemaText()]) {
      expect(text).not.toContain(TEST_HOOKS_VAR);
      expect(text).not.toMatch(/crash/i);
      expect(text).not.toMatch(/spike/i);
    }
    for (const context of KEY_CONTEXTS) {
      for (const action of KEY_ACTIONS[context]) {
        expect(action).not.toMatch(/crash/i);
        expect((COMMAND_TITLES[context] as Record<string, string>)[action]).not.toMatch(/crash/i);
      }
    }
  });
});
