// Unit tests for the renderer's environment overrides (src/renderer/terminal-env.ts, S1 bugs 1
// to 3 of phase-1a). The PTY counterparts are in test/renderer/jediterm.pty.test.ts.
import { describe, expect, test } from "bun:test";
import { rendererEnvironment } from "../../src/renderer/create.ts";
import { knownTruecolour, rendererEnv } from "../../src/renderer/terminal-env.ts";

describe("rendererEnv", () => {
  test("always skips the width probes and the graphics query", () => {
    expect(rendererEnv({})).toEqual({ OPENTUI_FORCE_EXPLICIT_WIDTH: "false", OPENTUI_GRAPHICS: "false" });
    expect(rendererEnv({ OPENTUI_GRAPHICS: "true", OPENTUI_FORCE_EXPLICIT_WIDTH: "1" })).toMatchObject({
      OPENTUI_FORCE_EXPLICIT_WIDTH: "false",
      OPENTUI_GRAPHICS: "false",
    });
  });

  test("adds COLORTERM=truecolor for JediTerm and Zed when COLORTERM does not already say so", () => {
    expect(rendererEnv({ TERMINAL_EMULATOR: "JetBrains-JediTerm" }).COLORTERM).toBe("truecolor");
    expect(rendererEnv({ TERM_PROGRAM: "zed" }).COLORTERM).toBe("truecolor");
    expect(rendererEnv({ TERMINAL_EMULATOR: "JetBrains-JediTerm", COLORTERM: "24bit" }).COLORTERM).toBeUndefined();
    expect(rendererEnv({ COLORTERM: "truecolor" }).COLORTERM).toBeUndefined();
    expect(rendererEnv({ TERM: "xterm-256color" }).COLORTERM).toBeUndefined();
  });

  test("knownTruecolour", () => {
    expect(knownTruecolour({ COLORTERM: "24bit" })).toBe(true);
    expect(knownTruecolour({ TERMINAL_EMULATOR: "JetBrains-JediTerm" })).toBe(true);
    expect(knownTruecolour({ TERM_PROGRAM: "zed" })).toBe(true);
    expect(knownTruecolour({ TERM_PROGRAM: "vscode", TERM: "xterm-256color" })).toBe(false);
  });
});

describe("rendererEnvironment (opentui-0-6 design D4)", () => {
  test("the overrides plus FORCE_HYPERLINK from the table's osc8, and process.env untouched", () => {
    const before = { ...process.env };
    expect(rendererEnvironment({ TERMINAL_EMULATOR: "JetBrains-JediTerm" }, false)).toEqual({
      OPENTUI_FORCE_EXPLICIT_WIDTH: "false",
      OPENTUI_GRAPHICS: "false",
      COLORTERM: "truecolor",
      FORCE_HYPERLINK: "0",
    });
    expect(rendererEnvironment({ TERM_PROGRAM: "zed", COLORTERM: "truecolor" }, true)).toEqual({
      OPENTUI_FORCE_EXPLICIT_WIDTH: "false",
      OPENTUI_GRAPHICS: "false",
      FORCE_HYPERLINK: "1",
    });
    expect(process.env).toEqual(before);
  });
});
