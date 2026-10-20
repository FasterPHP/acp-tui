// day-two-feedback task 7 (spec tui-layout "Prompt box cursor" and "The focused window can be told
// apart"): the cursor's shape for a setting and a place, its DECSCUSR, and the focus follower.
import { describe, expect, test } from "bun:test";
import { CURSOR_SHAPE_DEFAULT, createCursorFocus, cursorAtEnd, cursorShapeSequence, promptCursorStyle } from "../../src/app/prompt-cursor.ts";
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
