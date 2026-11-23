// The cursor colour controller (prompt-box-feedback tasks 2.3, 2.4 and 3.2; ./cursor-colour.ts):
// when the choice is made, kept or made again, and when OSC 112 is written under `terminal`.
import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import type { CliRenderer } from "@opentui/core";
import { createCursorColour } from "../../src/app/cursor-colour.ts";
import { forceFullRepaint } from "../../src/renderer/repaint.ts";
import { createColourTracker } from "../../src/theme/terminal-colours.ts";

function setup() {
  const osc = new Set<(sequence: string) => void>();
  const events = new EventEmitter();
  const renderer = Object.assign(events, {
    isDestroyed: false,
    forceFullRepaintRequested: false,
    requestRender() {},
    subscribeOsc(handler: (sequence: string) => void) {
      osc.add(handler);
      return () => void osc.delete(handler);
    },
  });
  const tracker = createColourTracker(renderer as never, { write: () => {} });
  const written: string[] = [];
  const cursor = createCursorColour({ tracker, renderer: renderer as unknown as CliRenderer, write: (d) => written.push(d) });
  return {
    tracker,
    cursor,
    written,
    renderer,
    reply: (s: string) => osc.forEach((h) => h(s)),
    frame: () => renderer.emit("frame"),
  };
}

/** The controller's own timer was set just after the tracker's, with the same wait: one timer turn later it has run. */
const afterTimers = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const LIGHT = ["\x1b]10;#212121\x07", "\x1b]11;#fafafa\x07", "\x1b]12;#000000\x07"] as const;

describe("The choice", () => {
  test("is made at the third reply, not before: hidden until then", () => {
    const t = setup();
    void t.tracker.query(5000);
    expect(t.cursor.ready()).toBe(false);
    t.reply(LIGHT[0]);
    t.reply(LIGHT[1]);
    expect(t.cursor.ready()).toBe(false);
    t.reply(LIGHT[2]);
    expect(t.cursor.ready()).toBe(true);
    expect(t.cursor.choice()).toBe("#000000");
    expect(t.cursor.colour()).toBe("#000000");
  });

  test("is made at the wait's end with what arrived (no cursor reply: the foreground)", async () => {
    const t = setup();
    const q = t.tracker.query(30);
    t.reply("\x1b]10;#d4d4d4\x07");
    t.reply("\x1b]11;#1e1e1e\x07");
    expect(t.cursor.ready()).toBe(false);
    await q;
    // The query resolved on the pair; the choice waits for the cursor reply until the wait ends.
    expect(t.cursor.ready()).toBe(false);
    while (!t.cursor.ready()) await afterTimers();
    expect(t.cursor.choice()).toBe("#d4d4d4");
  });

  test("no reply at all is the terminal's own colour, with the textarea given nothing of its own", async () => {
    const t = setup();
    await t.tracker.query(20);
    await afterTimers();
    expect(t.cursor.choice()).toBe("terminal");
    expect(t.cursor.colour()).toBeUndefined();
  });

  test("a re-query nobody answers keeps the choice; one with replies chooses again from them", async () => {
    const t = setup();
    void t.tracker.query(5000);
    LIGHT.forEach(t.reply);
    expect(t.cursor.choice()).toBe("#000000");
    void t.tracker.query(20);
    await afterTimers();
    expect(t.cursor.choice()).toBe("#000000");
    void t.tracker.query(5000);
    t.reply("\x1b]10;#c0caf5\x07");
    t.reply("\x1b]11;#1a1b26\x07");
    t.reply("\x1b]12;#000000\x07");
    expect(t.cursor.choice()).toBe("#c0caf5");
  });

  test("a re-query with unchanged replies changes nothing", () => {
    const t = setup();
    void t.tracker.query(5000);
    LIGHT.forEach(t.reply);
    const seen: unknown[] = [];
    // Solid signals are read through the accessor: compare identity of the value after the round.
    seen.push(t.cursor.choice());
    void t.tracker.query(5000);
    LIGHT.forEach(t.reply);
    seen.push(t.cursor.choice());
    expect(seen).toEqual(["#000000", "#000000"]);
  });

  test("replies nobody asked for (OpenTUI's own re-query) choose again as they arrive", () => {
    const t = setup();
    void t.tracker.query(5000);
    LIGHT.forEach(t.reply);
    t.reply("\x1b]10;#c0caf5\x07");
    t.reply("\x1b]11;#1a1b26\x07");
    t.reply("\x1b]12;#000000\x07");
    expect(t.cursor.choice()).toBe("#c0caf5");
  });
});

describe("OSC 112 under the terminal's own colour", () => {
  async function terminalChoice() {
    const t = setup();
    await t.tracker.query(20);
    await afterTimers();
    t.frame();
    t.written.length = 0;
    return t;
  }

  test("written after the next frame once the choice or a focus change marks it, and only once", async () => {
    const t = await terminalChoice();
    t.frame();
    expect(t.written).toEqual([]);
    t.cursor.markDirty();
    expect(t.written).toEqual([]);
    t.frame();
    expect(t.written).toEqual(["\x1b]112\x07"]);
    t.frame();
    expect(t.written).toHaveLength(1);
  });

  test("a forced full repaint marks it", async () => {
    const t = await terminalChoice();
    forceFullRepaint(t.renderer as unknown as CliRenderer);
    t.frame();
    expect(t.written).toEqual(["\x1b]112\x07"]);
  });

  test("nothing is written when a colour was chosen", () => {
    const t = setup();
    void t.tracker.query(5000);
    LIGHT.forEach(t.reply);
    t.cursor.markDirty();
    forceFullRepaint(t.renderer as unknown as CliRenderer);
    t.frame();
    t.frame();
    expect(t.written).toEqual([]);
  });

  test("dispose stops it", async () => {
    const t = await terminalChoice();
    t.cursor.markDirty();
    t.cursor.dispose();
    t.frame();
    expect(t.written).toEqual([]);
  });
});
