// The conversation view's items (phase-1a tasks 7.1, 7.2 and 7.7; spec
// tui-conversation "Items in start order, updated in place", "Sanitised
// content behind a role gutter", "Item presentation"; tui-theme "The
// terminal's own background outside cards") through the real CLI against
// fake-agent under the PTY harness, on the alternate screen.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { deriveSurfaces } from "../../src/theme/index.ts";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { activityRow, CARD_HEADER, lineWithoutBar, READY, withoutBar } from "../pty/regions.ts";
import { answerPermission, count, sendPrompt, settle, startCli, type CliRun } from "./cli.ts";

// The corpus is imported by a computed path: acp-tui does not depend on the fake-agent package.
const { HOSTILE_PAYLOADS } = (await import(join(import.meta.dir, "../../../fake-agent/src/hostile.ts"))) as {
  HOSTILE_PAYLOADS: readonly { name: string; text: string }[];
};

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
const SPINNER = `[${DEFAULT_GLYPHS.spinner.join("")}]`;
const spinnerCells = new RegExp(SPINNER, "g");

/** The rows above the activity bar, card or prompt box. */
function conversationRows(s: PtySession): string[] {
  const lines = withoutBar(s.screenText());
  const activity = activityRow(s);
  const end = lines.findIndex((l) => l.startsWith("╭") || (activity !== null && l === activity));
  return lines.slice(0, end < 0 ? lines.length : end);
}

type Bg = "default" | `palette:${number}` | `#${string}`;
function bgAt(s: PtySession, y: number, x: number): Bg {
  const cell = s.cell(y, x)!;
  if (cell.isBgDefault()) return "default";
  if (cell.isBgPalette()) return `palette:${cell.getBgColor()}`;
  return `#${cell.getBgColor().toString(16).padStart(6, "0")}`;
}
/** A row's backgrounds, up to the scroll bar's column (the region's last; spec tui-layout
 *  "Conversation scrollbar"): the right margin is included and is never filled. */
const rowBgs = (s: PtySession, y: number) => Array.from({ length: s.cols - 1 }, (_, x) => bgAt(s, y, x));

describe("items in start order, updated in place (task 7.1)", () => {
  test("basic turn: each item once, behind its gutter, in start order, presented as specified", async () => {
    run = startCli({ scenario: "basic" });
    const s = run.session;
    await sendPrompt(s, "hello there");
    await answerPermission(s, "1");
    await s.waitFor(/end turn/, 10000);
    await settle(s);
    expect(s.term.buffer.active.type).toBe("alternate");

    const rows = conversationRows(s);
    const expected: (string | RegExp)[] = [
      // The user card: its accent cell and two columns of padding, then the text.
      "   hello there",
      "  Streamed answer",
      "  This is the first paragraph of the answer, explaining the change.",
      "  ● item one",
      "  Before the escape sequence.After it, unharmed. Permission: execute rm -rf /",
      // The finished thought and read are one run: a group line (compact density).
      /^ {2}▸ 1 thought · 1 read · \d+\.\ds$/,
      /^ {2}← ✓ edit {5}Edit src\/index\.ts +\+12 -3 {2}(\d+\.\ds {2})?#2$/,
      "  #2 permission  allow once  Edit src/index.ts",
      "  plan 2/3",
      /^ {2}end turn · \d+\.\ds · ctx 38k\/200k$/,
    ];
    for (const line of expected) expect({ line: String(line), n: count(s, line) }).toEqual({ line: String(line), n: 1 });
    // Tool lines fill the width, with the index at the right edge, before the right margin and
    // the scroll bar.
    expect(rows.filter((r) => /#\d$/.test(r) && r.length === s.cols - 3)).toHaveLength(1);

    // Every row starts with a gutter: agent text never reaches column 0.
    for (const row of rows) if (row !== "") expect(row.startsWith("  ")).toBe(true);
    // Start order: user, message, thought, tools as started, the permission outcome, plan, turn end.
    const at = (text: string | RegExp) => rows.findIndex((r) => (typeof text === "string" ? r.includes(text) : text.test(r)));
    const order = ["hello there", "Streamed answer", "▸ 1 thought · 1 read", /#2$/, "permission  allow once", "plan 2/3", "end turn"].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(s.rawOutput()).not.toContain("\x1b]52;");

    // Opening the group in place lists its members in start order, each once: the thought, then
    // the read behind its gutter with the index at the right edge.
    const group = s.findLine(/^ {2}▸ 1 thought · 1 read/);
    s.mouseClick(10, group);
    await settle(s);
    expect(s.lineText(group)).toMatch(/^ {2}▾ 1 thought · 1 read/);
    expect(s.lineText(group + 1)).toBe("  ○ Thought · 11 words");
    expect(s.lineText(group + 2)).toMatch(/^ {2}→ ✓ read {5}Read src\/index\.ts +(\d+\.\ds {2})?#1$/);
    // The width less the two-column right margin and the scroll bar's column.
    expect(lineWithoutBar(s, group + 2)).toHaveLength(s.cols - 3);
    expect(count(s, /#1$/)).toBe(1);

    // Colours come from theme tokens: the heading in `markdown.heading.1` (ANSI 4, bold), body text
    // in the default foreground, `✓` in `tool.ok` (ANSI 2).
    const cellAt = (text: string, offset = 0) => {
      const y = s.findLine(text);
      return s.cell(y, s.lineText(y).indexOf(text) + offset)!;
    };
    const heading = cellAt("Streamed answer");
    expect([heading.isFgPalette(), heading.getFgColor(), heading.isBold() !== 0]).toEqual([true, 4, true]);
    expect(cellAt("This is the first paragraph").isFgDefault()).toBe(true);
    const ok = cellAt("✓ edit");
    expect([ok.isFgPalette(), ok.getFgColor()]).toEqual([true, 2]);
  }, 30000);

  test("Tools completing out of order: #1 stays above #2, #2 shows ✓ first, #1 changes in place", async () => {
    // Delay scale 100: t1 completes 1 s after t2.
    run = startCli({ scenario: "basic", delayScale: 100 });
    const s = run.session;
    await sendPrompt(s, "tools please");
    const one = new RegExp(`^ {2}→ ${SPINNER} read {5}Read src/index\\.ts +#1$`);
    await s.waitFor((p) => p.screenText().some((l) => one.test(l)), 10000);
    await answerPermission(s, "1");
    await s.waitFor(/^ {2}← ✓ edit/m, 10000);
    await s.flush();
    const lines = s.screenText();
    const running = lines.findIndex((l) => one.test(l));
    const done = lines.findIndex((l) => /^ {2}← ✓ edit .*#2$/.test(l));
    expect(running).toBeGreaterThan(0);
    expect(done).toBe(running + 1);
    expect(activityRow(s)).toBe("  1 running: Read src/index.ts");

    await s.waitFor(/end turn/, 10000);
    await settle(s);
    const after = s.screenText();
    // #1 finished, so it joined the thought's run: the group line stands where they were, above #2,
    // and #1's own line is behind it.
    const groupLine = after.findIndex((l) => /^ {2}▸ 1 thought · 1 read · \d+\.\ds$/.test(l));
    expect(groupLine).toBeGreaterThan(0);
    expect(after[groupLine + 1]).toMatch(/^ {2}← ✓ edit .*#2$/);
    expect(count(s, /#1$/)).toBe(0);
    expect(count(s, /^ {2}○ Thought/)).toBe(0);
  }, 30000);

  test("Streaming in place: paragraphs show before the message ends, and every row appears once", async () => {
    // Delay scale 200: 1 s between message 1's paragraphs and message 2.
    run = startCli({ scenario: "basic", delayScale: 200 });
    const s = run.session;
    await sendPrompt(s, "stream it");
    await s.waitFor((p) => p.screenText().includes("  This is the first paragraph of the answer, explaining the change."), 5000);
    await s.flush();
    expect(s.screenText().some((l) => l.includes("item one"))).toBe(false);
    expect(s.screenText().some((l) => /running/.test(l))).toBe(true);
    expect(count(s, "  Streamed answer")).toBe(1);

    await answerPermission(s, "1");
    await s.waitFor(/end turn/, 15000);
    await settle(s);
    const rows = conversationRows(s).filter((r) => r !== "");
    expect(new Set(rows).size).toBe(rows.length);
    // The code line sits after the code block's padding columns (the flat theme's rule and a space).
    for (const line of ["  This is the second paragraph, with a little more detail and rationale.", "  ● item three", "  ▎ console.log(answer);"]) {
      expect(count(s, line)).toBe(1);
    }
  }, 30000);

  test("Completed edit: the edit glyph, ✓, `edit`, the path, `+12 -3`, the duration and the index", async () => {
    run = startCli({ scenario: "basic", cols: 63, rows: 30 });
    const s = run.session;
    await sendPrompt(s, "edit");
    await answerPermission(s, "1");
    await s.waitFor(/end turn/, 10000);
    await settle(s);
    // The edit waited for the permission answer (at least 300 ms), so its duration is shown.
    const line = withoutBar(s.screenText()).find((l) => /Edit src\/index\.ts +\+12/.test(l))!;
    expect(line).toMatch(/^ {2}← ✓ edit {5}Edit src\/index\.ts +\+12 -3 {2}\d+\.\ds {2}#2$/);
    expect(line).toHaveLength(60);
    const y = s.findLine(/Edit src\/index\.ts +\+12/);
    // The index's `#` in the conversation's 59th column (0-based 58), before the margin and the bar.
    const index = s.cell(y, 58)!;
    expect([index.getChars(), index.isFgPalette(), index.getFgColor()]).toEqual(["#", true, 8]);
  }, 30000);

  test("Running tool: its spinner animates while the rest of the screen stays unchanged", async () => {
    // The permission request holds both tools running.
    run = startCli({ scenario: "basic" });
    const s = run.session;
    await sendPrompt(s, "spin");
    await s.waitFor(CARD_HEADER, 10000);
    await settle(s, 400);
    const y = s.findLine(/Read src\/index\.ts/);
    const frames = new Set<string>();
    const masked: string[] = [];
    for (let i = 0; i < 8; i++) {
      await Bun.sleep(70);
      await s.flush();
      frames.add(s.cell(y, 4)!.getChars());
      masked.push(JSON.stringify(s.screenText().map((l) => l.replace(spinnerCells, "*"))));
    }
    expect(frames.size).toBeGreaterThan(1);
    for (const frame of frames) expect(DEFAULT_GLYPHS.spinner).toContain(frame);
    // Nothing else changed: no other cell differs between the eight looks.
    expect(new Set(masked).size).toBe(1);
  }, 30000);

  test("cancelled permission: the outcome reads `cancelled`, tools the turn ended on read `stop`", async () => {
    run = startCli({ scenario: "basic" });
    const s = run.session;
    await sendPrompt(s, "cancel me");
    await s.waitFor(/requires_action/, 10000);
    await Bun.sleep(100);
    // The card has focus: Esc returns to the prompt box and arms interrupt in one press, and a
    // second Esc cancels (mvp-chrome-and-keys task 3.4).
    s.sendKeys("Esc");
    await s.waitFor(() => run!.events("key_action").some((e) => e["action"] === "back"), 5000);
    await s.waitFor(/esc again to interrupt/, 5000);
    s.sendKeys("Esc");
    await s.waitFor(/cancelled · \d/, 10000);
    await settle(s);
    expect(count(s, "  #2 permission  cancelled  Edit src/index.ts")).toBe(1);
    expect(count(s, /^ {2}cancelled · \d+\.\ds$/)).toBe(1);
    expect(count(s, /^ {2}← stop edit {5}Edit src\/index\.ts +#2$/)).toBe(1);
    // The read the turn ended on is behind the group line it joined; opening it shows `stop`.
    const group = s.findLine(/^ {2}▸ 1 thought · 1 read$/);
    s.mouseClick(10, group);
    await settle(s);
    expect(count(s, /^ {2}→ stop read {5}Read src\/index\.ts +#1$/)).toBe(1);
  }, 30000);

  test("prompt error and agent exit: one error line each", async () => {
    run = startCli({ scenario: "prompt-error" });
    let s = run.session;
    await sendPrompt(s, "fail please");
    await s.waitFor(/error: /, 10000);
    await settle(s);
    const errors = s.screenText().filter((l) => l.includes("error: "));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.startsWith("  error: ")).toBe(true);
    expect(errors[0]).toContain("prompt-error scenario always fails");
    run.session.kill("SIGTERM");
    await run.session.dispose();

    run = startCli({ scenario: "crash" });
    s = run.session;
    await sendPrompt(s, "crash please");
    await s.waitFor(/agent exited \(code 3\)/, 10000);
    await settle(s);
    expect(count(s, "  About to crash.")).toBe(1);
    expect(count(s, "  agent exited (code 3)")).toBe(1);
  }, 40000);
});

describe("sanitised content behind a role gutter (task 7.2)", () => {
  test("Agent text imitating chrome: `Permission:` starts behind the agent gutter, on the default background", async () => {
    run = startCli({ scenario: "basic", colours: DARK });
    const s = run.session;
    await sendPrompt(s, "imitate");
    await answerPermission(s, "1");
    await s.waitFor(/end turn/, 10000);
    await settle(s);
    const y = s.findLine("Permission: execute rm -rf /");
    expect(y).toBeGreaterThanOrEqual(0);
    // mvp-rendering: a soft break is a space, so the imitation joins the line before it.
    expect(s.lineText(y)).toBe("  Before the escape sequence.After it, unharmed. Permission: execute rm -rf /");
    expect(s.screenText().some((l) => l.startsWith("Permission:"))).toBe(false);
    expect(rowBgs(s, y).every((b) => b === "default")).toBe(true);
  }, 30000);

  test("Hostile output: no escape sequence from agent text reaches the terminal; still on the alternate screen, mouse modes as set", async () => {
    run = startCli({ scenario: "hostile", cols: 63, rows: 40 });
    const s = run.session;
    await s.waitFor(READY, 10000);
    await settle(s);
    const modesBefore = s.mouseModesSet();
    const mark = s.rawOutput().length;
    await sendPrompt(s, "hostile");
    await answerPermission(s, "1");
    await s.waitFor(/end turn/, 10000);
    await settle(s);
    const wire = s.rawOutput().slice(mark);

    // No payload's escape sequence, and no OSC but the colour queries and cursor colour of acp-tui
    // and its terminal title (mvp-chrome-and-keys task 7.1: OSC 0, always `acp-tui ...` on one
    // printable line).
    for (const payload of HOSTILE_PAYLOADS.filter((p) => p.text.includes("\x1b"))) {
      expect({ payload: payload.name, found: wire.includes(payload.text) }).toEqual({ payload: payload.name, found: false });
    }
    const oscs = new Set([...wire.matchAll(/\x1b\](\d+);/g)].map((m) => Number(m[1])));
    for (const osc of oscs) expect([0, 10, 11, 12]).toContain(osc);
    for (const [, title] of wire.matchAll(/\x1b\]0;([^\x07\x1b]*)\x07/g)) expect(title).toMatch(/^(?:◊ )?[^\x00-\x1f\x7f-\x9f]+$/);
    for (const sequence of ["\x1b[?1049l", "\x1b[?1000l", "\x1b[?2004l", "\x1b[>4;0m", "\x1b[3J", "\x1b[3;9r"]) {
      expect({ sequence: JSON.stringify(sequence), found: wire.includes(sequence) }).toEqual({ sequence: JSON.stringify(sequence), found: false });
    }
    expect(s.term.buffer.active.type).toBe("alternate");
    expect(s.mouseModesSet()).toEqual(modesBefore);

    // Agent rows sit behind the gutter: nothing the agent wrote starts at column 0.
    const rows = conversationRows(s).filter((r) => r !== "");
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect(row.startsWith("  ")).toBe(true);
    expect(s.screenText().filter((r) => r.startsWith(`╭─ ${CARD_HEADER}`))).toHaveLength(0);
  }, 30000);
});

describe("the terminal's own background outside cards (task 7.7)", () => {
  test("Collapsed items and agent text at 63x21: every cell of those rows outside the cursor's highlight has the default background", async () => {
    run = startCli({ scenario: "basic", cols: 63, rows: 21, colours: DARK });
    const s = run.session;
    await sendPrompt(s, "colours");
    await answerPermission(s, "1");
    await s.waitFor(/end turn/, 10000);
    await settle(s);
    const surfaces = deriveSurfaces(DARK);
    const check = (skip: number | null) => {
      const rows = conversationRows(s);
      let agent = 0;
      let tools = 0;
      rows.forEach((row, y) => {
        if (y === skip) return;
        // The user card (the accent cell in column 0) is a card; every other row is agent text
        // or a collapsed item.
        if (bgAt(s, y, 0).startsWith("palette")) return;
        // A code block is on its own surface (mvp-rendering, tui-theme "Code block on its
        // surface"): the gutter on the default background, the rest on surface.code.
        if (bgAt(s, y, 2) === surfaces["surface.code"]) {
          expect({ y, row, bgs: [...new Set(rowBgs(s, y))] }).toEqual({ y, row, bgs: ["default", surfaces["surface.code"] as Bg] });
          return;
        }
        expect({ y, row, bgs: [...new Set(rowBgs(s, y))] }).toEqual({ y, row, bgs: ["default"] });
        if (/#\d$/.test(row) || /^ {2}[▸▾] /.test(row)) tools++;
        else if (row !== "") agent++;
      });
      expect(tools).toBeGreaterThanOrEqual(2);
      // 12 conversation rows at 63x21 since the margins and the row budget (mvp-chrome-and-keys
      // tasks 4.1 and 4.2), 17 before.
      expect(agent).toBeGreaterThanOrEqual(3);
    };
    check(null);

    // With the conversation focused, the cursor (on the last item) is the only highlight: the
    // faint fill across the row and the `▎` bar in surface.cursor's colour in column 0 (review C5).
    s.sendKeys("Tab");
    const last = s.findLine(/end turn/);
    await s.waitFor((p) => bgAt(p, last, 5) !== "default", 5000);
    // The faint fill across the conversation's width; the right margin keeps the default background.
    expect([...new Set(rowBgs(s, last).slice(0, s.cols - 3))]).toEqual([surfaces["surface.cursor.faint"] as Bg]);
    expect([...new Set(rowBgs(s, last).slice(s.cols - 3))]).toEqual(["default"]);
    const bar = s.cell(last, 0)!;
    expect(bar.getChars()).toBe("▎");
    expect(`#${bar.getFgColor().toString(16).padStart(6, "0")}`).toBe(surfaces["surface.cursor"]);
    check(last);
  }, 30000);
});
