// SPIKE (phase-1a, S5): unit tests for the pure parts of find and hand-back
// (tasks 15.2 to 15.4): the find bar's row, the collapse record find keeps
// (`expandRecorded`, `forget`), the export file (name, no overwrite, the
// temporary-directory fallback) and the exit prints (wrapping, sanitising,
// the text after the resume line).
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot } from "solid-js";
import { createSession, reduce } from "acp-model";
import { collapsible, createConversationViewModel, expandRecorded } from "../../src/conversation/view-model.ts";
import { barHints, barRow, counterText, pasteQuery } from "../../src/find/bar.ts";
import { exportBaseName, writeExport } from "../../src/find/export-file.ts";
import { handBackLines, plainLines, wrapPlain } from "../../src/find/hand-back.ts";
import { DEFAULT_KEY_MAP } from "../../src/keys/keymap.ts";
import { displayWidth } from "../../src/layout/segments.ts";
import { exitText } from "../../src/renderer/exit-text.ts";
import { agent, marker, tool, user } from "../selection/items.ts";

const scratch = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-find-unit-"));

describe("the find bar's row", () => {
  test("the counter: hits before the first step, then `n of m`", () => {
    expect(counterText("", 0, -1)).toBe("");
    expect(counterText("x", 0, -1)).toBe("no hits");
    expect(counterText("x", 1, -1)).toBe("1 hit");
    expect(counterText("x", 17, -1)).toBe("17 hits");
    expect(counterText("x", 17, 2)).toBe("3 of 17");
  });

  test("label, query, cursor cell, counter, then whole hints as far as they fit", () => {
    const hints = barHints(DEFAULT_KEY_MAP);
    const text = (width: number, query = "needle") => barRow({ query, hits: 17, current: 2, width, hints }).map((s) => s.text).join("");
    expect(text(100)).toBe("find: needle   3 of 17 · enter next · shift+enter previous · tab go to · esc back");
    // Narrower: the hints drop from the right, whole.
    expect(text(50)).toBe("find: needle   3 of 17 · enter next");
    expect(text(30)).toBe("find: needle   3 of 17");
    for (const width of [10, 20, 30, 45, 63]) expect(displayWidth(text(width, "a-long-query-that-keeps-its-tail"))).toBeLessThanOrEqual(width);
    // A long query keeps its tail (where the typing is).
    expect(text(30, "a-long-query-that-keeps-its-tail")).toBe("find: …eeps-its-tail   3 of 17");
    const cursor = barRow({ query: "q", hits: 0, current: -1, width: 40, hints }).find((s) => s.cursor);
    expect(cursor?.text).toBe(" ");
  });

  test("pasted text: line breaks and tabs are spaces, escapes and other controls are dropped (task 6.4)", () => {
    expect(pasteQuery("needle-500-back")).toBe("needle-500-back");
    expect(pasteQuery("a\nb\r\nc\rd\te")).toBe("a b c d e");
    expect(pasteQuery("x\x1b]52;c;AAAA\x07y\x00z\x7f")).toBe("xyz");
  });
});

describe("find's collapse record (expandRecorded)", () => {
  test("expands a collapsed item as a recorded choice, and puts back no choice or the user's own", () =>
    createRoot((dispose) => {
      const vm = createConversationViewModel();
      const t = tool("tool:a");
      expect(collapsible(t)).toBe(true);
      const undo = expandRecorded(vm, t, vm.expanded(t))!;
      expect(vm.expanded(t)).toBe(true);
      expect(vm.toggled(t.id)).toBe(true);
      undo();
      expect(vm.expanded(t)).toBe(false);
      expect(vm.toggled(t.id)).toBe(false);
      // The user's own collapse of a failed call (expanded by default) is put back as it was.
      const failed = tool("tool:f", { toolStatus: "failed" });
      vm.setExpanded(failed, false);
      const again = expandRecorded(vm, failed, vm.expanded(failed))!;
      expect(vm.expanded(failed)).toBe(true);
      again();
      expect(vm.expanded(failed)).toBe(false);
      expect(vm.toggled(failed.id)).toBe(true);
      // Already expanded, or not collapsible: nothing to do.
      expect(expandRecorded(vm, failed, true)).toBeNull();
      expect(expandRecorded(vm, agent("m", "text"), false)).toBeNull();
      dispose();
    }));
});

describe("the export file", () => {
  test("named after the session and the time, `[A-Za-z0-9_-]` only", () => {
    const at = new Date(2026, 8, 30, 7, 5, 9);
    expect(exportBaseName("fake-session-1", at)).toBe("acp-tui-fake-session-20260930-070509");
    expect(exportBaseName("0f3c9a2e-1111-2222-3333-444455556666", at)).toBe("acp-tui-0f3c9a2e-111-20260930-070509");
    expect(exportBaseName("../../etc/passwd", at)).toBe("acp-tui-etcpasswd-20260930-070509");
    expect(exportBaseName(null, at)).toBe("acp-tui-20260930-070509");
  });

  test("never overwrites: a clash adds -2, -3", async () => {
    const dir = scratch();
    const now = new Date(2026, 8, 30, 7, 5, 9);
    writeFileSync(join(dir, "acp-tui-s-20260930-070509.md"), "mine");
    const a = await writeExport("# one\n", { cwd: dir, sessionId: "s", now });
    const b = await writeExport("# two\n", { cwd: dir, sessionId: "s", now });
    expect(a.path).toBe(join(dir, "acp-tui-s-20260930-070509-2.md"));
    expect(b.path).toBe(join(dir, "acp-tui-s-20260930-070509-3.md"));
    expect(readFileSync(join(dir, "acp-tui-s-20260930-070509.md"), "utf8")).toBe("mine");
    expect(readFileSync(a.path, "utf8")).toBe("# one\n");
    expect(a).toMatchObject({ bytes: 6, fallback: false });
  });

  test("an unusable working directory falls back to the temporary directory", async () => {
    const tmp = scratch();
    const result = await writeExport("x\n", { cwd: join(tmp, "gone", "away"), sessionId: "s", tmp });
    expect(result.fallback).toBe(true);
    expect(result.path.startsWith(tmp)).toBe(true);
    expect(existsSync(result.path)).toBe(true);
  });
});

describe("hand-back exit prints", () => {
  test("wrapping: at the last space that fits, else hard; never wider than the width", () => {
    expect(wrapPlain("short", 10)).toEqual(["short"]);
    expect(wrapPlain("the quick brown fox jumps", 10)).toEqual(["the quick", "brown fox", "jumps"]);
    expect(wrapPlain("abcdefghijklmnop", 5)).toEqual(["abcde", "fghij", "klmno", "p"]);
    expect(wrapPlain("exactly10! next", 10)).toEqual(["exactly10!", "next"]);
    // Indentation is kept on the first row; wide characters count two columns.
    expect(wrapPlain("    return value;", 12)).toEqual(["    return", "value;"]);
    for (const row of wrapPlain("日本語のテキストです", 5)) expect(displayWidth(row)).toBeLessThanOrEqual(5);
  });

  test("plain lines: tabs expanded, escapes, bidi and zero-width characters dropped, blank lines kept", () => {
    expect(plainLines("a\tb\n\n\x1b[31mred\x1b[0m ‮evil​", 80)).toEqual(["a       b", "", "red evil"]);
  });

  test("last answer and transcript from a session; null without an answer", () => {
    let session = createSession();
    const events = [
      { type: "session_created", at: 0, cwd: "/w", agentInfo: { name: "a", version: "1" }, response: { sessionId: "s1" } },
      { type: "prompt_sent", text: "hello there", at: 1 },
      { type: "session_update", at: 2, update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "First **answer**." } } },
      { type: "session_update", at: 3, update: { sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "Second answer." } } },
      { type: "prompt_response", stopReason: "end_turn", at: 4 },
    ] as const;
    expect(handBackLines("last-answer", session, 80)).toBeNull();
    for (const event of events) session = reduce(session, event as never);
    expect(handBackLines("last-answer", session, 80)).toEqual(["Second answer."]);
    expect(handBackLines("transcript", session, 80)).toEqual(["hello there", "", "First answer.", "", "Second answer."]);
    // After the resume line and a blank line, from the cursor, lines ending in `\n` (mvp-sessions
    // design decision 12); without a resume line, at once.
    const text = exitText("transcript", { session, canReopen: true, hadPromptOrOpened: true, width: 80 });
    expect(text).toBe("\rresume: acp-tui --resume s1\n\nhello there\n\nFirst answer.\n\nSecond answer.\n");
    expect(exitText("summary", { session, canReopen: true, hadPromptOrOpened: true, width: 80 })).toBe("\rresume: acp-tui --resume s1\n");
    expect(exitText("transcript", { session, width: 80 })).toBe("\rhello there\n\nFirst answer.\n\nSecond answer.\n");
    expect(exitText("summary", { session, width: 80 })).toBe("");
  });

  test("markers print as drawn (`error: ...`), between the messages", () => {
    const items = [user("u", "question"), agent("a", "answer"), marker("e", "error", "boom")];
    const session = { order: items.map((i) => i.id), items: new Map(items.map((i) => [i.id, i])) };
    expect(handBackLines("transcript", session, 40)).toEqual(["question", "", "answer", "", "error: boom"]);
  });
});
