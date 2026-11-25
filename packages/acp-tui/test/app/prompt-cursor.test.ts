// day-two-feedback task 7 (spec tui-layout "Prompt box cursor" and "The focused window can be told
// apart"): the cursor's shape for a setting and a place, its DECSCUSR, and the focus follower.
import { describe, expect, test } from "bun:test";
import { CURSOR_SHAPE_DEFAULT, contrastRatio, createCursorFocus, cursorAtEnd, cursorColourFrom, cursorShapeSequence, promptCursorStyle } from "../../src/app/prompt-cursor.ts";
import { contrastRatio as checkerContrast, expectedCursorColour } from "../pty/cursor-colour.ts";
import { FINAL_RESET } from "../../src/renderer/lifecycle.ts";

describe("cursorAtEnd", () => {
  test("the textarea's offset against the text's end, in display columns with a newline as one", () => {
    expect(cursorAtEnd("", 0)).toBe(true);
    expect(cursorAtEnd("hello", 5)).toBe(true);
    expect(cursorAtEnd("hello", 4)).toBe(false);
    expect(cursorAtEnd("ab\ncd", 5)).toBe(true);
    expect(cursorAtEnd("ab\ncd", 3)).toBe(false);
    // Wide characters count two columns; a trailing newline leaves the end on the empty last line.
    expect(cursorAtEnd("日本語", 6)).toBe(true);
    expect(cursorAtEnd("日本語", 4)).toBe(false);
    expect(cursorAtEnd("ab\n", 3)).toBe(true);
    expect(cursorAtEnd("ab\n", 2)).toBe(false);
  });
});

describe("promptCursorStyle", () => {
  test("bar everywhere, block everywhere, and block_at_end: a block only after the end", () => {
    expect(promptCursorStyle("bar", true)).toEqual({ style: "line", blinking: true });
    expect(promptCursorStyle("bar", false)).toEqual({ style: "line", blinking: true });
    expect(promptCursorStyle("block", true)).toEqual({ style: "block", blinking: true });
    expect(promptCursorStyle("block", false)).toEqual({ style: "block", blinking: true });
    expect(promptCursorStyle("block_at_end", true)).toEqual({ style: "block", blinking: true });
    expect(promptCursorStyle("block_at_end", false)).toEqual({ style: "line", blinking: true });
  });

  test("the block is OpenTUI's own default cursor, the block acp-tui drew before the setting", () => {
    expect(promptCursorStyle("block", true)).toEqual({ style: "block", blinking: true });
  });
});

describe("cursorShapeSequence", () => {
  test("DECSCUSR: 1 and 2 a block, 5 and 6 a bar, blinking first", () => {
    expect(cursorShapeSequence({ style: "block", blinking: true })).toBe("\x1b[1 q");
    expect(cursorShapeSequence({ style: "block", blinking: false })).toBe("\x1b[2 q");
    expect(cursorShapeSequence({ style: "line", blinking: true })).toBe("\x1b[5 q");
    expect(cursorShapeSequence({ style: "line", blinking: false })).toBe("\x1b[6 q");
  });

  test("the default shape is the final reset's", () => {
    expect(CURSOR_SHAPE_DEFAULT).toBe("\x1b[0 q");
    expect(FINAL_RESET).toContain(CURSOR_SHAPE_DEFAULT);
  });
});

describe("createCursorFocus", () => {
  function setup(promptFocused = true) {
    const written: string[] = [];
    const state = { promptFocused, shape: "\x1b[5 q" };
    const focus = createCursorFocus({ write: (d) => written.push(d), shape: () => state.shape, promptFocused: () => state.promptFocused });
    return { focus, written, state };
  }

  test("Focus lost: the default shape on blur, the prompt box's shape again on focus", () => {
    const { focus, written } = setup();
    focus.blur();
    focus.focus();
    expect(written).toEqual(["\x1b[0 q", "\x1b[5 q"]);
  });

  test("the shape is read when focus returns, so a change while away is kept", () => {
    const { focus, written, state } = setup();
    focus.blur();
    state.shape = "\x1b[1 q";
    focus.focus();
    expect(written).toEqual(["\x1b[0 q", "\x1b[1 q"]);
  });

  test("a terminal that never reports focus gets nothing, and focus in without a loss before it writes nothing", () => {
    const { focus, written } = setup();
    focus.focus();
    focus.promptFocusChanged();
    expect(written).toEqual([]);
  });

  test("a second blur writes the default again, and one focus restores once", () => {
    const { focus, written } = setup();
    focus.blur();
    focus.blur();
    focus.focus();
    focus.focus();
    expect(written).toEqual(["\x1b[0 q", "\x1b[0 q", "\x1b[5 q"]);
  });

  test("focus returning while the prompt box has none waits until it has", () => {
    const { focus, written, state } = setup(false);
    focus.blur();
    focus.focus();
    expect(written).toEqual(["\x1b[0 q"]);
    focus.promptFocusChanged();
    expect(written).toEqual(["\x1b[0 q"]);
    state.promptFocused = true;
    focus.promptFocusChanged();
    expect(written).toEqual(["\x1b[0 q", "\x1b[5 q"]);
    focus.promptFocusChanged();
    expect(written).toHaveLength(2);
  });

  test("a new blur cancels a waiting restore", () => {
    const { focus, written, state } = setup(false);
    focus.blur();
    focus.focus();
    focus.blur();
    state.promptFocused = true;
    focus.promptFocusChanged();
    expect(written).toEqual(["\x1b[0 q", "\x1b[0 q"]);
  });
});

describe("cursorColourFrom (prompt-box-feedback task 2.2, design D3)", () => {
  test("foot's black on Tokyo Night gives the foreground", () => {
    expect(cursorColourFrom({ foreground: "#c0caf5", background: "#1a1b26", cursor: "#000000" })).toBe("#c0caf5");
  });

  test("black on a light background is kept", () => {
    expect(cursorColourFrom({ foreground: "#212121", background: "#fafafa", cursor: "#000000" })).toBe("#000000");
  });

  test("Omarchy's configured cursor is kept", () => {
    expect(cursorColourFrom({ foreground: "#a9b1d6", background: "#1a1b26", cursor: "#c0caf5" })).toBe("#c0caf5");
  });

  test("a foreground that also fails gives the terminal's own colour", () => {
    expect(cursorColourFrom({ foreground: "#1b1c27", background: "#1a1b26", cursor: "#000000" })).toBe("terminal");
  });

  test("no cursor reply: the foreground when it can be seen; no background: nothing is compared", () => {
    expect(cursorColourFrom({ foreground: "#d4d4d4", background: "#1e1e1e" })).toBe("#d4d4d4");
    expect(cursorColourFrom({ foreground: "#d4d4d4", background: "#1e1e1e", cursor: null })).toBe("#d4d4d4");
    expect(cursorColourFrom({ foreground: "#d4d4d4", cursor: "#123456" })).toBe("#123456");
    expect(cursorColourFrom({ foreground: "#d4d4d4" })).toBe("#d4d4d4");
  });

  test("nothing reported gives the terminal's own colour", () => {
    expect(cursorColourFrom({})).toBe("terminal");
    expect(cursorColourFrom({ cursor: "not a colour" })).toBe("terminal");
  });

  test("2:1 passes, a hair under does not", () => {
    // Grey on white: the lightest grey that still reaches 2:1, and the next lighter one, which does not.
    const greys = Array.from({ length: 256 }, (_, i) => `#${i.toString(16).padStart(2, "0").repeat(3)}`);
    const pass = greys.filter((c) => contrastRatio(c, "#ffffff") >= 2).at(-1)!;
    const fail = greys[greys.indexOf(pass) + 1]!;
    expect(contrastRatio(fail, "#ffffff")).toBeLessThan(2);
    expect(cursorColourFrom({ cursor: pass, background: "#ffffff", foreground: "#000000" })).toBe(pass);
    expect(cursorColourFrom({ cursor: fail, background: "#ffffff", foreground: "#000000" })).toBe("#000000");
  });

  test("Zed's light theme cursor is kept (2.84:1), foot's unset black on a dark background is not", () => {
    expect(cursorColourFrom({ foreground: "#5c6166", background: "#fcfcfc", cursor: "#3b9ee5" })).toBe("#3b9ee5");
    expect(cursorColourFrom({ foreground: "#c0caf5", background: "#1a1b26", cursor: "#000000" })).toBe("#c0caf5");
  });

  test("agrees with the PTY checker's own copy of the rule over a grid of replies", () => {
    const colours = ["#000000", "#ffffff", "#212121", "#fafafa", "#1a1b26", "#c0caf5", "#808080", "#ff5555", "#1b1c27"];
    for (const foreground of colours) {
      for (const background of colours) {
        for (const cursor of [...colours, undefined]) {
          expect(cursorColourFrom({ foreground, background, cursor })).toBe(expectedCursorColour({ foreground, background, ...(cursor ? { cursor } : {}) }));
        }
        expect(contrastRatio(foreground, background)).toBeCloseTo(checkerContrast(foreground, background), 10);
      }
    }
    expect(cursorColourFrom({ foreground: "#c0caf5", cursor: "#123456" })).toBe(expectedCursorColour({ foreground: "#c0caf5", cursor: "#123456" }));
    expect(cursorColourFrom({ foreground: "#c0caf5" })).toBe(expectedCursorColour({ foreground: "#c0caf5" }));
    expect(cursorColourFrom({})).toBe(expectedCursorColour({}));
  });
});
