// mvp-configuration task 1.3: the loader (design D1 and D3; spec tui-config
// "Validation errors name the place and the fix" and "Invalid settings keep the
// last good value"). JSONC with positions, zod issues at their line and column,
// unknown names as warnings with a suggestion, and per-section fallback to the
// last good value.
import { describe, expect, test } from "bun:test";
import { effectiveConfig, nextLastGood, type Sections } from "../../src/config/effective.ts";
import { parseConfigText } from "../../src/config/load.ts";
import { editDistance, formatProblem, problemNotice, problemSummary, suggest } from "../../src/config/problems.ts";
import { defaultConfig } from "../../src/config/schema.ts";
import { createConfigStore } from "../../src/config/store.ts";
import type { FileRead } from "../../src/config/sources.ts";
import { effectiveTerminal } from "../../src/renderer/capabilities.ts";

const FILE = "/home/u/.config/acp-tui/config.jsonc";

/** A store over one in-memory user file, edited by `set`. */
function memoryStore(initial: string | null) {
  let text = initial;
  const env = { XDG_CONFIG_HOME: "/home/u/.config", HOME: "/home/u" };
  const read = (path: string): FileRead => ({ text: path === FILE ? text : null, unsafe: null, error: null });
  const store = createConfigStore({ env, sessionDirectory: null, read });
  return { store, set: (next: string | null) => (text = next) };
}

describe("Validation errors name the place and the fix", () => {
  test("Wrong value: line 4 reads \"mouse\": \"sometimes\", so the problem is the file, 4:12, mouse, the value and the allowed values", () => {
    const text = ["{", "  // keyboard and wheel", '  "density": "focus",', '  "mouse": "sometimes",', "}"].join("\n");
    const parsed = parseConfigText(text, FILE);
    expect(parsed.problems).toHaveLength(1);
    const [problem] = parsed.problems;
    expect(problem).toMatchObject({ file: FILE, line: 4, column: 12, path: "mouse", severity: "error" });
    expect(problem!.message).toBe('takes "full", "wheel" or "off", not "sometimes"');
    expect(formatProblem(problem!)).toBe(`${FILE}:4:12: mouse takes "full", "wheel" or "off", not "sometimes"`);
    // The rest of the file applies.
    expect(parsed.sections).toEqual({ density: "focus" });
    expect(parsed.rejected).toEqual(["mouse"]);
  });

  test("Misspelt name: wheel_line is unknown, wheel_lines is suggested, and the wheel table stays in use", () => {
    const parsed = parseConfigText(`{ "wheel_line": 2 }`, FILE);
    expect(parsed.problems).toEqual([
      { file: FILE, line: 1, column: 3, path: "wheel_line", severity: "warning", message: "is not a known setting and is ignored", suggestion: "wheel_lines" },
    ]);
    expect(formatProblem(parsed.problems[0]!)).toContain("(did you mean wheel_lines?)");
    const config = effectiveConfig({ user: nextLastGood({}, parsed), project: {} });
    expect(config.wheel_lines).toBeNull();
  });

  test("unknown names are found inside sections too, with a suggestion", () => {
    const parsed = parseConfigText(`{ "attention": { "signl": "osc9" }, "terminals": { "jetbrain": { "wheel_lines": 5 } } }`, FILE);
    expect(parsed.problems.map((p) => [p.path, p.severity, p.suggestion])).toEqual([
      ["attention.signl", "warning", "signal"],
      ["terminals.jetbrain", "warning", "jetbrains"],
    ]);
    // Ignored, so the sections are valid and keep their defaults.
    expect(effectiveConfig({ user: nextLastGood({}, parsed), project: {} }).attention.signal).toBe("bell");
  });

  test("Setting for Windows Terminal: a windows-terminal entry is accepted with no problem and sets that terminal's wheel step", () => {
    const parsed = parseConfigText(`{ "terminals": { "windows-terminal": { "wheel_lines": 5 } } }`, FILE);
    expect(parsed.problems).toEqual([]);
    const config = effectiveConfig({ user: nextLastGood({}, parsed), project: {} });
    expect(config.terminals).toEqual({ "windows-terminal": { wheel_lines: 5 } });
    expect(effectiveTerminal({ WT_SESSION: "x" }, config.terminals).wheelLines).toBe(5);
  });

  test("Syntax error: a missing comma between lines 3 and 4 names the file and line 4 and says a comma was expected", () => {
    const text = ["{", '  "density": "focus",', '  "theme": "mine"', '  "mouse": "off"', "}"].join("\n");
    const parsed = parseConfigText(text, FILE);
    expect(parsed.status).toBe("syntax");
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toMatchObject({ file: FILE, line: 4, path: "", severity: "error" });
    expect(parsed.problems[0]!.message).toContain("a comma was expected");
    expect(parsed.sections).toEqual({});
  });

  test("comments and trailing commas are JSONC; an empty file sets nothing", () => {
    expect(parseConfigText(`{ /* a */ "density": "verbose", // b\n }`, FILE).sections).toEqual({ density: "verbose" });
    expect(parseConfigText("", FILE)).toMatchObject({ status: "ok", problems: [] });
    expect(parseConfigText("// nothing yet\n", FILE)).toMatchObject({ status: "ok", problems: [] });
  });

  test("a misspelt value of an enumeration gets the closest allowed value", () => {
    const [problem] = parseConfigText(`{ "glyphs": "asci" }`, FILE).problems;
    expect(problem).toMatchObject({ path: "glyphs", suggestion: '"ascii"' });
  });

  test("suggestions only for close names", () => {
    expect(editDistance("wheel_line", "wheel_lines")).toBe(1);
    expect(suggest("mose", ["mouse", "density"])).toBe("mouse");
    expect(suggest("zzzz", ["mouse", "density"])).toBeUndefined();
  });
});

describe("Invalid settings keep the last good value", () => {
  test("One bad section: theme.flat \"yes\" and density focus start in focus with the default theme and one problem for theme.flat", () => {
    const { store } = memoryStore(`{ "theme": { "flat": "yes" }, "density": "focus" }`);
    expect(store.config().density).toBe("focus");
    expect(store.config().theme).toEqual(defaultConfig().theme);
    expect(store.problems()).toHaveLength(1);
    expect(store.problems()[0]).toMatchObject({ path: "theme.flat", severity: "error", line: 1, column: 22 });
    expect(store.problems()[0]!.message).toBe('takes true or false, not "yes"');
  });

  test("Broken file at start-up: every default, and a problem to show", () => {
    const { store } = memoryStore(`{ "density": "focus" "mouse": "off" }`);
    expect(store.config()).toEqual(defaultConfig());
    expect(store.problems()).toHaveLength(1);
    expect(problemSummary(store.problems())).toStartWith("configuration: config.jsonc:1:22:");
  });

  test("the load notice ends, when cut, with how many problems there are and where to read them in full (IDE check 12.5)", () => {
    const problem = { file: "/x/config.jsonc", line: 4, column: 38, path: "keys.global.ctrl+f", severity: "warning" as const, message: "PhpStorm keeps ctrl+f" };
    expect(problemNotice([], "? configuration")).toBeNull();
    expect(problemNotice([problem], "? configuration")).toEqual({
      text: "configuration: config.jsonc:4:38: keys.global.ctrl+f PhpStorm keeps ctrl+f",
      more: "(see ? configuration)",
      short: "config.jsonc:4:38: keys.global.ctrl+f PhpStorm keeps ctrl+f",
    });
    expect(problemNotice([problem, problem], "f12")?.more).toBe("(2 problems, see f12)");
  });

  test("a section that becomes invalid on a reload keeps its last good value; the valid ones apply", () => {
    const { store, set } = memoryStore(`{ "theme": { "flat": true }, "density": "verbose" }`);
    expect(store.config().theme.flat).toBe(true);
    set(`{ "theme": { "flat": "yes" }, "density": "focus" }`);
    const result = store.reload();
    expect(store.config().theme.flat).toBe(true);
    expect(store.config().density).toBe("focus");
    expect(result.changed).toEqual(["density"]);
    expect(result.problems.map((p) => p.path)).toEqual(["theme.flat"]);
  });

  test("a file that stops parsing keeps every last good section until it parses again", () => {
    const { store, set } = memoryStore(`{ "density": "verbose", "mouse": "wheel" }`);
    set(`{ "density": "focus" `);
    store.reload();
    expect(store.config().density).toBe("verbose");
    expect(store.config().mouse).toBe("wheel");
    expect(store.problems()).toHaveLength(1);
    set(`{ "density": "focus" }`);
    const result = store.reload();
    expect(store.config().density).toBe("focus");
    // The section the fixed file no longer sets returns to its default.
    expect(store.config().mouse).toBe("full");
    expect(result.problems).toEqual([]);
  });

  test("a deleted file contributes nothing", () => {
    const { store, set } = memoryStore(`{ "density": "verbose" }`);
    set(null);
    store.reload();
    expect(store.config()).toEqual(defaultConfig());
  });

  test("a reload that changes nothing keeps the configuration object, and unchanged sections keep theirs", () => {
    const { store, set } = memoryStore(`{ "density": "verbose", "theme": { "flat": true } }`);
    const before = store.config();
    expect(store.reload().changed).toEqual([]);
    expect(store.config()).toBe(before);
    set(`{ "density": "focus", "theme": { "flat": true } }`);
    store.reload();
    expect(store.config()).not.toBe(before);
    expect(store.config().theme).toBe(before.theme);
  });
});
