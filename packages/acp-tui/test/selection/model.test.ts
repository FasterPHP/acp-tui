// SPIKE (phase-1a, S4): the selection's pure parts (tasks 14.2, 14.3): ends
// and ranges, words and lines, multi-click counting, and the clipboard policy
// with a fake renderer and host backend (nothing real is written).
import { describe, expect, test } from "bun:test";
import type { HostClipboardService } from "@opentui/core";
import { copyToast, createCopier, hostDisplay, NO_HOST } from "../../src/selection/clipboard.ts";
import { dragRange, isEmptyRange, lineAround, nextClick, rangeEnds, wordAt } from "../../src/selection/model.ts";

const order = ["a", "b", "c"];
const index = (id: string) => order.indexOf(id);

describe("selection ranges (task 14.2)", () => {
  test("a drag includes the characters at both ends, in either direction", () => {
    const forward = dragRange(index, { itemId: "a", from: 3, to: 4 }, { itemId: "c", from: 7, to: 8 });
    expect(forward).toEqual({ anchor: { itemId: "a", offset: 3 }, focus: { itemId: "c", offset: 8 } });
    const back = dragRange(index, { itemId: "c", from: 7, to: 8 }, { itemId: "a", from: 3, to: 4 });
    expect(back).toEqual({ anchor: { itemId: "c", offset: 8 }, focus: { itemId: "a", offset: 3 } });
    expect(rangeEnds(index, back)).toEqual({ start: { itemId: "a", offset: 3 }, end: { itemId: "c", offset: 8 } });
    // Within one item, backwards: the anchor's character stays included.
    expect(dragRange(index, { itemId: "b", from: 5, to: 6 }, { itemId: "b", from: 2, to: 3 })).toEqual({
      anchor: { itemId: "b", offset: 6 },
      focus: { itemId: "b", offset: 2 },
    });
    expect(isEmptyRange({ anchor: { itemId: "b", offset: 2 }, focus: { itemId: "b", offset: 2 } })).toBe(true);
  });

  test("words are letters, digits and underscores; anything else is one character", () => {
    const text = "call array_sum($lines) now";
    expect(wordAt(text, 7)).toEqual({ start: 5, end: 14 });
    expect(text.slice(5, 14)).toBe("array_sum");
    expect(wordAt(text, 14)).toEqual({ start: 14, end: 15 });
    expect(wordAt(text, 100)).toEqual({ start: text.length, end: text.length });
    expect(wordAt("naïve 😀 x", 2)).toEqual({ start: 0, end: 5 });
    expect(wordAt("naïve 😀 x", 6)).toEqual({ start: 6, end: 8 });
  });

  test("a line is the logical line around the offset", () => {
    const text = "one\ntwo two\nthree";
    expect(lineAround(text, 5)).toEqual({ start: 4, end: 11 });
    expect(lineAround(text, 0)).toEqual({ start: 0, end: 3 });
    expect(lineAround(text, text.length)).toEqual({ start: 12, end: 17 });
  });

  test("clicks count up to three within 400 ms and one cell", () => {
    const one = nextClick(null, 10, 5, 1000);
    const two = nextClick(one, 11, 5, 1300);
    const three = nextClick(two, 11, 5, 1600);
    expect([one.count, two.count, three.count]).toEqual([1, 2, 3]);
    expect(nextClick(three, 11, 5, 1700).count).toBe(3);
    expect(nextClick(one, 10, 5, 1500).count).toBe(1);
    expect(nextClick(one, 13, 5, 1100).count).toBe(1);
    expect(nextClick(one, 10, 6, 1100).count).toBe(1);
  });
});

/** A renderer stand-in: records OSC 52 writes. */
function fakeRenderer(remote: boolean, osc52: "supported" | "unsupported" | "unknown" = "unknown") {
  const writes: string[] = [];
  return {
    writes,
    capabilities: { remote, osc52_support: osc52 },
    copyToClipboardOSC52(text: string) {
      writes.push(text);
      return true;
    },
    clearClipboardOSC52: () => true,
  };
}

function fakeHost(status: "written" | "unsupported" | "failed"): HostClipboardService & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    maxWriteBytes: 1024,
    read: async () => ({ status: "unsupported" }),
    async writeText(text) {
      writes.push(text);
      return status === "failed" ? { status, error: new Error("no seat") } : { status };
    },
    clear: async () => ({ status: "unsupported" }),
    dispose: async () => {},
  };
}

describe("the clipboard paths (task 14.3)", () => {
  test("the display variables", () => {
    expect(hostDisplay({ WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0" })).toBe("wayland");
    expect(hostDisplay({ DISPLAY: ":0" })).toBe("x11");
    expect(hostDisplay({})).toBeNull();
  });

  test("locally the host comes first, and OSC 52 only when it fails", async () => {
    const renderer = fakeRenderer(false);
    const host = fakeHost("written");
    const outcome = await createCopier({ renderer, host, env: { WAYLAND_DISPLAY: "w" } }).copy("abc", "test");
    expect(outcome.path).toBe("host");
    expect(host.writes).toEqual(["abc"]);
    expect(renderer.writes).toEqual([]);
    for (const status of ["unsupported", "failed"] as const) {
      const r = fakeRenderer(false);
      const o = await createCopier({ renderer: r, host: fakeHost(status), env: {} }).copy("abc", "test");
      expect(o.path).toBe("osc52");
      expect(r.writes).toEqual(["abc"]);
    }
  });

  test("in a remote session OSC 52 only; with OSC 52 off and no host, nothing", async () => {
    const remote = fakeRenderer(true);
    const host = fakeHost("written");
    expect((await createCopier({ renderer: remote, host, env: {} }).copy("abc", "t")).path).toBe("osc52");
    expect(host.writes).toEqual([]);
    const none = await createCopier({ renderer: fakeRenderer(false), host: NO_HOST, env: {}, mode: "host" }).copy("abc", "t");
    expect(none.path).toBe("none");
    const unsupported = fakeRenderer(false, "unsupported");
    expect((await createCopier({ renderer: unsupported, host: NO_HOST, env: {} }).copy("abc", "t")).path).toBe("none");
    expect(unsupported.writes).toEqual([]);
    expect((await createCopier({ renderer: fakeRenderer(false), host, env: {}, mode: "none" }).copy("abc", "t")).path).toBe("none");
  });

  test("the toast names the path, or says nothing was copied", () => {
    expect(copyToast(3, { path: "host", result: null }, "wayland").text).toBe("copied 3 chars to the Wayland clipboard (until acp-tui exits)");
    expect(copyToast(1, { path: "host", result: null, via: "native" }, "x11").text).toBe("copied 1 char to the X11 clipboard (until acp-tui exits)");
    expect(copyToast(3, { path: "host", result: null, via: "wl-copy" }, "wayland").text).toBe("copied 3 chars to the Wayland clipboard (wl-copy)");
    expect(copyToast(1, { path: "host", result: null, via: "xclip" }, "x11").text).toBe("copied 1 char to the X11 clipboard (xclip)");
    expect(copyToast(3, { path: "osc52", result: null }, null).text).toBe("sent 3 chars to the terminal (OSC 52, not confirmed)");
    expect(copyToast(3, { path: "none", result: null, error: "no clipboard available" }, null)).toEqual({ text: "nothing copied: no clipboard available", ok: false });
  });
});
