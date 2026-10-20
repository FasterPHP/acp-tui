// mvp-conversation task 6.1 (design D8): a bare `CSI R` is F3, and nothing with parameters is.
import { describe, expect, test } from "bun:test";
import type { CliRenderer, ParsedKey } from "@opentui/core";
import { installBareCsiR, isBareCsiR } from "../../src/renderer/bare-csi-r.ts";

describe("bare CSI R", () => {
  test("exactly ESC [ R", () => {
    expect(isBareCsiR("\x1b[R")).toBe(true);
    for (const other of ["\x1bOR", "\x1b[1;2R", "\x1b[12;40R", "\x1b[13;2~", "R", ""]) expect(isBareCsiR(other)).toBe(false);
  });

  test("the handler takes it and gives the renderer an F3 key press; other sequences pass", () => {
    let handler: ((sequence: string) => boolean) | undefined;
    const keys: ParsedKey[] = [];
    const renderer = {
      prependInputHandler: (h: (sequence: string) => boolean) => void (handler = h),
      keyInput: { processParsedKey: (key: ParsedKey) => void keys.push(key) },
    } as unknown as CliRenderer;
    installBareCsiR(renderer);
    expect(handler!("\x1b[R")).toBe(true);
    expect(keys.map((k) => [k.name, k.shift, k.ctrl])).toEqual([["f3", false, false]]);
    expect(handler!("\x1b[1;2R")).toBe(false);
    expect(handler!("\x1bOR")).toBe(false);
    expect(keys.length).toBe(1);
  });
});
