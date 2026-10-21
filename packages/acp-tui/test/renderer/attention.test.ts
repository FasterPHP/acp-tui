// mvp-chrome-and-keys task 7.2 (spec tui-screen "Attention signals"): the signal rules with a
// fake clock and a fake session source, without a terminal. The same scenarios run end to end
// in terminal-signals.pty.test.ts ("Long turn against fake-agent's slow-turn"), through
// cli-with-attention.ts, whose test-only environment variable lowers the threshold.

import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createSession, type Session, type TurnState } from "acp-model";
import {
  ATTENTION_SIGNALS,
  attentionFromConfig,
  attentionSequence,
  createAttention,
  DEFAULT_ATTENTION,
  installAttention,
  wireAttention,
  type AttentionSettings,
} from "../../src/renderer/attention.ts";

const BEL = "\x07";

function fixture(settings: AttentionSettings | (() => AttentionSettings) = DEFAULT_ATTENTION) {
  let time = 1_000_000;
  const written: string[] = [];
  const attention = createAttention({ settings, write: (d) => void written.push(d), now: () => time });
  let current: Session = createSession();
  const step = (state: TurnState) => {
    const previous = current;
    current = { ...current, state };
    attention.observe(current, previous);
  };
  return { attention, written, step, advance: (seconds: number) => void (time += seconds * 1000) };
}

describe("defaults", () => {
  test("BEL, 30 seconds", () => {
    expect(DEFAULT_ATTENTION).toEqual({ signal: "bell", longTurnSeconds: 30 });
  });

  test("the four kinds, with fixed text and no agent bytes", () => {
    expect(ATTENTION_SIGNALS).toEqual(["bell", "osc9", "osc777", "none"]);
    expect(attentionSequence("bell", "requires_action")).toBe(BEL);
    expect(attentionSequence("osc9", "requires_action")).toBe("\x1b]9;acp-tui: needs your input\x07");
    expect(attentionSequence("osc9", "turn_ended")).toBe("\x1b]9;acp-tui: turn finished\x07");
    expect(attentionSequence("osc777", "turn_ended")).toBe("\x1b]777;notify;acp-tui;turn finished\x07");
    expect(attentionSequence("none", "requires_action")).toBe("");
  });
});

describe("requires_action", () => {
  test("Permission while unfocused: one signal when the session enters requires_action", () => {
    const f = fixture();
    f.attention.setFocused(false);
    f.step("running");
    f.step("requires_action");
    expect(f.written).toEqual([BEL]);
  });

  test("a terminal that never reported focus counts as unfocused", () => {
    const f = fixture();
    expect(f.attention.focused).toBe(false);
    f.step("running");
    f.step("requires_action");
    expect(f.written).toEqual([BEL]);
  });

  test("Focused pane: nothing while the last report was focus in; a later focus out signals again", () => {
    const f = fixture();
    f.attention.setFocused(true);
    f.step("running");
    f.step("requires_action");
    expect(f.written).toEqual([]);
    f.step("running");
    f.attention.setFocused(false);
    f.step("requires_action");
    expect(f.written).toEqual([BEL]);
  });

  test("one signal per entry, not per step", () => {
    const f = fixture();
    f.step("requires_action");
    f.step("requires_action");
    f.step("running");
    f.step("requires_action");
    expect(f.written).toEqual([BEL, BEL]);
  });
});

describe("turn end", () => {
  test("Short turn: 10 seconds while unfocused signals nothing", () => {
    const f = fixture();
    f.step("running");
    f.advance(10);
    f.step("idle");
    expect(f.written).toEqual([]);
  });

  test("Long turn: 45 seconds while unfocused signals once", () => {
    const f = fixture();
    f.step("running");
    f.advance(45);
    f.step("idle");
    expect(f.written).toEqual([BEL]);
  });

  test("the threshold is inclusive, and a setting changes it", () => {
    const edge = fixture();
    edge.step("running");
    edge.advance(30);
    edge.step("idle");
    expect(edge.written).toEqual([BEL]);
    const custom = fixture({ signal: "bell", longTurnSeconds: 5 });
    custom.step("running");
    custom.advance(6);
    custom.step("idle");
    expect(custom.written).toEqual([BEL]);
  });

  test("a long turn that waited for the user signals on the wait and again at its end", () => {
    const f = fixture();
    f.step("running");
    f.advance(20);
    f.step("requires_action");
    f.advance(20);
    f.step("running");
    f.advance(5);
    f.step("idle");
    expect(f.written).toEqual([BEL, BEL]);
  });

  test("a long turn while focused signals nothing", () => {
    const f = fixture();
    f.attention.setFocused(true);
    f.step("running");
    f.advance(120);
    f.step("idle");
    expect(f.written).toEqual([]);
  });

  test("each turn is measured from its own start", () => {
    const f = fixture();
    f.step("running");
    f.advance(60);
    f.step("idle");
    f.advance(600);
    f.step("running");
    f.advance(2);
    f.step("idle");
    expect(f.written).toEqual([BEL]);
  });

  test("the signal kind is the setting's", () => {
    const f = fixture({ signal: "osc777", longTurnSeconds: 30 });
    f.step("running");
    f.step("requires_action");
    expect(f.written).toEqual([attentionSequence("osc777", "requires_action")]);
    const none = fixture({ signal: "none", longTurnSeconds: 30 });
    none.step("running");
    none.step("requires_action");
    none.advance(100);
    none.step("idle");
    expect(none.written).toEqual([]);
  });
});

describe("installAttention", () => {
  test("follows the renderer's focus and blur events and the session; the remover stops both", () => {
    const renderer = new EventEmitter();
    const listeners = new Set<(change: { session: Session; previous: Session }) => void>();
    const written: string[] = [];
    const remove = installAttention(
      renderer as never,
      {
        onChange(listener) {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
      },
      { write: (d) => void written.push(d) },
    );
    const idle = createSession();
    const waiting: Session = { ...idle, state: "requires_action" };
    renderer.emit("focus");
    for (const l of listeners) l({ session: waiting, previous: idle });
    expect(written).toEqual([]);
    renderer.emit("blur");
    for (const l of listeners) l({ session: waiting, previous: idle });
    expect(written).toEqual([BEL]);
    remove();
    expect(listeners.size).toBe(0);
    expect(renderer.listenerCount("blur")).toBe(0);
  });
});

// mvp-configuration task 4.7 (spec tui-config "Attention settings"): `attention.signal` and
// `attention.long_turn_seconds` from the configuration, read at each signal.
describe("attention settings from the configuration", () => {
  test("Shorter threshold: with long_turn_seconds 10, a turn of 12 seconds while unfocused signals once, one of 8 not at all", () => {
    const f = fixture(attentionFromConfig({ signal: "bell", long_turn_seconds: 10 }));
    f.step("running");
    f.advance(12);
    f.step("idle");
    expect(f.written).toEqual([BEL]);
    f.step("running");
    f.advance(8);
    f.step("idle");
    expect(f.written).toEqual([BEL]);
  });

  test("Desktop notification: with osc9, a permission request writes one OSC 9 of fixed text and no BEL", () => {
    const f = fixture(attentionFromConfig({ signal: "osc9", long_turn_seconds: 30 }));
    f.step("running");
    f.step("requires_action");
    expect(f.written).toEqual(["\x1b]9;acp-tui: needs your input\x07"]);
  });

  test("none writes nothing, for a permission request or a long turn", () => {
    const f = fixture(attentionFromConfig({ signal: "none", long_turn_seconds: 1 }));
    f.step("running");
    f.step("requires_action");
    f.advance(5);
    f.step("idle");
    expect(f.written).toEqual([]);
  });

  test("a reload applies at the next signal: the settings are read when the signal fires", () => {
    let settings = attentionFromConfig({ signal: "bell", long_turn_seconds: 30 });
    const f = fixture(() => settings);
    f.step("running");
    f.advance(12);
    settings = attentionFromConfig({ signal: "osc777", long_turn_seconds: 10 });
    f.step("idle");
    expect(f.written).toEqual(["\x1b]777;notify;acp-tui;turn finished\x07"]);
  });
});

// interface-feedback task 6.3 (spec tui-screen "Attention marker in the title"): pending attention.
describe("pending attention", () => {
  test("set without focus reports: a terminal that never reported counts as unfocused", () => {
    const f = fixture();
    f.step("running");
    f.advance(45);
    f.step("idle");
    expect(f.attention.pending).toBe(true);
  });

  test("not set while the pane has focus", () => {
    const f = fixture();
    f.attention.setFocused(true);
    f.step("running");
    f.advance(45);
    f.step("idle");
    f.step("running");
    f.step("requires_action");
    expect(f.attention.pending).toBe(false);
  });

  test("not set by a short turn", () => {
    const f = fixture();
    f.step("running");
    f.advance(5);
    f.step("idle");
    expect(f.attention.pending).toBe(false);
  });

  test("set under signal none, though nothing is written", () => {
    const f = fixture({ signal: "none", longTurnSeconds: 30 });
    f.step("running");
    f.step("requires_action");
    expect(f.written).toEqual([]);
    expect(f.attention.pending).toBe(true);
  });

  test("cleared by focus in, by interacted(), and reported to listeners once per change", () => {
    const f = fixture();
    const seen: boolean[] = [];
    f.attention.onPending((p) => void seen.push(p));
    f.step("requires_action");
    expect(f.attention.pending).toBe(true);
    f.attention.setFocused(true);
    expect(f.attention.pending).toBe(false);
    f.attention.setFocused(false);
    f.step("running");
    f.step("requires_action");
    f.attention.interacted();
    f.attention.interacted();
    expect(seen).toEqual([true, false, true, false]);
  });

  test("the unsubscribed listener hears nothing more", () => {
    const f = fixture();
    const seen: boolean[] = [];
    const off = f.attention.onPending((p) => void seen.push(p));
    off();
    f.step("requires_action");
    expect(seen).toEqual([]);
  });
});

describe("pending attention cleared by interaction (installAttention)", () => {
  function wired() {
    const renderer = Object.assign(new EventEmitter(), {
      keyInput: {
        processParsedKey: (_key: { eventType?: string }) => true,
        processPaste: (_bytes: Uint8Array) => {},
      },
      processSingleMouseEvent: (_report: { type: string }) => true,
    });
    const dispatched: string[] = [];
    renderer.processSingleMouseEvent = (report) => (dispatched.push(report.type), true);
    const listeners = new Set<(change: { session: Session; previous: Session }) => void>();
    const feed = {
      onChange(listener: (change: { session: Session; previous: Session }) => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
    const { attention, remove } = wireAttention(renderer as never, feed, { write: () => {} });
    const idle = createSession();
    const raise = () => {
      for (const l of listeners) l({ session: { ...idle, state: "requires_action" }, previous: idle });
    };
    return { renderer, attention, remove, raise, dispatched };
  }

  test("a key press clears it", () => {
    const w = wired();
    w.raise();
    expect(w.attention.pending).toBe(true);
    w.renderer.keyInput.processParsedKey({});
    expect(w.attention.pending).toBe(false);
  });

  test("a key release does not clear it", () => {
    const w = wired();
    w.raise();
    w.renderer.keyInput.processParsedKey({ eventType: "release" });
    expect(w.attention.pending).toBe(true);
  });

  test("a paste clears it", () => {
    const w = wired();
    w.raise();
    w.renderer.keyInput.processPaste(new Uint8Array());
    expect(w.attention.pending).toBe(false);
  });

  test("a click and a wheel event clear it, pointer motion does not, and every report is still dispatched", () => {
    const w = wired();
    w.raise();
    for (const type of ["move", "drag", "up", "over", "out"]) w.renderer.processSingleMouseEvent({ type });
    expect(w.attention.pending).toBe(true);
    w.renderer.processSingleMouseEvent({ type: "down" });
    expect(w.attention.pending).toBe(false);
    w.raise();
    expect(w.attention.pending).toBe(true);
    w.renderer.processSingleMouseEvent({ type: "scroll" });
    expect(w.attention.pending).toBe(false);
    expect(w.dispatched).toEqual(["move", "drag", "up", "over", "out", "down", "scroll"]);
  });

  test("the remover puts the wrapped methods back, and a key then clears nothing", () => {
    const w = wired();
    const wrapped = w.renderer.processSingleMouseEvent;
    const key = w.renderer.keyInput.processParsedKey;
    w.remove();
    expect(w.renderer.processSingleMouseEvent).not.toBe(wrapped);
    expect(w.renderer.keyInput.processParsedKey).not.toBe(key);
    expect(w.renderer.listenerCount("focus")).toBe(0);
  });
});
