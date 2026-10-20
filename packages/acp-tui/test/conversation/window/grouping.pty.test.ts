// Grouping in the windowed list (spike S3, task 12.4) through the real CLI on
// fake-agent's long-session: runs
// of reads, searches and thoughts show as one line such as
// `▸ 1 thought · 5 reads · 1 search`; Enter on it (the conversation cursor)
// or a click opens it in place, listing one row per member below it, and
// closes it again, the line staying on its screen row.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../../pty/harness.ts";
import { sendPrompt, settle, startCli, type CliRun } from "../cli.ts";
import { lineWithoutBar, withoutBar } from "../../pty/regions.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const GROUP = /^ {2}([▸▾]) ((?:\d+ (?:reads?|searches|search|fetch(?:es)?|thoughts?|thinks?))(?: · \d+ (?:reads?|searches|search|fetch(?:es)?|thoughts?|thinks?))*)(?: · \d+\.\ds)?$/;
/** A member row: a read, search, fetch or think call, or a thought. */
const MEMBER = /^ {2}(?:[→*%○] ✓ (?:read|search|fetch|think) |○ Thought)/;

function conversationRows(s: PtySession): string[] {
  const lines = withoutBar(s.screenText());
  const end = lines.findIndex((l) => l.startsWith("╭"));
  return lines.slice(0, end < 0 ? lines.length : end);
}

/** The row of the cursor under the flat theme (its gutter in inverse video). */
function cursorRow(s: PtySession): number {
  return conversationRows(s).findIndex((_, y) => s.cell(y, 0)!.isInverse() !== 0);
}

async function press(s: PtySession, ...keys: Parameters<PtySession["sendKeys"]>): Promise<void> {
  s.sendKeys(...keys);
  await settle(s, 60);
}

/** Members a group line counts. */
function memberCount(line: string): number {
  return [...GROUP.exec(line)![2]!.matchAll(/(\d+) /g)].reduce((n, m) => n + Number(m[1]), 0);
}

describe("grouping runs of reads, searches and thoughts (task 12.4)", () => {
  test("one line per run; Enter and a click open it with its members below and close it again, on the same row", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30 });
    const s = run.session;
    await sendPrompt(s, "history");
    await s.waitFor(/end turn/, 20000);
    await settle(s);

    // Tab into the conversation, then up until the cursor is on a group line with a thought in the
    // upper half.
    await press(s, "Tab");
    let y = -1;
    for (let i = 0; i < 80; i++) {
      await press(s, "Up");
      y = cursorRow(s);
      if (y >= 0 && y < 12 && GROUP.test(lineWithoutBar(s, y)) && / thoughts? /.test(lineWithoutBar(s, y))) break;
    }
    const line = lineWithoutBar(s, y);
    expect(line).toMatch(GROUP);
    expect(GROUP.exec(line)![1]).toBe("▸");
    const n = memberCount(line);
    expect(n).toBeGreaterThanOrEqual(2);
    // No member rows below a closed group.
    expect(lineWithoutBar(s, y + 1)).not.toMatch(MEMBER);

    // Enter opens it: the same row reads ▾, followed by one row per member.
    await press(s, "Enter");
    expect(lineWithoutBar(s, y)).toBe(line.replace("▸", "▾"));
    const members = conversationRows(s).slice(y + 1, y + 1 + n);
    expect(members).toHaveLength(n);
    for (const row of members) expect(row).toMatch(MEMBER);
    expect(cursorRow(s)).toBe(y);
    // The thought's line is drawn in the `thought` token's italic (a span's attributes reach the
    // screen as SGR 3; spans take flags, not a mask).
    const thought = members.findIndex((r) => /^ {2}○ Thought/.test(r));
    expect(thought).toBeGreaterThanOrEqual(0);
    expect(s.cell(y + 1 + thought, 4)!.isItalic()).not.toBe(0);
    expect(s.cell(y, 4)!.isItalic()).toBe(0);

    // Enter closes it again.
    await press(s, "Enter");
    expect(lineWithoutBar(s, y)).toBe(line);
    expect(lineWithoutBar(s, y + 1)).not.toMatch(MEMBER);

    // A click on the line toggles it too (press and release on the same line). A second click on
    // the same cell within 400 ms would be a double click (selection), so the clicks are spaced.
    s.mouseClick(10, y);
    await settle(s, 60);
    expect(lineWithoutBar(s, y)).toBe(line.replace("▸", "▾"));
    expect(conversationRows(s).slice(y + 1, y + 1 + n).every((r) => MEMBER.test(r))).toBe(true);
    await Bun.sleep(450);
    s.mouseClick(10, y);
    await settle(s, 60);
    expect(lineWithoutBar(s, y)).toBe(line);
    // Nothing reached the agent.
    expect(run.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);
  }, 60000);
});
