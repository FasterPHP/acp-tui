// Toggling an entry while the conversation follows the running turn, and Enter revealing a card
// that does not fit (spec tui-conversation "Reading position kept", "Collapse and expand in place";
// design D1) through the real CLI against fake-agent `fast-tools --tools 30`: calls cycle read,
// search, read, execute, read, edit, so the reads and searches between an edit and the next
// execute gather in one group line that grows while the turn runs. Waits end on the screen's text.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { lineWithoutBar, statusRow, withoutBar } from "../pty/regions.ts";
import { settle, sendPrompt, startCli, type CliRun } from "./cli.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const SIZES = [
  { cols: 100, rows: 30 },
  { cols: 63, rows: 21 },
] as const;
const GROUP = /^ {2}[▸▾] \d+ (?:reads?|searches|search)/;
/** The activity line between the conversation and the prompt box. */
const ACTIVITY = /^ {2}(?:\d+ running\b|[✓✗] )/;

/** The conversation's rows: down to the prompt box's top border, less the blank rows and the
 *  activity line above it. */
function conversationRows(s: PtySession): string[] {
  const lines = withoutBar(s.screenText());
  const end = lines.findIndex((l) => l.startsWith("╭"));
  const rows = lines.slice(0, end < 0 ? lines.length : end);
  const trim = () => {
    while (rows.length > 0 && rows.at(-1) === "") rows.pop();
  };
  trim();
  if (rows.length > 0 && ACTIVITY.test(rows.at(-1)!)) rows.pop();
  trim();
  return rows;
}

/** The row of the cursor under the flat theme (its gutter in inverse video). */
function cursorRow(s: PtySession): number {
  return s.screenText().findIndex((_, y) => s.cell(y, 0)!.isInverse() !== 0);
}

/** The highest tool call number (`#n` at a row's end) on screen, or 0. */
function newest(s: PtySession): number {
  return Math.max(0, ...conversationRows(s).map((l) => Number(/#(\d+)$/.exec(l)?.[1] ?? 0)));
}

const overflowed = (s: PtySession): boolean => !conversationRows(s).some((l) => /^ +go$/.test(l));

describe("toggling while following (design D1)", () => {
  for (const size of SIZES) {
    const where = `${size.cols}x${size.rows}`;

    test(`Opening the running turn's tool calls at ${where}: the open group's last member stays on the row above the chrome and following goes on`, async () => {
      run = startCli({ scenario: "fast-tools", delayScale: 2, agentArgs: ["--tools", "30"], ...size });
      const s = run.session;
      await sendPrompt(s, "go");
      // A group that has just begun, as the newest entry, once the conversation overflows.
      await s.waitFor((p) => {
        const rows = conversationRows(p);
        return overflowed(p) && newest(p) >= 12 && /^ {2}▸ 1 read\b/.test(rows.at(-1) ?? "");
      }, 60000);
      s.sendKeys("Tab");
      await s.waitFor((p) => GROUP.test(lineWithoutBar(p, cursorRow(p))), 5000);
      s.sendKeys("Enter");
      await s.waitFor((p) => conversationRows(p).some((l) => /^ {2}▾ /.test(l)), 5000);
      // Each call the turn adds after it: the newest member is the last conversation row and the
      // view has not left the bottom.
      let seen = newest(s);
      for (let i = 0; i < 3; i++) {
        const before = seen;
        // The screen at the moment the next call shows (the busy indicator keeps it from ever
        // being quiet).
        let frame: { last: string | undefined; status: string; newest: number } | undefined;
        await s.waitFor((p) => {
          if (newest(p) <= before) return false;
          frame = { last: conversationRows(p).at(-1), status: statusRow(p), newest: newest(p) };
          return true;
        }, 10000);
        seen = frame!.newest;
        expect(frame!.last).toMatch(new RegExp(`#${seen}$`));
        expect(frame!.status).not.toMatch(/scrolled/);
      }
      expect(run.agentMethods().filter((m) => m === "session/prompt")).toHaveLength(1);
    }, 90000);

    test(`Expansion taller than the room below at ${where}: the group line goes to the top row and following stops`, async () => {
      run = startCli({ scenario: "fast-tools", delayScale: 2, agentArgs: ["--tools", "30"], ...size });
      const s = run.session;
      await sendPrompt(s, "go");
      // Put the cursor on the first group while it is the only entry, so it stays on that line as
      // the conversation scrolls.
      await s.waitFor((p) => conversationRows(p).some((l) => GROUP.test(l)), 10000);
      s.sendKeys("Tab");
      await s.waitFor((p) => GROUP.test(lineWithoutBar(p, cursorRow(p))), 5000);
      // Wait until the line is within the first two rows: opening it adds more rows than it has
      // above it, so with the bottom kept its first row would go off the top.
      await s.waitFor((p) => {
        const y = cursorRow(p);
        return overflowed(p) && y >= 0 && y <= 2 && !/scrolled/.test(statusRow(p));
      }, 60000);
      s.sendKeys("Enter");
      await s.waitFor((p) => conversationRows(p).some((l) => /^ {2}▾ /.test(l)), 5000);
      await settle(s, 60);
      const rows = conversationRows(s);
      const top = rows.findIndex((l) => /^ {2}▾ /.test(l));
      expect(top).toBeLessThanOrEqual(1);
      expect(statusRow(s)).toMatch(/scrolled/);
      // What the turn adds from now on is counted, and the reader's place does not move.
      const count = (): number => Number(/↓ (\d+) new/.exec(s.screenText().join("\n"))?.[1] ?? 0);
      await s.waitFor((p) => /↓ \d+ new/.test(p.screenText().join("\n")), 10000);
      const first = count();
      await s.waitFor((p) => count() > first, 10000);
      expect(conversationRows(s).findIndex((l) => /^ {2}▾ /.test(l))).toBe(top);
    }, 90000);

    test(`Enter reveals a card that does not fit at ${where}: it scrolls up to show the card with the call's row on screen`, async () => {
      run = startCli({ scenario: "fast-tools", delayScale: 0, agentArgs: ["--tools", "20"], ...size });
      const s = run.session;
      await sendPrompt(s, "go");
      await s.waitFor(/end turn/, 20000);
      await settle(s, 60);
      s.sendKeys("Tab");
      await settle(s, 60);
      s.sendKeys("PageUp");
      await s.waitFor((p) => /scrolled/.test(statusRow(p)), 5000);
      await settle(s, 60);
      // The cursor is on the last entry in view, with no room below it for a card.
      const y = cursorRow(s);
      const rows = conversationRows(s);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(rows.length - 2);
      const header = lineWithoutBar(s, y);
      expect(header).toMatch(/#\d+$|^ {2}▸ /);
      s.sendKeys("Enter");
      await s.waitFor((p) => /┃|▾/.test(p.screenText().join("\n")) && lineWithoutBar(p, cursorRow(p)).replace("▸", "▾") === header.replace("▸", "▾"), 5000);
      await settle(s, 60);
      // The header is on screen, the expansion below it is too, and the view has not gone back to
      // following.
      const after = conversationRows(s);
      const at = cursorRow(s);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(after.length - 1);
      expect(after.slice(at + 1, at + 3).every((l) => /┃|^ {2}[→*%$←] /.test(l))).toBe(true);
      expect(statusRow(s)).toMatch(/scrolled/);
    }, 60000);
  }
});
