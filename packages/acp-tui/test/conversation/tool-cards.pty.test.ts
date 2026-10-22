// mvp-rendering tasks 9.1 to 9.4 through the real CLI against fake-agent under the PTY harness:
// the scenarios "Long command", "Fenced output", "Large output", "Show all" and "Collapse restores
// the snippet" over `tool-content` (spec tui-rendering "Expanded tool card", "Output snippets"),
// and "Short answer" (now collapsed, review C16) and "Plan in a thought" over `short-answer` (spec
// "Thoughts", S7 session D4).
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { sendPrompt, startCli, type CliRun } from "./cli.ts";
import { lineWithoutBar, withoutBar } from "../pty/regions.ts";

// Imported by a computed path: acp-tui does not depend on the fake-agent package.
const FAKE_AGENT = join(import.meta.dir, "../../../fake-agent/src");
const { TOOL_CONTENT_COMMAND, TOOL_CONTENT_OUTPUT_LINES, TOOL_CONTENT_REFUSAL } = (await import(join(FAKE_AGENT, "scenarios/tool-content.ts"))) as {
  TOOL_CONTENT_COMMAND: string;
  TOOL_CONTENT_OUTPUT_LINES: readonly string[];
  TOOL_CONTENT_REFUSAL: string;
};

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

/** The conversation's rows: everything above the prompt box. */
function conversationRows(s: PtySession): string[] {
  const lines = withoutBar(s.screenText());
  const end = lines.findIndex((l) => l.startsWith("╭"));
  return lines.slice(0, end < 0 ? lines.length : end);
}

/** The card's text on a row: the gutter and the flat card rule taken off. */
// The card's rule and its two columns of padding (`cards.padding.columns`, day-one-feedback).
const cardText = (row: string) => row.replace(/^ {2}┃(?: {2})?/, "");

/** The row of the cursor under the flat theme (its gutter in inverse video), or -1. */
function cursorRow(s: PtySession): number {
  return conversationRows(s).findIndex((_, y) => s.cell(y, 0)!.isInverse() !== 0);
}

/** The cursor's row and the text on it: what a cursor key changes. */
function cursorAt(s: PtySession): string {
  const y = cursorRow(s);
  return y < 0 ? "" : `${y}:${lineWithoutBar(s, y)}`;
}

/** A key that moves the cursor (Tab into the conversation, `[` to the previous tool call), then
 *  the cursor drawn somewhere else: each key's outcome is waited for before the next is sent. */
async function move(s: PtySession, key: Parameters<PtySession["sendKeys"]>[0]): Promise<void> {
  const before = cursorAt(s);
  s.sendKeys(key);
  await s.waitFor((p) => cursorAt(p) !== "" && cursorAt(p) !== before, 5000);
}

/** A key, then `outcome` on screen. */
async function press(s: PtySession, key: Parameters<PtySession["sendKeys"]>[0], outcome: (s: PtySession) => boolean): Promise<void> {
  s.sendKeys(key);
  await s.waitFor(outcome, 5000);
}

const screen = (s: PtySession): string => s.screenText().join("\n");

async function toolContent(): Promise<PtySession> {
  // 66 columns: a 63-column conversation once the right margin and the scroll bar have their three
  // columns, so the fenced output's longest line fits the card unwrapped, as the scenario was drawn.
  run = startCli({ scenario: "tool-content", cols: 66, rows: 40 });
  const s = run.session;
  await sendPrompt(s, "go");
  await s.waitFor(/end turn/, 20000);
  return s;
}

describe("tool cards (tasks 9.1 to 9.3)", () => {
  test("Long command and Fenced output: the whole command wrapped, then the five lines under the label `console`, no backticks", async () => {
    const s = await toolContent();
    // The refused call failed and stays collapsed (no call expands itself); Ctrl+O expands the
    // latest call, which it is: its text without backticks. Ctrl+O again collapses it.
    expect(screen(s)).not.toContain(TOOL_CONTENT_REFUSAL);
    await press(s, "Ctrl+O", (p) => screen(p).includes(TOOL_CONTENT_REFUSAL));
    expect(screen(s)).not.toContain("```");
    await press(s, "Ctrl+O", (p) => !screen(p).includes(TOOL_CONTENT_REFUSAL));
    // The cursor onto #1 (from the turn end: four tool calls back) and Enter.
    await move(s, "Tab");
    for (let i = 0; i < 4; i++) await move(s, { text: "[" });
    expect(lineWithoutBar(s, cursorRow(s))).toMatch(/#1$/);
    const headerOf = (p: PtySession) => conversationRows(p).findIndex((r) => /\$ ✓ execute .*#1$/.test(r));
    // Expanded: the fence's last line in the card below the header.
    const last = TOOL_CONTENT_OUTPUT_LINES.at(-1)!;
    await press(s, "Enter", (p) => headerOf(p) >= 0 && conversationRows(p).slice(headerOf(p) + 1).some((r) => cardText(r).trimEnd() === last));
    const rows = conversationRows(s);
    const header = headerOf(s);
    expect(header).toBeGreaterThanOrEqual(0);
    // The collapsed line cuts the command; the card shows all of it, wrapped, no ellipsis, after its
    // top padding row (review C13 and C14).
    expect(rows[header]).toContain("…");
    expect(cardText(rows[header + 1]!)).toBe("");
    const title = rows.slice(header + 2, header + 5).map(cardText);
    expect(title.join(" ")).toBe(TOOL_CONTENT_COMMAND);
    expect(title.join("")).not.toContain("…");
    expect(cardText(rows[header + 5]!)).toBe("");
    // The fence: a row with the label alone (the first line reaches it), then the five lines.
    const card = rows.slice(header + 6).map(cardText);
    expect(card[0]!.trim()).toMatch(/console$/);
    const lines = card.slice(1, 6).map((r) => r.trimEnd());
    expect(lines).toEqual([...TOOL_CONTENT_OUTPUT_LINES]);
    expect(rows.join("\n")).not.toContain("```");
  }, 40000);

  test("Large output, Show all and Collapse restores the snippet: the marker names 4990 hidden rows and the key; `a` shows all 5000 lines and back; a click on the marker too", async () => {
    const s = await toolContent();
    await move(s, "Tab");
    await move(s, { text: "[" });
    await move(s, { text: "[" });
    expect(lineWithoutBar(s, cursorRow(s))).toMatch(/#3$/);
    const header = () => conversationRows(s).findIndex((r) => /Run the full test suite .*#3$/.test(r));
    const marker = () => conversationRows(s).findIndex((r) => r.includes("4990 rows hidden"));
    // Expanded: the snippet's marker, then its last line, below the header.
    const snippet = () => header() >= 0 && marker() > header() && screen(s).includes("test 5000 ... ok");
    await press(s, "Enter", snippet);
    let rows = conversationRows(s);
    expect(header()).toBeGreaterThanOrEqual(0);
    expect(marker()).toBeGreaterThan(header());
    expect(cardText(rows[marker()]!)).toBe("4990 rows hidden · a or click here to show all");
    // Only `here` is underlined (review C18).
    const base = s.term.buffer.active.baseY;
    const markerLine = rows[marker()]!;
    const underlined = [...markerLine].flatMap((_, x) => (s.cell(base + marker(), x)?.isUnderline() ? [x] : []));
    const here = markerLine.indexOf("here");
    expect(underlined).toEqual([here, here + 1, here + 2, here + 3]);
    const shown = rows.slice(marker() + 1, marker() + 11).map((r) => cardText(r).trim());
    expect(shown).toEqual(Array.from({ length: 10 }, (_, i) => `test ${4991 + i} ... ok`));

    // Show all: the marker is gone and the output starts at its first line, under the header.
    await press(s, { text: "a" }, (p) => marker() === -1 && screen(p).includes("test 1 ... ok"));
    rows = conversationRows(s);
    expect(marker()).toBe(-1);
    const first = rows.findIndex((r) => r.includes("test 1 ... ok"));
    expect(first).toBeGreaterThan(header());
    // The first row also carries the fence's label at its right.
    expect(rows.slice(first, first + 3).map((r) => cardText(r).trim())).toEqual([expect.stringMatching(/^test 1 \.\.\. ok +console$/), "test 2 ... ok", "test 3 ... ok"]);
    // Again: the snippet.
    await press(s, { text: "a" }, snippet);
    expect(marker()).toBeGreaterThan(header());
    expect(s.screenText().join("\n")).not.toContain("test 1 ... ok");

    // A click on the marker row shows it all too; nothing was sent to the agent.
    s.mouseClick(10, marker());
    await s.waitFor((p) => marker() === -1 && screen(p).includes("test 1 ... ok"), 5000);
    expect(marker()).toBe(-1);
    expect(s.screenText().join("\n")).toContain("test 1 ... ok");
    expect(run!.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);

    // Collapse restores the snippet (review C19): collapsed and expanded again, the card shows the
    // snippet and its marker row.
    // Collapsed: the card and all its output gone, the header kept.
    await press(s, "Enter", (p) => !screen(p).includes("test 1 ... ok") && !screen(p).includes("test 5000 ... ok"));
    expect(header()).toBeGreaterThanOrEqual(0);
    expect(screen(s)).not.toContain("test 4991 ... ok");
    await press(s, "Enter", snippet);
    expect(marker()).toBeGreaterThan(header());
    expect(screen(s)).not.toContain("test 1 ... ok");
  }, 40000);
});

describe("thoughts (task 9.4)", () => {
  test("Short answer: the thought starts collapsed; Plan in a thought: expanded by the user, its plan is an ordered list, and the user's toggle survives a resize", async () => {
    run = startCli({ scenario: "short-answer", cols: 63, rows: 40 });
    const s = run.session;
    await sendPrompt(s, "go");
    await s.waitFor(/end turn/, 20000);
    const plan = ["1. Read README.md and summarise it", "2. Record a three-step plan with TodoWrite", "3. Run touch s7-probe.txt"];
    let text = s.screenText().join("\n");
    // Collapsed (review C16): none of the plan is shown, the one-sentence answer is.
    for (const line of plan) expect(text).not.toContain(line);
    expect(text).toContain("Steps 1 and 3 ran");

    // The thought may sit in a run with the read (compact): open the group line first.
    const thoughtLine = () => s.findLine(/○ Thought: Planning the S7 steps/);
    if (thoughtLine() < 0) {
      const group = s.findLine(/▸ .*thought/);
      expect(group).toBeGreaterThanOrEqual(0);
      s.mouseClick(10, group);
      await s.waitFor(() => thoughtLine() >= 0, 5000);
    }
    s.mouseClick(10, thoughtLine());
    await s.waitFor((p) => p.screenText().join("\n").includes(plan[0]!), 5000);
    text = s.screenText().join("\n");
    for (const line of plan) expect(text).toContain(line);
    expect(text).not.toMatch(/\*\*|`/);

    // Expanded by the user, it stays expanded across a resize.
    // The frame at the new width: the prompt box's top border reaches further.
    const border = () => s.screenText().find((l) => l.startsWith("╭"))?.length ?? 0;
    const narrow = border();
    s.resize(80, 40);
    await s.waitFor(() => border() > narrow, 5000);
    text = s.screenText().join("\n");
    expect(text).toContain("Thought: Planning the S7 steps");
    expect(text).toContain(plan[0]!);
  }, 40000);
});
