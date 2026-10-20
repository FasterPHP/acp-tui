// mvp-chrome-and-keys tasks 7.3 and 7.4 (spec tui-screen "Wheel with the mouse off"): the notch
// rule, the DECRQM reply and the mode 1007 state machine, without a terminal. The PTY tests are in
// terminal-signals.pty.test.ts.
import { describe, expect, test } from "bun:test";
import {
  ALTERNATE_SCROLL_OFF,
  ALTERNATE_SCROLL_ON,
  alternateScrollReply,
  createAlternateScroll,
  installNotchFilter,
  isWheelNotch,
} from "../../src/renderer/mouse-off.ts";
import type { MousePolicy } from "../../src/renderer/options.ts";

describe("isWheelNotch", () => {
  test("exactly three identical cursor-up or cursor-down sequences", () => {
    expect(isWheelNotch("\x1b[A\x1b[A\x1b[A")).toBe(true);
    expect(isWheelNotch("\x1b[B\x1b[B\x1b[B")).toBe(true);
    expect(isWheelNotch("\x1bOA\x1bOA\x1bOA")).toBe(true);
    expect(isWheelNotch("\x1bOB\x1bOB\x1bOB")).toBe(true);
  });

  test("nothing else", () => {
    expect(isWheelNotch("\x1b[A")).toBe(false);
    expect(isWheelNotch("\x1b[A\x1b[A")).toBe(false);
    expect(isWheelNotch("\x1b[A\x1b[A\x1b[A\x1b[A")).toBe(false);
    expect(isWheelNotch("\x1b[A\x1b[B\x1b[A")).toBe(false);
    expect(isWheelNotch("\x1b[A\x1bOA\x1b[A")).toBe(false);
    expect(isWheelNotch("\x1b[C\x1b[C\x1b[C")).toBe(false);
    expect(isWheelNotch("\x1b[D\x1b[D\x1b[D")).toBe(false);
    expect(isWheelNotch("\x1b[1;2A\x1b[1;2A\x1b[1;2A")).toBe(false);
    expect(isWheelNotch("x\x1b[A\x1b[A\x1b[A")).toBe(false);
    expect(isWheelNotch("\x1b[A\x1b[A\x1b[Ax")).toBe(false);
    expect(isWheelNotch("")).toBe(false);
  });
});

describe("alternateScrollReply", () => {
  test("DECRPM for mode 1007", () => {
    expect(alternateScrollReply("\x1b[?1007;1$y")).toBe(true);
    expect(alternateScrollReply("\x1b[?1007;3$y")).toBe(true);
    expect(alternateScrollReply("\x1b[?1007;2$y")).toBe(false);
    expect(alternateScrollReply("\x1b[?1007;4$y")).toBe(false);
    expect(alternateScrollReply("\x1b[?1007;0$y")).toBeNull();
  });

  test("other sequences are not replies to the query", () => {
    expect(alternateScrollReply("\x1b[?1004;1$y")).toBeUndefined();
    expect(alternateScrollReply("\x1b[?1007h")).toBeUndefined();
    expect(alternateScrollReply("\x1b[A")).toBeUndefined();
  });
});

describe("createAlternateScroll", () => {
  function fixture() {
    const written: string[] = [];
    return { written, scroll: createAlternateScroll((d) => void written.push(d)) };
  }

  test("off writes 1007 l once; leaving off writes it back set (an unanswered query counts as set)", () => {
    const f = fixture();
    f.scroll.policy("full");
    expect(f.written).toEqual([]);
    f.scroll.policy("off");
    f.scroll.policy("off");
    expect(f.written).toEqual([ALTERNATE_SCROLL_OFF]);
    f.scroll.policy("wheel");
    expect(f.written).toEqual([ALTERNATE_SCROLL_OFF, ALTERNATE_SCROLL_ON]);
    expect(f.scroll.restore()).toBe("");
  });

  test("restore puts it back when the run ends with the mouse off", () => {
    const f = fixture();
    f.scroll.policy("off");
    expect(f.scroll.restore()).toBe(ALTERNATE_SCROLL_ON);
    expect(f.scroll.restore()).toBe("");
  });

  test("a terminal that answered reset gets nothing written back", () => {
    const f = fixture();
    expect(f.scroll.reply("\x1b[?1007;2$y")).toBe(true);
    f.scroll.policy("off");
    f.scroll.policy("full");
    expect(f.written).toEqual([ALTERNATE_SCROLL_OFF]);
    f.scroll.policy("off");
    expect(f.scroll.restore()).toBe("");
  });

  test("an answer of set, or of not recognised, is written back", () => {
    for (const reply of ["\x1b[?1007;1$y", "\x1b[?1007;0$y"]) {
      const f = fixture();
      expect(f.scroll.reply(reply)).toBe(true);
      f.scroll.policy("off");
      expect(f.scroll.restore()).toBe(ALTERNATE_SCROLL_ON);
    }
  });

  test("reply claims only its own sequence", () => {
    const f = fixture();
    expect(f.scroll.reply("\x1b[A")).toBe(false);
    expect(f.scroll.reply("\x1b[?2004;1$y")).toBe(false);
  });
});

describe("installNotchFilter", () => {
  function fixture() {
    const pushed: string[] = [];
    const parser = { push: (data: Uint8Array | string) => void pushed.push(typeof data === "string" ? data : Buffer.from(data).toString("latin1")) };
    const original = parser.push;
    let policy: MousePolicy = "off";
    const remove = installNotchFilter({ stdinParser: parser } as never, () => policy);
    return { parser, pushed, remove, original, setPolicy: (p: MousePolicy) => void (policy = p) };
  }

  test("drops a notch while the policy is off, whether the read is a string or bytes", () => {
    const f = fixture();
    f.parser.push("\x1b[A\x1b[A\x1b[A");
    f.parser.push(Buffer.from("\x1bOB\x1bOB\x1bOB"));
    expect(f.pushed).toEqual([]);
  });

  test("passes everything else, and everything under another policy", () => {
    const f = fixture();
    f.parser.push("\x1b[A");
    f.parser.push("\x1b[A\x1b[A");
    f.parser.push("abc");
    f.setPolicy("full");
    f.parser.push("\x1b[A\x1b[A\x1b[A");
    f.setPolicy("wheel");
    f.parser.push("\x1b[B\x1b[B\x1b[B");
    expect(f.pushed).toEqual(["\x1b[A", "\x1b[A\x1b[A", "abc", "\x1b[A\x1b[A\x1b[A", "\x1b[B\x1b[B\x1b[B"]);
  });

  test("the remover puts the parser's own push back", () => {
    const f = fixture();
    f.remove();
    expect(f.parser.push).toBe(f.original);
  });

  test("fails loudly if OpenTUI no longer has the parser", () => {
    expect(() => installNotchFilter({} as never, () => "off")).toThrow(/stdinParser/);
  });
});
