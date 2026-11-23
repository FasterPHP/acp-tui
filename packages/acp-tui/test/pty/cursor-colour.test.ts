// Unit tests for the cursor colour checker and the recorded foot fixture.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, cursorColourProblems, expectedCursorColour, parseEscapedFixture, readFixture, type TerminalReplies } from "./cursor-colour.ts";

const FOOT_LIGHT: TerminalReplies = { foreground: "#212121", background: "#fafafa", cursor: "#000000" };
const FIXTURE = "foot-light-cursor.txt";

const BEL = "\x07";
const set = (c: string) => `\x1b]12;${c}${BEL}`;
const QUERY = "\x1b]10;?\x07\x1b]11;?\x07\x1b]12;?\x07";
const TEARDOWN = "\x1b[?1049l";

describe("recorded foot fixture", () => {
  const raw = readFileSync(join(import.meta.dir, "../fixtures", FIXTURE), "utf8");

  test("every line is a header comment, one escape sequence or a <n> placeholder", () => {
    const escape = /^(?:\\x1b(?:\\\\|\[[0-?]*[ -/]*[@-~]|\][ -~]*?(?:\\x07|\\x1b\\\\)|P\+q[0-9a-f]+\\x1b\\\\|[78=>])|\\x1b[ -~]|)$/;
    for (const [i, line] of raw.split("\n").entries()) {
      if (line === "" && i === raw.split("\n").length - 1) continue;
      if (line.startsWith("# ")) continue;
      if (/^<\d+>$/.test(line)) continue;
      expect(line).toMatch(/^\\x1b/);
      // One sequence only: after the first ESC-introduced sequence nothing but its own terminator.
      expect(line.split("\\x1b").length - 1).toBeLessThanOrEqual(2);
      expect(line.replace(/<\d+>/g, "")).toMatch(escape);
      // Printable text may appear only inside a sequence's own syntax, never as a run of its own.
      expect(line.startsWith("\\x1b")).toBe(true);
    }
  });

  test("the only OSC payload that is not kept is the window title", () => {
    const placeholders = raw.split("\n").filter((l) => /<\d+>/.test(l) && !/^<\d+>$/.test(l));
    expect(placeholders).toEqual(["\\x1b]0;<9>\\x07"]);
  });

  test("the recorded sequences give exactly the three problems of the recorded failure", () => {
    const problems = cursorColourProblems(readFixture(FIXTURE), FOOT_LIGHT);
    expect(problems.map((p) => p.kind).sort()).toEqual(["before-replies", "non-colour", "wrong-colour"]);
    expect(problems.find((p) => p.kind === "before-replies")!.detail).toContain("#ffffff");
    expect(problems.find((p) => p.kind === "wrong-colour")!.detail).toContain("#000000 was expected");
    expect(problems.find((p) => p.kind === "non-colour")!.detail).toContain("default");
  });
});

describe("cursorColourProblems", () => {
  test("a stream that asks, then writes the reported colour, and resets at exit has no problems", () => {
    const out = `${QUERY}\x1b[?25h${set("#000000")}frame${TEARDOWN}${set("default")}\x1b]112${BEL}`;
    expect(cursorColourProblems(out, FOOT_LIGHT, { allowTeardownDefault: true })).toEqual([]);
  });

  test("the default teardown write counts unless it is allowed", () => {
    const out = `${QUERY}${set("#000000")}${TEARDOWN}${set("default")}\x1b]112${BEL}`;
    expect(cursorColourProblems(out, FOOT_LIGHT).map((p) => p.kind)).toEqual(["non-colour"]);
  });

  test("a terminal-own cursor needs no OSC 12 at all, and OSC 112 after any set", () => {
    const none = { foreground: "#101010", background: "#101010" };
    expect(cursorColourProblems(`${QUERY}frame${TEARDOWN}\x1b]112${BEL}`, none)).toEqual([]);
    const bad = cursorColourProblems(`${QUERY}${set("#ffffff")}frame`, none);
    expect(bad.map((p) => p.kind).sort()).toEqual(["no-reset", "wrong-colour"]);
  });

  test("a reported foreground is used when the cursor reply is invisible on the background", () => {
    const tokyo = { foreground: "#c0caf5", background: "#1a1b26", cursor: "#000000" };
    expect(cursorColourProblems(`${QUERY}${set("#c0caf5")}${TEARDOWN}\x1b]112${BEL}`, tokyo)).toEqual([]);
    expect(cursorColourProblems(`${QUERY}${set("#000000")}${TEARDOWN}\x1b]112${BEL}`, tokyo).map((p) => p.kind)).toEqual(["wrong-colour"]);
  });

  test("a cursor colour written after a changed reply replaces the earlier one", () => {
    const out = `${QUERY}${set("#000000")}${QUERY}${set("#c0caf5")}${TEARDOWN}\x1b]112${BEL}`;
    expect(cursorColourProblems(out, { foreground: "#c0caf5", background: "#1a1b26", cursor: "#c0caf5" })).toEqual([]);
  });

  test("ST-terminated sets are read", () => {
    const out = `${QUERY}\x1b]12;#000000\x1b\\${TEARDOWN}\x1b]112\x1b\\`;
    expect(cursorColourProblems(out, FOOT_LIGHT)).toEqual([]);
  });
});

describe("helpers", () => {
  test("contrast ratio and the expected colour", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#fafafa")).toBeGreaterThan(19);
    expect(expectedCursorColour({ foreground: "#c0caf5", background: "#1a1b26", cursor: "#000000" })).toBe("#c0caf5");
    expect(expectedCursorColour({ foreground: "#d4d4d4", background: "#1e1e1e" })).toBe("#d4d4d4");
    expect(expectedCursorColour({})).toBe("terminal");
  });

  test("the fixture parser unescapes and expands placeholders", () => {
    expect(parseEscapedFixture("# c\n\\x1b]12;#fff\\x07\n<3>\n\\x1b\\\\\n")).toBe("\x1b]12;#fff\x07xxx\x1b\\");
  });
});
