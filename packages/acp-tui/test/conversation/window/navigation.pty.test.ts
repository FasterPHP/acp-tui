// The conversation's navigation and density through the real CLI (mvp-conversation tasks 3.1, 3.3,
// 3.4, 4.2, 4.4 and 4.5; spec tui-conversation "Scrolling and following", "Reading position kept",
// "Grouping of quiet runs", "Switching density", "Jumps between prompts and tool calls"):
// the `↓ N new` indicator over fake-agent's `grouping` scenario, out-of-order completion inside a
// run, the jump keys over a 1000-item `long-session`, and a density chosen from the palette.
import { afterEach, describe, expect, test } from "bun:test";
import { createSession, reduce, type Item, type Session } from "acp-model";
import { buildEntries, groupLine, jumpTarget, type EntryList, type GroupEntry } from "../../../src/conversation/window/entries.ts";
import type { PtySession } from "../../pty/harness.ts";
import { activityRow, promptBox, READY, REQUIRES_ACTION, screenGap, statusRow } from "../../pty/regions.ts";
import { answerPermission, sendPrompt, settle, startCli, type CliRun } from "../cli.ts";
import { longSessionEvents } from "./session.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

/** The rows above the activity bar, card or prompt box. */
function conversationRows(s: PtySession): string[] {
  const lines = s.screenText();
  const activity = activityRow(s);
  let end = lines.findIndex((l) => l.startsWith("╭") || (activity !== null && l === activity));
  // Less the activity bar's line, which keeps its row for the whole session (day-two-feedback
  // 13.2), and the screen's blank row above it.
  if (end > 0 && !(activity !== null && lines[end] === activity)) end--;
  if (end > 0 && screenGap(s, end - 1)) end--;
  return lines.slice(0, end < 0 ? lines.length : end);
}

/** The prompt box's top border, where the `↓ N new` indicator is drawn. */
const topBorder = (s: PtySession): string => promptBox(s)[0] ?? "";

/** The row of the cursor under the flat theme: its gutter (column 0), or the cell beside a user
 *  card's accent (column 1), in inverse video. */
function cursorRow(s: PtySession): number {
  return conversationRows(s).findIndex((_, y) => s.cell(y, 0)!.isInverse() !== 0 || s.cell(y, 1)!.isInverse() !== 0);
}

async function press(s: PtySession, ...keys: Parameters<PtySession["sendKeys"]>): Promise<void> {
  s.sendKeys(...keys);
  await settle(s, 60);
}

/** A prompt that wraps to about six rows at 80 columns, so the turn is taller than the
 *  conversation even after the permission card closes (a shorter one would fit, and a reader at
 *  the top of content that fits is at the bottom: following). */
const LONG_PROMPT = "Please look at the router and its wiring, then reload the configuration. ".repeat(6).trim();

/** Runs `grouping` to its permission request at 80x16 (the conversation 8 rows at rest and 2 with
 *  the card open and the activity bar's two rows: at 80x14 before the activity bar's blank row and the
 *  prompt box's padding row, day-one-feedback), scrolls the reader to the top of the turn
 *  with the wheel and returns once the screen has settled. */
async function scrolledUpAtPermission(delayScale: number): Promise<PtySession> {
  run = startCli({ scenario: "grouping", cols: 80, rows: 16, delayScale });
  const s = run.session;
  await sendPrompt(s, LONG_PROMPT);
  await s.waitFor(REQUIRES_ACTION, 30000);
  await settle(s);
  expect(topBorder(s)).not.toContain("↓");
  // Row 1: the first conversation row, below the top margin.
  for (let i = 0; i < 6; i++) s.mouseWheel(10, 1, 64);
  await s.waitFor((p) => /scrolled/.test(statusRow(p)), 5000);
  await settle(s);
  expect(topBorder(s)).not.toContain("↓");
  return s;
}

describe("the ↓ N new indicator (task 3.1) and the reading position over a run (task 3.4)", () => {
  // Scenario "New entries below": the card is open, the reader scrolls up, the agent adds three
  // tool calls (and the permission record) below.
  test("New entries below: the count, the view held while reads finish and a run forms below, a click brings the bottom", async () => {
    const s = await scrolledUpAtPermission(25);

    // The permission record and reads #3 to #5 arrive below: four entries. The card closes and
    // the conversation grows; the reader stays at the top of the turn.
    await answerPermission(s, "1");
    await s.waitFor((p) => topBorder(p).includes("↓ 4 new"), 10000);
    await settle(s, 100);
    const top = conversationRows(s).slice(0, 3);
    expect(top.join("\n")).toContain("Please look");
    // Reads finish out of order and form a run below the reader (about three seconds), and the
    // turn ends (the fifth entry): the first rows never move.
    for (let i = 0; i < 400 && !topBorder(s).includes("↓ 5 new"); i++) {
      await Bun.sleep(40);
      await s.flush();
      expect(conversationRows(s).slice(0, 3)).toEqual(top);
    }
    expect(topBorder(s)).toContain("↓ 5 new");
    expect(conversationRows(s).slice(0, 3)).toEqual(top);
    expect(statusRow(s)).toMatch(/scrolled \d+%/);

    // A click on the indicator brings the bottom into view and removes it.
    const y = s.screenText().map((l) => l.startsWith("╭")).lastIndexOf(true);
    s.mouseClick(topBorder(s).indexOf("↓") + 2, y);
    await s.waitFor((p) => !topBorder(p).includes("↓") && !/scrolled/.test(statusRow(p)), 5000);
    await settle(s);
    expect(conversationRows(s).some((r) => /end turn/.test(r))).toBe(true);
    expect(run!.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);
  }, 90000);

  test("End from the conversation resumes following and removes the indicator", async () => {
    const s = await scrolledUpAtPermission(5);
    await answerPermission(s, "1");
    await s.waitFor((p) => topBorder(p).includes("↓ 5 new"), 30000);
    await s.waitFor(READY, 5000);
    // Tab into the conversation, End: the bottom, following, no indicator.
    await press(s, "Tab");
    await press(s, "End");
    await s.waitFor((p) => !topBorder(p).includes("↓"), 5000);
    expect(statusRow(s)).not.toMatch(/scrolled/);
    expect(conversationRows(s).some((r) => /end turn/.test(r))).toBe(true);
  }, 60000);

  // Scenario "Out-of-order completion inside a run" (decision 4), following the bottom at 100x30:
  // reads #3 to #5 complete in the order #5, #3, #4; every sample of the screen shows each call
  // once, in start order, and a group line only after #4 has completed.
  test("Out-of-order completion inside a run: each call once at every moment, in start order, grouped only when all three are done", async () => {
    run = startCli({ scenario: "grouping", cols: 100, rows: 30, delayScale: 25 });
    const s = run.session;
    await sendPrompt(s, "go");
    await s.waitFor(REQUIRES_ACTION, 20000);
    await answerPermission(s, "1");

    const read = /Read src\/file-([345])\.php/;
    const finished = /→ ✓ read/;
    const frames = { allLive: 0, fiveDone: 0, fiveAndThreeDone: 0, grouped: 0 };
    for (let i = 0; i < 600; i++) {
      await Bun.sleep(40);
      await s.flush();
      const rows = conversationRows(s);
      const calls = rows.flatMap((r) => (read.test(r) ? [{ n: Number(read.exec(r)![1]), done: finished.test(r) }] : []));
      // Each call at most once, in the order #3, #4, #5.
      expect(calls.map((c) => c.n)).toEqual([...new Set(calls.map((c) => c.n))].sort());
      // The run's group line (not the first run, which holds two reads): only ever `3 reads`.
      const runLines = rows.filter((r) => /^ {2}[▸▾] \d+ reads?( · \d+\.\ds)?$/.test(r));
      if (runLines.length > 0) {
        expect(runLines).toEqual([expect.stringMatching(/^ {2}▸ 3 reads/)]);
        expect(calls).toEqual([]);
        frames.grouped++;
      } else if (calls.length === 3) {
        const done = calls.map((c) => c.done);
        if (done.every((d) => !d)) frames.allLive++;
        else if (!done[0] && !done[1] && done[2]) frames.fiveDone++;
        else if (done[0] && !done[1] && done[2]) frames.fiveAndThreeDone++;
        else expect(done).toEqual([true, true, true]);
      }
      if (rows.some((r) => /end turn/.test(r))) break;
    }
    // The intermediate states were on screen, and the run formed after #4 completed.
    expect(frames.allLive).toBeGreaterThan(0);
    expect(frames.fiveDone).toBeGreaterThan(0);
    expect(frames.fiveAndThreeDone).toBeGreaterThan(0);
    expect(frames.grouped).toBeGreaterThan(0);

    // Opening the group lists the members in start order.
    await settle(s);
    await press(s, "Tab");
    await press(s, "Up");
    await press(s, "Enter");
    const rows = conversationRows(s);
    const at = rows.findIndex((r) => /^ {2}▾ 3 reads/.test(r));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(rows.slice(at + 1, at + 4).map((r) => read.exec(r)?.[1])).toEqual(["3", "4", "5"]);
  }, 90000);
});

describe("jumps between prompts and tool calls (task 3.3)", () => {
  const ITEMS = 1000;
  let session: Session;
  let list: EntryList;
  const lookup = (id: string): Item | undefined => session.items.get(id);
  const firstLine = (text: string) => text.split("\n")[0]!.trim();

  function model(): void {
    session = createSession();
    for (const event of longSessionEvents(ITEMS)) session = reduce(session, event);
    list = buildEntries(session.order, lookup, { density: "compact", open: () => false });
  }

  async function open(): Promise<PtySession> {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", String(ITEMS)] });
    const s = run.session;
    await sendPrompt(s, "go");
    await s.waitFor(/end turn/, 60000);
    await settle(s);
    return s;
  }

  // Scenario "Previous prompt far back": the user messages of this session are about six entries
  // apart, so sixty presses of `{` reach one about 400 entries back, over unmounted entries.
  test("Previous prompt far back: `{` once, then sixty times, each landing on a user message in view", async () => {
    model();
    const users = list.keys.filter((k) => lookup(k)?.kind === "user_message");
    const text = (key: string) => firstLine((lookup(key) as Extract<Item, { kind: "user_message" }>).text).slice(0, 30);
    const s = await open();
    await press(s, "Tab");
    await press(s, { text: "{" });
    let y = cursorRow(s);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(s.lineText(y)).toContain(text(users.at(-1)!));

    for (let i = 1; i < 60; i++) s.sendKeys({ text: "{" });
    const target = users.at(-60)!;
    // Wait for the cursor on the sixtieth prompt back, not for a quiet screen: under load the CLI
    // can pause mid-burst for longer than `settle` waits.
    await s.waitFor((p) => {
      const row = cursorRow(p);
      return row >= 0 && p.lineText(row).includes(text(target));
    }, 15000);
    expect(list.keys.length - 1 - list.index.get(target)!).toBeGreaterThan(300);
    y = cursorRow(s);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(s.lineText(y)).toContain(text(target));
    expect(statusRow(s)).toMatch(/scrolled \d+%/);

    // `}` goes the other way: the next user message.
    await press(s, { text: "}" });
    expect(s.lineText(cursorRow(s))).toContain(text(users.at(-59)!));
    expect(run!.events("console")).toEqual([]);
    expect(run!.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);
  }, 90000);

  // Scenario "No next tool call".
  test("No next tool call: `[` reaches the last tool call or its group line, `]` then leaves the cursor where it is", async () => {
    model();
    const last = list.keys.at(-1)!;
    const expected = jumpTarget(list, lookup, last, -1, "tool")!;
    expect(expected).toBeDefined();
    const entry = list.entries[list.index.get(expected)!]!;
    const rowText = entry.kind === "group" ? groupLine(entry as GroupEntry, lookup).map((seg) => seg.text).join("") : `#${(lookup(expected) as Extract<Item, { kind: "tool_call" }>).index}`;
    const s = await open();
    await press(s, "Tab");
    await press(s, { text: "[" });
    const y = cursorRow(s);
    expect(y).toBeGreaterThanOrEqual(0);
    const row = s.lineText(y);
    expect(row).toContain(rowText);
    const before = conversationRows(s);
    await press(s, { text: "]" });
    expect(cursorRow(s)).toBe(y);
    expect(s.lineText(y)).toBe(row);
    expect(conversationRows(s)).toEqual(before);
    // `[` from there goes on to the tool call before it.
    await press(s, { text: "[" });
    expect(s.lineText(cursorRow(s))).not.toBe(row);
    expect(run!.events("console")).toEqual([]);
  }, 90000);

  test("the jump keys are text in the prompt box", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", "50"] });
    const s = run.session;
    await sendPrompt(s, "go");
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    await press(s, { text: "{}[]v" });
    expect(promptBox(s)[1]).toContain("{}[]v");
    expect(s.screenText().some((l) => l.includes("density:"))).toBe(false);
  }, 60000);
});

describe("density from the palette (tasks 4.4 and 4.5)", () => {
  // Scenario "Palette and status row" (the palette is product since mvp-chrome-and-keys task 6.1).
  test("cycling the density from the palette marks the status row until it is focus again", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", "200"] });
    const s = run.session;
    await sendPrompt(s, "go");
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    expect(statusRow(s)).not.toContain("density");

    const choose = async (filter: string, title: string) => {
      s.sendKeys("Ctrl+P");
      await s.waitFor(/Commands \d+/, 5000);
      s.sendKeys({ text: filter });
      await s.waitFor((p) => p.screenText().some((l) => l.includes(title)), 5000);
      s.sendKeys("Enter");
      await s.waitFor((p) => !p.screenText().some((l) => l.startsWith("╭─ Commands")), 5000);
      await settle(s, 100);
    };

    // There is one density entry, the cycle (day-two-feedback task 13.7); this test starts in
    // `compact`, so the cycle goes verbose, focus (each marked) and back to compact (no mark).
    await choose("cycle the density", "Cycle the density");
    expect(statusRow(s)).toContain("density: verbose");
    await choose("cycle the density", "Cycle the density");
    expect(statusRow(s)).toContain("density: focus");
    const rows = conversationRows(s);
    expect(rows.some((r) => /^ {2}[▸▾] \d+ tool calls?\b/.test(r))).toBe(true);
    expect(rows.some((r) => /^ {2}. [✓✗] .*#\d+$/.test(r))).toBe(false);
    await choose("cycle the density", "Cycle the density");
    expect(statusRow(s)).not.toContain("density");

    // The cycle key (the conversation has focus after a palette command) goes to verbose.
    await press(s, { text: "v" });
    await s.waitFor((p) => statusRow(p).includes("density: verbose"), 5000);
    expect(run.events("console")).toEqual([]);
  }, 60000);
});
