// mvp-rendering task 2.1 (design decision 5) and mvp-configuration task 4.2 (design D12): the one
// per-terminal table (capabilities and the wheel step), its detection by TERMINAL_EMULATOR, then
// TERM_PROGRAM, then TERM, then WT_SESSION, the `terminals` setting over it, and
// ACP_TUI_CAPABILITIES on top.
import { describe, expect, test } from "bun:test";
import {
  capabilityOverrides,
  detectTerminal,
  effectiveTerminal,
  NO_CAPABILITIES,
  TERMINAL_IDS,
  TERMINAL_TABLE,
  terminalCapabilities,
  type TerminalCapabilities,
  type TerminalId,
  type TerminalMatch,
} from "../../src/renderer/capabilities.ts";
import { rendererEnvironment } from "../../src/renderer/create.ts";

// Emoji drawn as names (task 14.5, review C11): OpenTUI's own `bare` everywhere, and the classes
// measured in JetBrains and Zed (10 October 2026); `detectsUrls` for JetBrains only (review C9).
const NONE: TerminalCapabilities = { sgr9: false, combiningStrike: false, osc8: false, detectsUrls: false, emoji: ["bare"] };
const JETBRAINS: TerminalCapabilities = { ...NONE, detectsUrls: true, emoji: ["zwj", "flag", "keycap", "tone", "bare"] };
const SGR9: TerminalCapabilities = { ...NONE, sgr9: true };
const ZED: TerminalCapabilities = { ...NONE, sgr9: true, osc8: true, emoji: ["zwj", "keycap", "tone", "vs16", "bare"] };
// Windows Terminal (windows-support design D9), measured in 1.24 and 1.25: SGR 9 and OSC 8 drawn,
// bare URLs opened by the terminal only on Ctrl+click, flags and keycaps not drawable.
const WINDOWS_TERMINAL: TerminalCapabilities = { ...NONE, sgr9: true, osc8: true, emoji: ["flag", "keycap", "bare"] };

/** An environment naming each terminal ID, and what the table gives it. */
const TERMINALS: Record<TerminalId, { env: Record<string, string>; capabilities: TerminalCapabilities; wheelLines: number }> = {
  jetbrains: { env: { TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM: "xterm-256color" }, capabilities: JETBRAINS, wheelLines: 3 },
  zed: { env: { TERM_PROGRAM: "zed", TERM: "xterm-256color" }, capabilities: ZED, wheelLines: 1 },
  ghostty: { env: { TERM_PROGRAM: "ghostty" }, capabilities: SGR9, wheelLines: 3 },
  kitty: { env: { TERM: "xterm-kitty" }, capabilities: SGR9, wheelLines: 3 },
  wezterm: { env: { TERM_PROGRAM: "WezTerm" }, capabilities: SGR9, wheelLines: 3 },
  iterm2: { env: { TERM_PROGRAM: "iTerm.app" }, capabilities: SGR9, wheelLines: 3 },
  "windows-terminal": { env: { WT_SESSION: "5f2c3a1e-8d9b-4c6a-9e0f-7b1d2a3c4e5f", WT_PROFILE_ID: "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}" }, capabilities: WINDOWS_TERMINAL, wheelLines: 3 },
  default: { env: { TERM_PROGRAM: "vscode", TERM: "xterm-256color" }, capabilities: NONE, wheelLines: 3 },
};

describe("the per-terminal table", () => {
  for (const id of TERMINAL_IDS) {
    test(`${id}: detected from its environment, with its capabilities and wheel step`, () => {
      const { env, capabilities, wheelLines } = TERMINALS[id];
      expect(detectTerminal(env)).toBe(id);
      expect(TERMINAL_TABLE[id]).toEqual({ capabilities, wheelLines });
      expect(terminalCapabilities(env)).toEqual(capabilities);
      expect(effectiveTerminal(env)).toEqual({ id, capabilities, wheelLines, wheelSource: "table" });
    });
  }

  test("an unknown terminal and an unset environment are `default`: nothing but OpenTUI's own emoji class", () => {
    expect(terminalCapabilities({ TERM: "dumb" })).toEqual(NONE);
    expect(terminalCapabilities({})).toEqual(NONE);
    expect(terminalCapabilities({ TERM_PROGRAM: "", TERMINAL_EMULATOR: "" })).toEqual(NONE);
    expect(detectTerminal({})).toBe("default");
    expect(terminalCapabilities({})).toBe(NO_CAPABILITIES);
  });

  test("Ghostty by TERM as well as TERM_PROGRAM; values compared without case", () => {
    expect(detectTerminal({ TERM: "xterm-ghostty" })).toBe("ghostty");
    expect(detectTerminal({ TERM_PROGRAM: "wezterm" })).toBe("wezterm");
  });

  test("no built-in row has a combining strike, only Zed and Windows Terminal have verified OSC 8, and only JetBrains detects URLs", () => {
    for (const id of TERMINAL_IDS) {
      const row = TERMINAL_TABLE[id].capabilities;
      expect(row.combiningStrike, id).toBe(false);
      expect(row.osc8, id).toBe(id === "zed" || id === "windows-terminal");
      expect(row.detectsUrls, id).toBe(id === "jetbrains");
    }
  });

  test("Windows Terminal is detected by WT_SESSION (any non-empty value), only after TERMINAL_EMULATOR, TERM_PROGRAM and TERM have had their chance", () => {
    // Scenario "Detected": WT_SESSION and neither TERMINAL_EMULATOR nor TERM_PROGRAM.
    expect(detectTerminal({ WT_SESSION: "5f2c3a1e-8d9b-4c6a-9e0f-7b1d2a3c4e5f" })).toBe("windows-terminal");
    expect(effectiveTerminal({ WT_SESSION: "x" }).wheelLines).toBe(3);
    expect(detectTerminal({ WT_SESSION: "" })).toBe("default");
    // Scenario "IntelliJ started from Windows Terminal": the IDE inherits WT_SESSION.
    expect(detectTerminal({ TERMINAL_EMULATOR: "JetBrains-JediTerm", WT_SESSION: "x" })).toBe("jetbrains");
    expect(terminalCapabilities({ TERMINAL_EMULATOR: "JetBrains-JediTerm", WT_SESSION: "x" })).toEqual(JETBRAINS);
    expect(detectTerminal({ TERM_PROGRAM: "zed", WT_SESSION: "x" })).toBe("zed");
    expect(detectTerminal({ TERM: "xterm-kitty", WT_SESSION: "x" })).toBe("kitty");
    // A TERM nobody names (WSL under Windows Terminal) does not hide it.
    expect(detectTerminal({ TERM: "xterm-256color", WT_SESSION: "x" })).toBe("windows-terminal");
  });

  test("JediTerm wins when TERMINAL_EMULATOR and TERM_PROGRAM disagree (a Zed shell started from PhpStorm)", () => {
    expect(terminalCapabilities({ TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM_PROGRAM: "zed" })).toEqual(JETBRAINS);
  });

  test("TERMINAL_EMULATOR is tried before TERM_PROGRAM, and TERM_PROGRAM before TERM", () => {
    const matches: TerminalMatch[] = [
      { id: "kitty", key: "TERM", value: "x" },
      { id: "wezterm", key: "TERM_PROGRAM", value: "p" },
      { id: "jetbrains", key: "TERMINAL_EMULATOR", value: "e" },
    ];
    expect(detectTerminal({ TERM: "x", TERM_PROGRAM: "p", TERMINAL_EMULATOR: "e" }, matches)).toBe("jetbrains");
    expect(detectTerminal({ TERM: "x", TERM_PROGRAM: "p" }, matches)).toBe("wezterm");
    expect(detectTerminal({ TERM: "x" }, matches)).toBe("kitty");
    // A variable with no matching entry falls through to the next one.
    expect(detectTerminal({ TERMINAL_EMULATOR: "other", TERM: "x" }, matches)).toBe("kitty");
  });

  test("the table is plain data: a replacement table changes the answer and leaves the defaults alone", () => {
    const custom = { ...TERMINAL_TABLE, jetbrains: { wheelLines: 7, capabilities: { sgr9: true, combiningStrike: true, osc8: true, detectsUrls: false, emoji: [] } } };
    expect(effectiveTerminal({ TERMINAL_EMULATOR: "JetBrains-JediTerm" }, {}, custom).capabilities).toEqual({ sgr9: true, combiningStrike: true, osc8: true, detectsUrls: false, emoji: [] });
    expect(terminalCapabilities({ TERMINAL_EMULATOR: "JetBrains-JediTerm" })).toEqual(JETBRAINS);
    expect(Object.isFrozen(NO_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(TERMINAL_TABLE)).toBe(true);
  });
});

describe("the terminals setting over the table (mvp-configuration task 4.2)", () => {
  test("each terminal's entry replaces only the values it sets: wheel_lines, strikethrough, hyperlinks", () => {
    for (const id of TERMINAL_IDS) {
      const { env, capabilities, wheelLines } = TERMINALS[id];
      const wheel = effectiveTerminal(env, { [id]: { wheel_lines: 5 } });
      expect(wheel).toEqual({ id, capabilities, wheelLines: 5, wheelSource: "terminals" });
      expect(effectiveTerminal(env, { [id]: { hyperlinks: !capabilities.osc8 } }).capabilities).toEqual({ ...capabilities, osc8: !capabilities.osc8 });
      // Another terminal's entry changes nothing here.
      const other: TerminalId = id === "zed" ? "kitty" : "zed";
      expect(effectiveTerminal(env, { [other]: { wheel_lines: 9, hyperlinks: true, strikethrough: "overlay" } })).toEqual({ id, capabilities, wheelLines, wheelSource: "table" });
    }
  });

  test("Setting for Windows Terminal: the terminals entry replaces the wheel step", () => {
    const env = TERMINALS["windows-terminal"].env;
    expect(effectiveTerminal(env, { "windows-terminal": { wheel_lines: 5 } })).toEqual({ id: "windows-terminal", capabilities: WINDOWS_TERMINAL, wheelLines: 5, wheelSource: "terminals" });
    // An entry for another terminal changes nothing there.
    expect(effectiveTerminal(env, { jetbrains: { wheel_lines: 5 } }).wheelLines).toBe(3);
  });

  test("strikethrough: sgr9 sets SGR 9, overlay U+0336, colour neither", () => {
    const zed = TERMINALS.zed.env;
    expect(effectiveTerminal(zed, { zed: { strikethrough: "colour" } }).capabilities).toEqual({ ...ZED, sgr9: false, combiningStrike: false });
    expect(effectiveTerminal(zed, { zed: { strikethrough: "overlay" } }).capabilities).toEqual({ ...ZED, sgr9: false, combiningStrike: true });
    const jetbrains = TERMINALS.jetbrains.env;
    expect(effectiveTerminal(jetbrains, { jetbrains: { strikethrough: "sgr9" } }).capabilities).toEqual({ ...JETBRAINS, sgr9: true });
  });

  test("Hyperlinks on for a terminal: kitty with hyperlinks true writes OSC 8", () => {
    expect(effectiveTerminal({ TERM: "xterm-kitty" }, { kitty: { hyperlinks: true } }).capabilities.osc8).toBe(true);
    expect(effectiveTerminal({ TERM: "xterm-kitty" }).capabilities.osc8).toBe(false);
  });

  test("`default` applies to a terminal the table does not name, never to a named one", () => {
    expect(effectiveTerminal({ TERM: "dumb" }, { default: { wheel_lines: 2, strikethrough: "sgr9" } })).toEqual({ id: "default", capabilities: { ...NONE, sgr9: true }, wheelLines: 2, wheelSource: "terminals" });
    expect(effectiveTerminal(TERMINALS.zed.env, { default: { wheel_lines: 2 } }).wheelLines).toBe(1);
  });

  test("rendererEnvironment carries a configured hyperlinks as FORCE_HYPERLINK, never through process.env", () => {
    const before = process.env["FORCE_HYPERLINK"];
    const kitty = { TERM: "xterm-kitty" };
    expect(rendererEnvironment(kitty, effectiveTerminal(kitty, { kitty: { hyperlinks: true } }).capabilities.osc8)["FORCE_HYPERLINK"]).toBe("1");
    expect(rendererEnvironment(kitty, effectiveTerminal(kitty).capabilities.osc8)["FORCE_HYPERLINK"]).toBe("0");
    const zed = TERMINALS.zed.env;
    expect(rendererEnvironment(zed, effectiveTerminal(zed, { zed: { hyperlinks: false } }).capabilities.osc8)["FORCE_HYPERLINK"]).toBe("0");
    expect(process.env["FORCE_HYPERLINK"]).toBe(before);
  });

  test("ACP_TUI_CAPABILITIES goes on top of the setting (Open Question 9)", () => {
    const env = { ...TERMINALS.zed.env, ACP_TUI_CAPABILITIES: "osc8" };
    expect(effectiveTerminal(env, { zed: { hyperlinks: false } }).capabilities.osc8).toBe(true);
    expect(effectiveTerminal({ ...TERMINALS.zed.env, ACP_TUI_CAPABILITIES: "sgr9" }, { zed: { strikethrough: "colour" } }).capabilities.sgr9).toBe(true);
  });
});

describe("ACP_TUI_CAPABILITIES overrides the table (mvp-rendering task 6.4)", () => {
  test("a name alone turns it on; name=false off; unknown names and values are ignored", () => {
    expect(capabilityOverrides("osc8")).toEqual({ osc8: true });
    expect(capabilityOverrides(" osc8=false , sgr9=1,combiningStrike=true")).toEqual({ osc8: false, sgr9: true, combiningStrike: true });
    expect(capabilityOverrides("hover,osc8=maybe,")).toEqual({});
    expect(capabilityOverrides(undefined)).toEqual({});
    expect(capabilityOverrides("detectsUrls,osc8=false")).toEqual({ detectsUrls: true, osc8: false });
  });

  test("the overrides go on top of the terminal's row", () => {
    expect(terminalCapabilities({ TERMINAL_EMULATOR: "JetBrains-JediTerm", ACP_TUI_CAPABILITIES: "osc8" })).toEqual({ ...JETBRAINS, osc8: true });
    expect(terminalCapabilities({ TERMINAL_EMULATOR: "JetBrains-JediTerm", ACP_TUI_CAPABILITIES: "detectsUrls=false" })).toEqual({ ...JETBRAINS, detectsUrls: false });
    expect(terminalCapabilities({ TERM_PROGRAM: "zed", ACP_TUI_CAPABILITIES: "detectsUrls" })).toEqual({ ...ZED, detectsUrls: true });
    expect(terminalCapabilities({ TERM_PROGRAM: "zed", ACP_TUI_CAPABILITIES: "sgr9=false,osc8=false" })).toEqual({ ...NONE, emoji: ZED.emoji });
    expect(terminalCapabilities({ ACP_TUI_CAPABILITIES: "osc8" })).toEqual({ ...NONE, osc8: true });
    expect(terminalCapabilities({ TERM_PROGRAM: "zed", ACP_TUI_CAPABILITIES: "" })).toEqual(ZED);
  });

  test("emoji= sets the classes drawn as names: joined by +, all, none (task 14.5)", () => {
    expect(capabilityOverrides("emoji=zwj+flag")).toEqual({ emoji: ["zwj", "flag"] });
    expect(capabilityOverrides("emoji=vs16+nonsense+keycap")).toEqual({ emoji: ["keycap", "vs16"] });
    expect(capabilityOverrides("emoji=none,osc8")).toEqual({ emoji: [], osc8: true });
    expect(capabilityOverrides("emoji=")).toEqual({ emoji: [] });
    expect(capabilityOverrides("emoji")).toEqual({ emoji: ["zwj", "flag", "keycap", "tone", "vs16", "bare"] });
    expect(capabilityOverrides("emoji=all")).toEqual({ emoji: ["zwj", "flag", "keycap", "tone", "vs16", "bare"] });
    expect(terminalCapabilities({ TERMINAL_EMULATOR: "JetBrains-JediTerm", ACP_TUI_CAPABILITIES: "emoji=none" })).toEqual({ ...JETBRAINS, emoji: [] });
    expect(terminalCapabilities({ ACP_TUI_CAPABILITIES: "emoji=vs16" })).toEqual({ ...NONE, emoji: ["vs16"] });
  });
});
