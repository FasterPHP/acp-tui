// The colour tracker's cursor colour (prompt-box-feedback task 2.1; spec tui-layout "Prompt box
// cursor colour"): OSC 12 asked and parsed, kept beside the pair without completing it, and a change
// of it alone reported.
import { describe, expect, test } from "bun:test";
import { COLOUR_QUERY, createColourTracker, parseColourReply } from "../../src/theme/terminal-colours.ts";

function fakeRenderer() {
  const subscribers = new Set<(sequence: string) => void>();
  return {
    subscribeOsc(handler: (sequence: string) => void) {
      subscribers.add(handler);
      return () => void subscribers.delete(handler);
    },
    emit(sequence: string) {
      for (const handler of [...subscribers]) handler(sequence);
    },
  };
}

describe("OSC 12", () => {
  test("is asked after the foreground and background, BEL-terminated", () => {
    expect(COLOUR_QUERY).toBe("\x1b]10;?\x07\x1b]11;?\x07\x1b]12;?\x07");
  });

  test("is parsed in both forms, either terminator", () => {
    expect(parseColourReply("\x1b]12;rgb:0000/0000/0000\x07")).toEqual({ code: 12, colour: "#000000" });
    expect(parseColourReply("\x1b]12;#C0CAF5\x1b\\")).toEqual({ code: 12, colour: "#c0caf5" });
    expect(parseColourReply("\x1b]12;?\x07")).toBeNull();
  });
});

describe("The tracker's cursor colour", () => {
  test("a pair completes without it, and the cursor is null", async () => {
    const renderer = fakeRenderer();
    const tracker = createColourTracker(renderer, { write: () => {} });
    const query = tracker.query(1000);
    renderer.emit("\x1b]10;rgb:2121/2121/2121\x07");
    renderer.emit("\x1b]11;rgb:fafa/fafa/fafa\x07");
    expect(await query).toEqual({ foreground: "#212121", background: "#fafafa" });
    expect(tracker.cursor()).toBeNull();
    expect(tracker.replies()).toEqual({ foreground: "#212121", background: "#fafafa", cursor: null });
  });

  test("the cursor reply is kept beside the pair, and a query forgets it", async () => {
    const renderer = fakeRenderer();
    const tracker = createColourTracker(renderer, { write: () => {} });
    const query = tracker.query(1000);
    renderer.emit("\x1b]10;#212121\x07");
    renderer.emit("\x1b]11;#fafafa\x07");
    renderer.emit("\x1b]12;rgb:0000/0000/0000\x07");
    await query;
    expect(tracker.cursor()).toBe("#000000");
    void tracker.query(10);
    expect(tracker.cursor()).toBeNull();
  });

  test("a changed cursor alone is a change (with a pair held), an equal one is not", async () => {
    const renderer = fakeRenderer();
    const tracker = createColourTracker(renderer, { write: () => {} });
    const changes: unknown[] = [];
    tracker.onChange((c) => changes.push(c));
    const query = tracker.query(1000);
    renderer.emit("\x1b]10;#212121\x07");
    renderer.emit("\x1b]11;#fafafa\x07");
    await query;
    expect(changes).toHaveLength(1);
    renderer.emit("\x1b]12;#000000\x07");
    expect(changes).toHaveLength(2);
    renderer.emit("\x1b]12;#000000\x07");
    expect(changes).toHaveLength(2);
    renderer.emit("\x1b]12;#ff0000\x07");
    expect(changes).toHaveLength(3);
  });

  test("onQuery gets the wait, onReply every colour reply", () => {
    const renderer = fakeRenderer();
    const tracker = createColourTracker(renderer, { write: () => {} });
    const waits: number[] = [];
    let replies = 0;
    tracker.onQuery((ms) => waits.push(ms));
    tracker.onReply(() => replies++);
    void tracker.query(123);
    renderer.emit("\x1b]10;#212121\x07");
    renderer.emit("\x1b]12;#000000\x07");
    renderer.emit("\x1b]4;1;rgb:0000/0000/0000\x07");
    expect(waits).toEqual([123]);
    expect(replies).toBe(2);
  });
});
