// parallel-tests task 3.3: the find tests with a time budget: the hit shown within 1 s of Enter and the search costs at 5000 items (100 ms for the first keystroke, 16 ms for later ones), the same 1 s at 200 items, and the re-search interval while streaming (at least 100 ms apart, with a tolerance); they run in the serial pass.
// What the file covers is in the header of find.pty.test.ts; its helpers are in find-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import type { OscColours } from "../pty/harness.ts";
import { statusRow } from "../pty/regions.ts";
import { sendPrompt, settle, startCli, type CliRun } from "../conversation/cli.ts";
import { FIRST, NEEDLE, CTRL_F, conversationRows, findBar, currentHit, findEvents, openAndType, closeBar, warmedUp, hitCount } from "./find-helpers.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

async function start200(colours?: OscColours): Promise<CliRun> {
  run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", "200"], ...(colours ? { colours } : {}) });
  await sendPrompt(run.session, FIRST);
  await run.session.waitFor(/end turn/, 30000);
  await settle(run.session);
  return run;
}

describe("find at 5000 items (task 15.2)", () => {
  test("needle-500-back shown, expanded and highlighted within 1 s of Enter; Esc restores the top item", async () => {
    run = startCli({ scenario: "long-session", cols: 100, rows: 30, agentArgs: ["--items", "5000"] });
    const s = run.session;
    await sendPrompt(s, FIRST);
    await s.waitFor(/end turn/, 90000);
    const warm = await warmedUp(run);
    await settle(s);
    // Scrolled up, so the anchor (not following) is what Esc has to restore.
    for (let i = 0; i < 3; i++) {
      const before = conversationRows(s).join("\n");
      s.sendKeys("PageUp");
      await s.waitFor((p) => conversationRows(p).join("\n") !== before, 5000);
    }
    await settle(s, 100);
    const before = conversationRows(s);
    expect(statusRow(s)).toMatch(/scrolled/);

    await openAndType(s, NEEDLE, /\b1 hit\b/);
    // Opening the bar takes one row from the conversation; the top item stays.
    expect(conversationRows(s)[0]).toBe(before[0]);

    const sent = Date.now();
    s.sendKeys("Enter");
    await s.waitFor((p) => currentHit(p, NEEDLE) && /\b1 of 1\b/.test(findBar(p) ?? ""), 5000);
    const wall = Date.now() - sent;
    await s.waitFor(() => findEvents(run!, "shown").length > 0, 5000);

    const shown = findEvents(run, "shown")[0]!;
    expect(shown["mapped"]).toBe(true);
    expect(Number(shown["ms"])).toBeLessThan(1000);
    // The card is expanded: the needle's neighbours in the output are drawn in it.
    const rows = s.screenText();
    const needleRow = rows.findIndex((r) => r.includes(NEEDLE));
    // (mvp-rendering task 9.3: the needle lies in rows the snippet hides, which find shows.)
    expect(rows[needleRow - 1]).toContain("PASS  tests/Unit/Case30Test.php");
    expect(rows[needleRow + 1]).toContain("PASS  tests/Unit/Case32Test.php");
    // The log never holds the query text.
    expect(JSON.stringify(run.events("find"))).not.toContain("needle");
    // The first keystroke's search projects every item; later ones reuse the projections.
    const searches = findEvents(run, "search").map((e) => Number(e["ms"]));
    // The spec's search cost: the first keystroke under 100 ms, each later one (and each step)
    // under 16 ms, because projections are reused until an item changes.
    expect(searches.length).toBe(NEEDLE.length);
    expect(searches[0]).toBeLessThan(100);
    for (const ms of searches.slice(1)) expect(ms).toBeLessThan(16);
    for (const e of findEvents(run, "step")) expect(Number(e["searchMs"])).toBeLessThan(16);
    console.log(
      `needle: shown ${String(shown["ms"])} ms after Enter (log), ${wall} ms to the screen (test), frames ${String(shown["frames"])}, scrolls ${String(shown["scrolls"])}; ` +
        `searches while typing: first ${searches[0]} ms, the rest at most ${Math.max(...searches.slice(1))} ms; step search ${String(findEvents(run, "step")[0]!["searchMs"])} ms; ` +
        `projections warmed in ${warm.ms} ms (${warm.waited} ms waited after the turn ended)`,
    );

    await closeBar(s, "Esc");
    expect(conversationRows(s)).toEqual(before);
    expect(findEvents(run, "close").at(-1)?.["how"]).toBe("escape");
  }, 180000);

  // Agents other than claude-agent-acp may send tool output unfenced, which acp-tui renders (and
  // projects) as Markdown: the search cost must hold for that too.
  test("unfenced tool output (long-session-plain): the first keystroke's search under 100 ms, later ones under 16 ms", async () => {
    run = startCli({ scenario: "long-session-plain", cols: 100, rows: 30, agentArgs: ["--items", "5000"] });
    const s = run.session;
    await sendPrompt(s, FIRST);
    await s.waitFor(/end turn/, 90000);
    const warm = await warmedUp(run);
    await settle(s);
    await openAndType(s, NEEDLE, /\b1 hit\b/);
    const searches = findEvents(run, "search").map((e) => Number(e["ms"]));
    expect(searches.length).toBe(NEEDLE.length);
    console.log(
      `unfenced: searches while typing: first ${searches[0]} ms, the rest at most ${Math.max(...searches.slice(1))} ms; ` +
        `projections warmed in ${warm.ms} ms (${warm.waited} ms waited after the turn ended)`,
    );
    expect(searches[0]).toBeLessThan(100);
    for (const ms of searches.slice(1)) expect(ms).toBeLessThan(16);
    expect(JSON.stringify(run.events("find"))).not.toContain("needle");
  }, 180000);
});

describe("find at 200 items (task 15.2)", () => {
  test("a hit far back in a collapsed read is shown and highlighted; Esc returns to the bottom", async () => {
    // A line of the fourth item's output (a read call, collapsed), found once in the session.
    const query = "$bindParameters0 = renderTemplate(658);";
    expect(hitCount(query)).toBe(1);
    const { session: s } = await start200();
    const before = conversationRows(s);
    expect(statusRow(s)).not.toMatch(/scrolled/);

    await openAndType(s, query, /\b1 hit\b/);
    s.sendKeys("Enter");
    await s.waitFor((p) => currentHit(p, query), 5000);
    await s.waitFor(() => findEvents(run!, "shown").length > 0, 5000);
    expect(findEvents(run!, "shown")[0]!["mapped"]).toBe(true);
    expect(Number(findEvents(run!, "shown")[0]!["ms"])).toBeLessThan(1000);
    await s.waitFor((p) => /scrolled/.test(statusRow(p)), 5000);

    await closeBar(s, "Esc");
    expect(conversationRows(s)).toEqual(before);
    expect(statusRow(s)).not.toMatch(/scrolled/);
  }, 60000);
});

describe("hits kept current (mvp-conversation task 6.5)", () => {
  test("Streaming while finding: the counter follows the stream, the current hit stays, the view does not move; re-searches are at least 100 ms apart", async () => {
    // fake-agent's `stream-long` streams one answer at 2000 characters a second; `hydration` is
    // in sections 1, 7, 13, ... (four or five hits each).
    run = startCli({ scenario: "stream-long", delayScale: 1, cols: 100, rows: 30 });
    const s = run.session;
    await sendPrompt(s, "stream");
    await s.waitFor(/Section 2: caching/, 15000);
    s.sendKeys("PageUp");
    await s.waitFor((p) => /scrolled/.test(statusRow(p)), 5000);
    s.sendKeys(CTRL_F);
    await s.waitFor((p) => findBar(p) !== null, 5000);
    s.sendKeys({ text: "hydration" });
    await s.waitFor((p) => /\b\d+ hits\b/.test(findBar(p) ?? ""), 5000);
    const total = () => Number(/\b(\d+) hits\b|\bof (\d+)\b/.exec(findBar(s) ?? "")?.slice(1).find(Boolean));
    const n0 = total();
    expect(n0).toBeGreaterThanOrEqual(3);
    s.sendKeys("Enter");
    s.sendKeys("Enter");
    await s.waitFor((p) => new RegExp(`\\b2 of ${n0}\\b`).test(findBar(p) ?? ""), 5000);
    await settle(s, 100);
    const top = conversationRows(s)[0];

    // More hydration arrives (section 7): the counter reads `2 of <more>`, the hit is still the second.
    await s.waitFor((p) => /\b2 of \d+\b/.test(findBar(p) ?? "") && total() > n0, 15000);
    expect(total()).toBeGreaterThan(n0);
    expect(conversationRows(s)[0]).toBe(top);
    const refreshes = findEvents(run, "refresh");
    expect(refreshes.length).toBeGreaterThan(0);
    expect(Number(refreshes.at(-1)!["hits"])).toBe(total());
    const times = refreshes.map((e) => Date.parse(String(e["ts"])));
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(90);
    // The log never holds the query.
    expect(JSON.stringify(run.events())).not.toContain("hydration");
  }, 90000);
});
