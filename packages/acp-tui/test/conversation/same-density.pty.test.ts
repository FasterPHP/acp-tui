// tui-theme "Colour in the dense view", scenario "Same density" (mvp-rendering task 10.4):
// `long-session` with 200 items at 63 columns in `compact` takes as many rows as under the
// phase-1a renderer, apart from the rows the rendering requirements add on purpose, and its tool
// lines use at least four distinct palette colours.
//
// The phase-1a figure is pinned: 639 rows from the prompt to the turn-end line, measured on
// 9 October 2026 with the acp-tui of f65a36f (main before mvp-rendering, the phase-1a renderer
// with mvp-conversation's windowed list) driving this branch's fake-agent (`long-session --items
// 200`, tool output fenced as claude-agent-acp sends it), under the PTY harness at 63x2000 with
// the dark OSC 10 and 11 answers below, so the whole conversation is on one screen. The script
// started `bun <f65a36f>/packages/acp-tui/src/cli.ts -- bun <this tree>/packages/fake-agent/src/
// main.ts --scenario long-session --items 200 --delay-scale 0`, sent one prompt and counted the
// rows from the prompt's to the `end turn` line, as this test does.
//
// The fixture holds what the scenario's wording rules out (`none holding tables, headings or
// code`): answers with a table under a level 2 heading and answers with a code block. So the
// test takes the phase-1a count, adds each kind of row this change adds on purpose, counted on
// the screen, and requires the total to be exact (measured: 765 = 639 + 85 - 4 + 45, the last the user cards' padding and wraps):
//
// - table borders: the top border, the header rule and the bottom border (3 per table; 11 tables);
// - level 2 heading rules (1 per heading; 11);
// - the code blocks' padding rows (day-one-feedback task group 13): a row of the fill above and
//   below each block (2 per block; 17 blocks); each block's label sits on its top padding row, so
//   no label takes a row of its own any more;
// - code lines that wrap with the continuation mark, because the code fill keeps two columns of
//   padding at each side of the text: a 61-character TypeScript signature fitted the 61 columns
//   behind the gutter under phase 1a (7);
// - minus the one row of output that phase 1a showed under each failed call, which expanded
//   itself: since day-one-feedback task 3.2 no call expands itself, so a failed call keeps its
//   line alone (1 per failure; 4 failures; mvp-rendering's padding rows and full titles of the
//   cards the failures used to expand go with them);
// - the expanded card's full title (task 9.1) and the blank row after it, only where the
//   collapsed line truncated the title (review C13): none here, since no call is expanded.
// - the user cards' padding rows (day-one-feedback, "Card padding"): one above and one below each
//   user message, except the top one of the prompt the count starts from (2 per message less 1),
//   and the rows user messages gain from wrapping narrower, since the text keeps two columns of
//   padding at each side (6).
//
// No thought starts expanded any more (Marcus's review, 9 October 2026, C16), so the turn's last
// thought stays in its group line, as under phase 1a, and adds nothing.
import { afterEach, describe, expect, test } from "bun:test";
import { createSession, reduce } from "acp-model";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { deriveSurfaces } from "../../src/theme/index.ts";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { READY, withoutBar } from "../pty/regions.ts";
import { sendPrompt, settle, startCli, type CliRun } from "./cli.ts";
import { longSessionEvents } from "./window/session.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

/** 66 columns, so that the conversation is 63 columns wide as under phase 1a: since
 *  mvp-chrome-and-keys the conversation's right margin (two columns) and its scroll bar (one) take
 *  three columns at the right (spec tui-layout "Conversation right margin"), and the comparison
 *  with the pinned phase-1a figure needs the same text width. */
const COLS = 66;
const DARK = { foreground: "#bcbec4", background: "#191a1c" } satisfies OscColours;
const PROMPT = "scalebench-first-item";
/** The phase-1a renderer's rows for this session (see the header). */
const PHASE_1A_ROWS = 639;
const GLYPHS = DEFAULT_GLYPHS.markdown;

/** A collapsed tool line: the kind glyph, the status, the kind. */
const TOOL_LINE = /^ {2}[→←$*%•] (✓|✗|stop) +[a-z]+ /;

/** The index of the last row matching `re`, or -1. */
function lastRow(rows: readonly string[], re: RegExp): number {
  for (let i = rows.length - 1; i >= 0; i--) if (re.test(rows[i]!)) return i;
  return -1;
}

/** How many items of `kind` the scenario's events leave in the model. */
function itemsOfKind(events: ReturnType<typeof longSessionEvents>, kind: string): number {
  let model = createSession();
  for (const event of events) model = reduce(model, event);
  return model.order.filter((id) => model.items.get(id)?.kind === kind).length;
}

function conversation(s: PtySession): string[] {
  const lines = withoutBar(s.screenText());
  const first = lines.findIndex((l) => l.includes(PROMPT));
  const last = lastRow(lines, /end turn/);
  return lines.slice(first, last + 1);
}

describe("Same density (task 10.4)", () => {
  test("long-session, 200 items, 63 columns, compact: the phase-1a rows plus only the rows added on purpose; tool lines in four or more palette colours", async () => {
    run = startCli({ scenario: "long-session", cols: COLS, rows: 2000, colours: DARK, agentArgs: ["--items", "200"] });
    const s = run.session;
    await sendPrompt(s, PROMPT);
    await s.waitFor((p) => p.screenText().some((l) => /end turn/.test(l)) && READY.test(p.screenText().join("\n")), 60000);
    await settle(s, 400);
    const rows = conversation(s);

    const tables = rows.filter((l) => l.trimStart().startsWith(GLYPHS.table.topLeft)).length;
    const headingRules = rows.filter((l) => new RegExp(`^ {2}${GLYPHS.ruleLight}+$`).test(l)).length;
    const labelRows = rows.filter((l) => /^ {20,}[a-z]+$/.test(l)).length;
    // A code block's padding rows (day-one-feedback task group 13): rows on the code fill with no
    // code, its label aside (the top padding row carries it).
    const base0 = s.term.buffer.active.baseY;
    const top0 = s.screenText().findIndex((l) => l.includes(PROMPT));
    const codeFill = (i: number) => {
      const cell = s.cell(base0 + top0 + i, 3);
      return cell !== undefined && !cell.isBgDefault() && cell.isBgRGB() && cell.getBgColor() === parseInt(deriveSurfaces(DARK)["surface.code"].slice(1), 16);
    };
    // Two per block: a block is a run of rows on the code fill.
    const codePadding = 2 * rows.filter((_, i) => codeFill(i) && !codeFill(i - 1)).length;
    const wraps = rows.filter((l) => l.endsWith(GLYPHS.codeContinuation)).length;
    const failedLines = rows.filter((l) => TOOL_LINE.test(l) && l.includes("✗"));
    const added = { tables: 3 * tables, headingRules, codePadding, wraps, collapsedFailures: -failedLines.length };

    const userCards = itemsOfKind(longSessionEvents(200), "user_message");
    const userAdded = { userPadding: 2 * userCards - 1, userWraps: 6 };
    console.log(`same density: ${rows.length} rows; phase 1a ${PHASE_1A_ROWS}; added on purpose ${JSON.stringify(added)}`);
    // Every label is on its block's top padding row (17 blocks), none on a row of its own.
    expect(labelRows).toBe(17);
    expect(added).toEqual({ tables: 33, headingRules: 11, codePadding: 34, wraps: 7, collapsedFailures: -4 });
    expect(rows.length).toBe(PHASE_1A_ROWS + Object.values(added).reduce((a, b) => a + b, 0) + userAdded.userPadding + userAdded.userWraps);

    // The tool lines' colours: every non-blank cell's palette index.
    const base = s.term.buffer.active.baseY;
    const top = s.screenText().findIndex((l) => l.includes(PROMPT));
    const palette = new Set<number>();
    let toolLines = 0;
    rows.forEach((line, i) => {
      if (!TOOL_LINE.test(line)) return;
      toolLines += 1;
      for (let x = 0; x < COLS; x++) {
        const cell = s.cell(base + top + i, x);
        if (cell && cell.getChars().trim() !== "" && cell.isFgPalette()) palette.add(cell.getFgColor());
      }
    });
    expect(toolLines).toBeGreaterThan(20);
    console.log(`tool lines: ${toolLines}, palette colours ${[...palette].sort((a, b) => a - b).join(", ")}`);
    expect(palette.size).toBeGreaterThanOrEqual(4);
  }, 90000);
});
