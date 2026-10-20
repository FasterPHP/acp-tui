// The find bar in the real CLI (phase-1a task 15.2): acp-tui under a PTY
// against fake-agent's `long-session`.
//
// - At 5000 items: `needle-500-back` is shown,
//   expanded and highlighted within 1 s of Enter, timed from the `find` log
//   event (`shown`, from the key handler to the frame that drew the hit); Esc
//   restores the top item from before the bar opened.
// - At 200 items: a hit far back is shown and
//   Esc returns to the bottom; a hit inside a collapsed tool call on screen is
//   expanded and collapsed again by Esc; F3, Shift+F3 and Shift+Enter step
//   through several hits; Tab moves focus to the conversation at the hit.
//
// The timing tests of this file are in find.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { OscColours } from "../pty/harness.ts";
import { promptText, READY, statusRow } from "../pty/regions.ts";
import { sendPrompt, settle, startCli, type CliRun } from "../conversation/cli.ts";
import { deriveSurfaces } from "../../src/theme/index.ts";
import { FIRST, CTRL_F, F3, SHIFT_F3, SHIFT_F3_XTERM, conversationRows, findBar, locate, currentHit, bgHex, findEvents, openAndType, closeBar, hitCount, openGroup } from "./find-helpers.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

async function start200(colours?: OscColours, env?: Record<string, string | undefined>): Promise<CliRun> {
  run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", "200"], ...(colours ? { colours } : {}), ...(env ? { env } : {}) });
  await sendPrompt(run.session, FIRST);
  await run.session.waitFor(/end turn/, 30000);
  await settle(run.session);
  return run;
}

describe("find at 200 items (task 15.2)", () => {
  test("a hit inside a collapsed tool call on screen expands it; Esc collapses it again", async () => {
    // The first line of the next-to-last read's output (collapsed, its header on screen).
    const query = "$resolveRoute0 = bindParameters(964);";
    expect(hitCount(query)).toBe(1);
    const { session: s } = await start200();
    await openGroup(s);
    // The final turn has no answer, so its thought starts expanded (mvp-rendering "Thoughts") and
    // pushes the reads down: back to the bottom.
    s.sendKeys("PageDown");
    await settle(s, 100);
    expect(locate(s, "Read src/Kernel.php")).not.toBeNull();
    const before = conversationRows(s);

    await openAndType(s, query, /\b1 hit\b/);
    s.sendKeys("Enter");
    await s.waitFor((p) => currentHit(p, query), 5000);
    // Expanded: the output's next line is drawn below the hit.
    const rows = s.screenText();
    expect(rows[rows.findIndex((r) => r.includes(query)) + 1]).toContain("$buildQuery1 = resolveRoute(968);");

    await closeBar(s, "Esc");
    expect(conversationRows(s)).toEqual(before);
    expect(locate(s, query)).toBeNull();
  }, 60000);

  test("F3, Shift+F3 (kitty form; not the xterm form) and Shift+Enter step through the hits; Tab goes to the conversation at the hit", async () => {
    const query = "git diff --stat";
    const n = hitCount(query);
    expect(n).toBeGreaterThan(2);
    const { session: s } = await start200();

    await openAndType(s, query, new RegExp(`\\b${n} hits\\b`));
    /** Waits for the counter to read `k of n` (1-based `k`, wrapping). */
    const at = (k: number) => s.waitFor((p) => new RegExp(`\\b${((k - 1 + n) % n) + 1} of ${n}\\b`).test(findBar(p) ?? ""), 5000);
    s.sendKeys("Enter");
    await s.waitFor((p) => / of /.test(findBar(p) ?? ""), 5000);
    // The first hit at or after the top item on screen, wrapping to the first.
    const first = Number(/\b(\d+) of /.exec(findBar(s)!)![1]);
    s.sendKeys(F3);
    await at(first + 1);
    s.sendKeys("Enter");
    await at(first + 2);
    s.sendKeys("Shift+Enter:esc-cr");
    await at(first + 1);
    s.sendKeys("Shift+Enter");
    await at(first);
    // Shift+F3 in the xterm form never reaches acp-tui (OpenTUI swallows it): no step.
    s.sendKeys(SHIFT_F3_XTERM);
    await settle(s, 150);
    await at(first);
    s.sendKeys(SHIFT_F3);
    await at(first - 1);
    s.sendKeys(F3);
    await at(first);
    await settle(s, 100);
    expect(currentHit(s, query)).toBe(true);

    await closeBar(s, "Tab");
    expect(findEvents(run!, "close").at(-1)?.["how"]).toBe("conversation");
    // Focus is in the conversation (its hints), with the cursor on the hit's item: the item stays
    // expanded and on screen.
    expect(statusRow(s)).toMatch(/esc prompt/);
    expect(locate(s, "Run git diff --stat")).not.toBeNull();
  }, 60000);

  test("Zed's Shift+Enter, a bare \\n (linefeed), steps to the previous hit; in the prompt box \\n is still a newline", async () => {
    const query = "git diff --stat";
    const n = hitCount(query);
    expect(n).toBeGreaterThan(2);
    const { session: s } = await start200();

    await openAndType(s, query, new RegExp(`\\b${n} hits\\b`));
    const at = (k: number) => s.waitFor((p) => new RegExp(`\\b${((k - 1 + n) % n) + 1} of ${n}\\b`).test(findBar(p) ?? ""), 5000);
    s.sendKeys("Enter");
    await s.waitFor((p) => / of /.test(findBar(p) ?? ""), 5000);
    const first = Number(/\b(\d+) of /.exec(findBar(s)!)![1]);
    s.sendKeys("Enter");
    await at(first + 1);
    // `\n`, as Zed sends Shift+Enter (the harness's Ctrl+J): back one hit, as ESC CR does.
    s.sendKeys("Ctrl+J");
    await at(first);
    expect(findEvents(run!, "step").at(-1)?.["direction"]).toBe(-1);

    // The prompt box's own binding is untouched: with the bar closed, `\n` inserts a newline.
    await closeBar(s, "Esc");
    s.sendKeys({ text: "one" }, "Ctrl+J", { text: "two" });
    await s.waitFor((p) => promptText(p).join("|") === "one|two", 5000);
  }, 60000);

  // windows-support (spec tui-keymap "Find previous in Windows Terminal"): Ctrl+Enter steps back in
  // the find bar in both encodings Windows Terminal uses, and the bar's hint follows the kitty answer.
  test("Windows Terminal: the bar's hint reads ctrl+enter previous until the kitty answer, and Ctrl+Enter (LF in 1.24, CSI 13;5u in 1.25) steps to the previous hit", async () => {
    const query = "git diff --stat";
    const n = hitCount(query);
    expect(n).toBeGreaterThan(2);
    const { session: s } = await start200(undefined, { TERMINAL_EMULATOR: undefined, TERM_PROGRAM: undefined, WT_SESSION: "5f2c3a1e-8d9b-4c6a-9e0f-7b1d2a3c4e5f" });

    await openAndType(s, query, new RegExp(`\\b${n} hits\\b`));
    expect(findBar(s)).toContain("ctrl+enter previous");
    expect(findBar(s)).not.toContain("shift+enter");
    const at = (k: number) => s.waitFor((p) => new RegExp(`\\b${((k - 1 + n) % n) + 1} of ${n}\\b`).test(findBar(p) ?? ""), 5000);
    s.sendKeys("Enter");
    await s.waitFor((p) => / of /.test(findBar(p) ?? ""), 5000);
    const first = Number(/\b(\d+) of /.exec(findBar(s)!)![1]);
    s.sendKeys("Enter");
    await at(first + 1);
    s.sendKeys("Ctrl+J");
    await at(first);
    expect(findEvents(run!, "step").at(-1)?.["direction"]).toBe(-1);
    // 1.25 answers the kitty query: Ctrl+Enter is CSI 13;5u and the hint names shift+enter.
    s.write("\x1b[?5u");
    await s.waitFor((p) => (findBar(p) ?? "").includes("shift+enter previous"), 5000);
    s.sendKeys("Enter");
    await at(first + 1);
    s.write("\x1b[13;5u");
    await at(first);
    s.write("\x1b[13;2u");
    await at(first - 1);
  }, 60000);

  for (const [name, colours] of [
    ["flat theme: underlined, the current one in inverse video", undefined],
    ["truecolour: on find.other, the current one on find.current, in the default foreground", { foreground: "#d0d0d0", background: "#1c1c1c" }],
  ] as const) {
    test(`other visible hits are drawn fainter (${name})`, async () => {
      // Tool titles and plan entries (fake-agent's plans are not in the model helper, so the count
      // is read from the bar).
      const query = "Read ";
      const { session: s } = await start200(colours);
      await openGroup(s);
      await openAndType(s, query, /\b\d+ hits\b/);
      const n = Number(/\b(\d+) hits\b/.exec(findBar(s) ?? "")![1]);
      // Forwards from the top item on screen to the last hit in the conversation: the first entry
      // of the last plan (expanded for it).
      s.sendKeys("Enter");
      await s.waitFor((p) => / of /.test(findBar(p) ?? ""), 5000);
      for (let k = Number(/\b(\d+) of /.exec(findBar(s)!)![1]); k < n; k++) {
        s.sendKeys(F3);
        await s.waitFor((p) => new RegExp(`\\b${k + 1} of ${n}\\b`).test(findBar(p) ?? ""), 5000);
      }
      await s.waitFor((p) => locate(p, "Read the affected files (8)") !== null, 5000);
      await settle(s, 100);
      const base = s.term.buffer.active.baseY;
      const current = locate(s, "Read the affected files (8)")!;
      const other = locate(s, "Read src/Kernel.php")!;
      expect(current).not.toBeNull();
      expect(other).not.toBeNull();
      const surfaces = colours ? deriveSurfaces(colours) : null;
      for (let c = 0; c < query.length - 1; c++) {
        const cur = s.cell(base + current.y, current.x + c)!;
        expect(cur.isBold()).not.toBe(0);
        const faint = s.cell(base + other.y, other.x + c)!;
        expect(faint.isInverse()).toBe(0);
        if (surfaces) {
          // S5, IDE session B2: derived fills with the text in the default foreground.
          expect(cur.isInverse()).toBe(0);
          expect(bgHex(s, current.y, current.x + c)).toBe(surfaces["find.current"]);
          expect(cur.isFgDefault()).toBe(true);
          expect(bgHex(s, other.y, other.x + c)).toBe(surfaces["find.other"]);
          expect(faint.isFgDefault()).toBe(true);
        } else {
          expect(cur.isInverse()).not.toBe(0);
          expect(faint.isUnderline()).not.toBe(0);
        }
      }
      // The text after the hit is not highlighted.
      const after = s.cell(base + other.y, other.x + query.length + 1)!;
      expect(after.isUnderline()).toBe(0);
      expect(after.isBgRGB()).toBe(false);
    }, 60000);
  }
});

describe("find with grouped runs at 200 items (task 15.2)", () => {
  test("a hit in a read grouped behind a run line opens the group and shows it; Esc closes the group and returns", async () => {
    const query = "$bindParameters0 = renderTemplate(658);";
    run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", "200"] });
    const s = run.session;
    await sendPrompt(s, FIRST);
    await s.waitFor(/end turn/, 30000);
    await settle(s);
    const before = conversationRows(s);

    await openAndType(s, query, /\b1 hit\b/);
    s.sendKeys("Enter");
    await s.waitFor((p) => currentHit(p, query), 5000);
    await s.waitFor(() => findEvents(run!, "shown").length > 0, 5000);
    expect(findEvents(run, "shown")[0]!["mapped"]).toBe(true);
    // The read's own header line is drawn: its group is open.
    expect(locate(s, "Read src/")).not.toBeNull();

    await closeBar(s, "Esc");
    expect(conversationRows(s)).toEqual(before);
    // Back at the top, the run is one group line again.
    s.sendKeys("Tab", "Home");
    await s.waitFor((p) => /scrolled 0%|scrolled \d%/.test(statusRow(p)), 5000);
    await settle(s, 100);
    expect(s.screenText().some((r) => /▸ .*\b5 reads\b/.test(r))).toBe(true);
    expect(locate(s, query)).toBeNull();
  }, 60000);
});

describe("find bar position (mvp-conversation task 6.3)", () => {
  test("Bar position: the row directly above the status row, below the prompt box; none while closed; the top item stays", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", "200"] });
    const s = run.session;
    await sendPrompt(s, FIRST);
    await s.waitFor(/end turn/, 30000);
    await settle(s);
    s.sendKeys("PageUp");
    await settle(s, 100);
    const rows = s.screenText();
    // Closed: no row for the bar; the prompt box's bottom border, the spacer, the status row and the
    // bottom margin (mvp-chrome-and-keys task 4.8).
    expect(rows.at(-4)?.startsWith("╰")).toBe(true);
    expect(rows.at(-3)).toBe("");
    const before = conversationRows(s);

    s.sendKeys(CTRL_F);
    await s.waitFor((p) => findBar(p) !== null, 5000);
    await settle(s, 100);
    const open = s.screenText();
    expect(open.length).toBe(rows.length);
    expect(open.at(-3)?.startsWith("find: ")).toBe(true);
    expect(open.at(-4)).toBe("");
    expect(open.at(-5)?.startsWith("╰")).toBe(true);
    expect(open.at(-2)).toMatch(/scrolled/);
    expect(open.at(-1)).toBe("");
    // The conversation gave up one row from the bottom; its top item and offset are unchanged.
    expect(conversationRows(s)[0]).toBe(before[0]);
    expect(conversationRows(s).length).toBe(before.length - 1);

    await closeBar(s, "Esc");
    expect(s.screenText().at(-4)?.startsWith("╰")).toBe(true);
    expect(conversationRows(s)).toEqual(before);
  }, 60000);
});

describe("find bar input (mvp-conversation task 6.4)", () => {
  test("Paste into the bar: line breaks become spaces and the counter is updated; Ctrl+U clears", async () => {
    const query = "git diff --stat";
    const n = hitCount(query);
    expect(n).toBeGreaterThan(2);
    const { session: s } = await start200();
    s.sendKeys(CTRL_F);
    await s.waitFor((p) => findBar(p) !== null, 5000);
    // A paste with a bare LF and one with CRLF (terminals send CR): both are one space.
    s.paste("git diff\n--stat");
    await s.waitFor((p) => new RegExp(`^find: ${query} +${n} hits`).test(findBar(p) ?? ""), 5000);
    s.sendKeys({ text: "\x15" });
    await s.waitFor((p) => /^find: +· enter/.test(findBar(p) ?? ""), 5000);
    s.paste("git diff\r\n--stat");
    await s.waitFor((p) => new RegExp(`^find: git diff --stat +${n} hits`).test(findBar(p) ?? ""), 5000);
    // Nothing reached the prompt box, and the log never holds the pasted text.
    expect(JSON.stringify(run!.events())).not.toContain("git diff");
    await closeBar(s, "Esc");
    expect(promptText(s).join("|")).toBe("");
  }, 60000);
});

describe("find in a collapsed plan (mvp-conversation task 6.6)", () => {
  test("Hit in a collapsed plan: the plan expands to show the entry (its collapsed line shows none); Esc collapses it again", async () => {
    // An entry of the last plan (`plan 3/4`), which is collapsed and shows no entry.
    const query = "Read the affected files (8)";
    const { session: s } = await start200();
    expect(s.screenText().some((r) => /\bplan 3\/4\b/.test(r))).toBe(true);
    expect(locate(s, query)).toBeNull();
    const before = conversationRows(s);

    await openAndType(s, query, /\b\d+ hits?\b/);
    s.sendKeys("Enter");
    await s.waitFor((p) => currentHit(p, query), 5000);
    expect(findEvents(run!, "shown").at(-1)?.["mapped"]).toBe(true);

    await closeBar(s, "Esc");
    expect(conversationRows(s)).toEqual(before);
    expect(locate(s, query)).toBeNull();
  }, 60000);
});

describe("find leaves no trace of the query (mvp-conversation task 6.7)", () => {
  test("Log without the query: find events hold the query's length and the hit count, and the string appears nowhere in the log", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", "20"] });
    const s = run.session;
    // The conversation holds the token once (the user's own message), so the search has a hit.
    await sendPrompt(s, "where is secret-token");
    await s.waitFor(/end turn/, 15000);
    await openAndType(s, "secret-token", /\b1 hit\b/);
    s.sendKeys("Enter");
    await s.waitFor((p) => /\b1 of 1\b/.test(findBar(p) ?? ""), 5000);
    s.sendKeys("Enter", { text: "\x15" });
    await closeBar(s, "Esc");

    const searches = findEvents(run, "search");
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.at(-1)).toMatchObject({ queryLength: "secret-token".length, hits: 1 });
    expect(run.events("find").length).toBeGreaterThan(3);
    // The raw log file, every event of it: neither the token nor its pieces.
    const raw = readFileSync(run.logPath, "utf8");
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("token");
  }, 30000);
});

describe("find keys (mvp-conversation tasks 6.1, 6.2)", () => {
  test("a bare CSI R is F3: it opens the bar, and no console event is logged", async () => {
    run = startCli({ scenario: "basic", cols: 100, rows: 30 });
    const s = run.session;
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "\x1b[R" });
    await s.waitFor((p) => findBar(p) !== null, 5000);
    await settle(s, 100);
    expect(findEvents(run, "open").length).toBe(1);
    expect(run.events("console")).toEqual([]);
    // As ESC O R does, F3 in the bar steps (nothing to step to without a query) and keeps it open.
    s.sendKeys({ text: "\x1b[R" });
    await settle(s, 150);
    expect(findBar(s)).not.toBeNull();
    expect(run.events("console")).toEqual([]);
  }, 30000);

  test("Ctrl+F from the prompt box opens the bar and leaves the draft and its cursor alone", async () => {
    run = startCli({ scenario: "basic", cols: 100, rows: 30 });
    const s = run.session;
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "hello world" }, "Left", "Left", "Left");
    await s.waitFor((p) => promptText(p).join("|") === "hello world", 5000);
    s.sendKeys(CTRL_F);
    await s.waitFor((p) => findBar(p) !== null, 5000);
    await settle(s, 100);
    expect(s.screenText().some((r) => r.includes("hello world"))).toBe(true);
    s.sendKeys("Esc");
    await s.waitFor((p) => findBar(p) === null, 5000);
    // Back in the prompt box, the cursor is where it was: three cells before the end.
    s.sendKeys({ text: "X" });
    await s.waitFor((p) => promptText(p).join("|") === "hello woXrld", 5000);
  }, 30000);
});
