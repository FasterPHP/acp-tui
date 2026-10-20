// Tests for the sanitiser (task 2.1): one test per scenario in
// openspec/changes/phase-0-split-footer-spike/specs/model-sanitiser/spec.md, plus the extra
// cases the task lists explicitly (DEC private modes, DECSTBM, 8-bit C1 forms).

import { describe, expect, test } from "bun:test";
import { sanitise } from "../src/sanitiser.ts";

describe("sanitiser: control sequences are removed (spec scenarios)", () => {
  test("clipboard write (OSC 52)", () => {
    const input = "before\x1b]52;c;ZXZpbA==\x07after";
    expect(sanitise(input)).toBe("beforeafter");
  });

  test("hyperlink (OSC 8)", () => {
    const input = "\x1b]8;;https://evil.example\x1b\\click\x1b]8;;\x1b\\";
    expect(sanitise(input)).toBe("click");
  });

  test("window title, mode changes and scroll region", () => {
    const input =
      "a\x1b]0;window title\x07" + // OSC 0
      "b\x1b]2;window title\x07" + // OSC 2
      "c\x1b]7;file:///tmp\x07" + // OSC 7
      "d\x1b[?1000h" + // DEC private mode (mouse reporting)
      "e\x1b[3J" + // CSI 3 J
      "f\x1b[1;5r" + // DECSTBM scroll region
      "g";
    const output = sanitise(input);
    expect(output).toBe("abcdefg");
    for (const fragment of ["window title", "1000", "?1000", "3J", "1;5", "\x1b"]) {
      expect(output.includes(fragment)).toBe(false);
    }
  });

  test("SGR colour is also removed", () => {
    expect(sanitise("\x1b[31mred\x1b[0m")).toBe("red");
  });

  test("unterminated sequence: text before ESC survives, nothing after", () => {
    const input = "kept\x1b]52;c;not-terminated";
    expect(sanitise(input)).toBe("kept");
  });

  test("unterminated CSI at end of input", () => {
    expect(sanitise("kept\x1b[31")).toBe("kept");
  });

  test("line endings: CRLF becomes LF, lone CR is removed, LF and TAB survive", () => {
    expect(sanitise("a\r\nb\rc\td")).toBe("a\nbc\td");
  });
});

describe("sanitiser: 8-bit (single-byte) C1 forms", () => {
  test("8-bit CSI (U+009B) is removed like ESC [", () => {
    expect(sanitise("a\u009b31mred\u009b0m")).toBe("ared");
  });

  test("8-bit OSC (U+009D), terminated by 8-bit ST (U+009C)", () => {
    expect(sanitise("a\u009d52;c;xyz\u009cb")).toBe("ab");
  });

  test("8-bit OSC terminated by BEL", () => {
    expect(sanitise("a\u009d0;title\u0007b")).toBe("ab");
  });

  test("8-bit DCS (U+0090), APC (U+009F), PM (U+009E) and SOS (U+0098) are all removed", () => {
    expect(sanitise("a\u0090junk\u009cb\u009fjunk\u009cc\u009ejunk\u009cd\u0098junk\u009ce")).toBe("abcde");
  });

  test("a lone 8-bit ST (U+009C) with no open string is dropped", () => {
    expect(sanitise("a\u009cb")).toBe("ab");
  });

  test("other 8-bit C1 controls are dropped", () => {
    // U+0085 (NEL) and U+0084 (IND) are C1 controls with no introducer role.
    expect(sanitise("a\u0085b\u0084c")).toBe("abc");
  });

  test("7-bit and 8-bit forms of the same sequence behave identically", () => {
    const sevenBit = sanitise("x\x1b[31my");
    const eightBit = sanitise("x\u009b31my");
    expect(sevenBit).toBe(eightBit);
    expect(sevenBit).toBe("xy");
  });
});

describe("sanitiser: bare ESC and other C0/DEL", () => {
  test("a bare, unfollowed ESC is removed", () => {
    expect(sanitise("a\x1b")).toBe("a");
  });

  test("C0 controls other than LF and TAB are removed", () => {
    expect(sanitise("a\x00\x01\x07\x08b")).toBe("ab");
  });

  test("DEL is removed", () => {
    expect(sanitise("a\x7fb")).toBe("ab");
  });

  test("a single-character escape sequence (e.g. ESC c, reset) is fully consumed", () => {
    expect(sanitise("a\x1bcb")).toBe("ab");
  });

  test("an escape sequence with an intermediate byte is fully consumed", () => {
    // ESC ( B -- selects ASCII into G0, a valid ESC intermediate+final sequence
    expect(sanitise("a\x1b(Bb")).toBe("ab");
  });
});

describe("sanitiser: deceptive Unicode is removed only in approval context", () => {
  test("bidi override in a command title", () => {
    const withOverride = "rm ‮exe.dangerous‬ file.txt";
    const output = sanitise(withOverride, "approval");
    expect(output.includes("‮")).toBe(false);
    expect(output.includes("‬")).toBe(false);
  });

  test("default mode leaves bidi and zero-width characters alone", () => {
    const withZeroWidth = "safe​word";
    expect(sanitise(withZeroWidth)).toBe(withZeroWidth);
  });

  test("approval mode strips zero-width characters", () => {
    const withZeroWidth = "safe​‌‍word";
    expect(sanitise(withZeroWidth, "approval")).toBe("safeword");
  });

  test("approval mode strips the full documented set", () => {
    const chars = "‪‫‬‭‮⁦⁧⁨⁩‎‏؜⁠﻿᠎";
    expect(sanitise(`a${chars}b`, "approval")).toBe("ab");
  });
});

describe("sanitiser: purity and plain text", () => {
  test("idempotence: sanitising twice gives the same result", () => {
    const input = "before\x1b]52;c;ZXZpbA==\x07after\r\nplain ‮text";
    const once = sanitise(input);
    expect(sanitise(once)).toBe(once);
    const onceApproval = sanitise(input, "approval");
    expect(sanitise(onceApproval, "approval")).toBe(onceApproval);
  });

  test("plain text, including non-ASCII letters and emoji, passes through unchanged", () => {
    expect(sanitise("Größe: 12 ✓")).toBe("Größe: 12 ✓");
    expect(sanitise("Hello 😀 world")).toBe("Hello 😀 world");
  });

  test("is a pure function: same input and mode always give the same output", () => {
    const input = "a\x1b[31mb\x1b[0mc";
    expect(sanitise(input)).toBe(sanitise(input));
  });
});
