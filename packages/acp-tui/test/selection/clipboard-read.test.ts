// mvp-chrome-and-keys task 3.2 (design D11): the clipboard reader behind
// `paste`, against stubbed host backends. Text is read as text, an image is
// told apart, every other outcome is a reason for the notice; `--clipboard
// osc52` and `none`, and a process without a display, never read the host.
import { describe, expect, test } from "bun:test";
import type { ClipboardReadResult, HostClipboardService } from "@opentui/core";
import { createClipboardReader, NO_CLIPBOARD_REASON, NO_HOST, pasteNotice } from "../../src/selection/clipboard.ts";
import type { DebugLogEntry } from "../../src/log.ts";

function host(result: ClipboardReadResult, reads: string[][] = []): HostClipboardService {
  return { ...NO_HOST, read: async (o) => (reads.push([...o.preferredTypes]), result) };
}
const bytes = (text: string) => new TextEncoder().encode(text);

describe("clipboard reader", () => {
  test("text is read as text, asking for text first; the log has its length, never the text", async () => {
    const reads: string[][] = [];
    const logged: DebugLogEntry[] = [];
    const reader = createClipboardReader({ host: host({ status: "read", representation: { mimeType: "text/plain", bytes: bytes("a\nb") } }, reads), logger: { enabled: true, log: (e) => void logged.push(e) } });
    expect(await reader.read("ctrl+v")).toEqual({ kind: "text", text: "a\nb" });
    expect(reads[0]![0]).toBe("text/plain");
    expect(reads[0]).toContain("image/png");
    expect(logged).toEqual([{ event: "clipboard", direction: "read", trigger: "ctrl+v", mode: "auto", status: "read", result: "text", chars: 3 }]);
  });

  test("an image is told apart, and its notice says image paste is not supported yet", async () => {
    const read = await createClipboardReader({ host: host({ status: "read", representation: { mimeType: "image/png", bytes: bytes("x") } }) }).read("ctrl+v");
    expect(read).toEqual({ kind: "image", mimeType: "image/png" });
    expect(pasteNotice(read as Exclude<typeof read, { kind: "text" }>)).toContain("image paste is not supported yet");
  });

  test("empty, timed out, over the limit, failed and unsupported each give a reason", async () => {
    const cases: [ClipboardReadResult, string][] = [
      [{ status: "empty" }, "the clipboard holds no text"],
      [{ status: "read", representation: { mimeType: "text/plain", bytes: bytes("") } }, "the clipboard holds no text"],
      [{ status: "timed-out" }, "the clipboard did not answer in time"],
      [{ status: "limit-exceeded" }, "the clipboard holds more than 16 MiB"],
      [{ status: "failed", error: new Error("boom") }, "boom"],
      [{ status: "unsupported" }, NO_CLIPBOARD_REASON],
    ];
    for (const [result, reason] of cases) expect(await createClipboardReader({ host: host(result) }).read("palette")).toEqual({ kind: "none", reason });
  });

  test("no display, `--clipboard osc52` or `none`: the host is never read", async () => {
    // No display is a Linux state: macOS and Windows always have a clipboard.
    expect(await createClipboardReader({ env: {}, platform: "linux" }).read("ctrl+v")).toEqual({ kind: "none", reason: NO_CLIPBOARD_REASON });
    const reads: string[][] = [];
    const text = host({ status: "read", representation: { mimeType: "text/plain", bytes: bytes("x") } }, reads);
    expect(await createClipboardReader({ mode: "osc52", host: text }).read("ctrl+v")).toEqual({ kind: "none", reason: NO_CLIPBOARD_REASON });
    expect((await createClipboardReader({ mode: "none", host: text }).read("ctrl+v")).kind).toBe("none");
    expect(reads).toEqual([]);
    expect(pasteNotice({ kind: "none", reason: NO_CLIPBOARD_REASON })).toBe("nothing pasted: no clipboard could be read; use the terminal's paste");
  });
});
