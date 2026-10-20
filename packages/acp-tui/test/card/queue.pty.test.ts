// mvp-chrome-and-keys tasks 5.4 and 5.5: queued and withdrawn permission
// requests, the real CLI against fake-agent's `permission-concurrent` and
// `permission-withdraw` at 63x21 (63x26 for the withdrawals). Specs tui-layout "Queued and withdrawn
// cards", tui-agent-session "Concurrent permission requests" and "Permission
// withdrawal".
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { cardRows, promptText, READY } from "../pty/regions.ts";
import { startChrome, type ChromeRun } from "../overlay/cli.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function start(scenario: string, delayScale = 0, rows?: number): ChromeRun {
  const run = startChrome({ scenario, args: [], delayScale, ...(rows ? { rows } : {}) });
  session = run.s;
  return run;
}

async function prompt(run: ChromeRun, text = "go"): Promise<void> {
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys({ text }, "Enter");
}

const header = (s: PtySession) => cardRows(s)[0] ?? "";
const entries = (run: ChromeRun, method: string) => run.agent().filter((e) => e.method === method).map((e) => e.params);
const afterGuard = () => Bun.sleep(400);
/** The prompt box's frame is in the accent colour (ANSI 4, flat theme) only while it has focus. */
function promptFocused(s: PtySession): boolean {
  const rows = s.screenText();
  for (let y = rows.length - 1; y >= 0; y--) if (rows[y]!.startsWith("╰")) return s.cell(s.term.buffer.active.baseY + y, 0)?.getFgColor() === 4;
  return false;
}

describe("queued permission requests (task 5.4)", () => {
  test("Two requests: the header shows 1 of 2; after the answer the second card shows, its options ignored for 300 ms", async () => {
    const run = start("permission-concurrent");
    await prompt(run);
    await run.s.waitFor(() => header(run.s).includes("1 of 2"), 5000);
    expect(header(run.s)).toContain("◊ Permission  edit");
    await afterGuard();
    run.s.sendKeys("1", "Enter");
    await run.s.waitFor(() => entries(run, "session/request_permission/response").length === 1, 5000);
    // The second request, on its own now: no position, `execute`, focus on it (empty prompt box).
    await run.s.waitFor(() => header(run.s).includes("execute") && !header(run.s).includes("of 2"), 5000);
    // Within its guard a digit and Enter do nothing.
    run.s.sendKeys("2", "Enter");
    await Bun.sleep(150);
    expect(entries(run, "session/request_permission/response")).toHaveLength(1);
  }, 20000);

  test("Two requests answered in order: each gets its own response with the option chosen for it", async () => {
    const run = start("permission-concurrent");
    await prompt(run);
    await run.s.waitFor(() => header(run.s).includes("1 of 2"), 5000);
    await afterGuard();
    run.s.sendKeys("1", "Enter");
    await run.s.waitFor(() => header(run.s).includes("execute"), 5000);
    await afterGuard();
    run.s.sendKeys("2", "Enter");
    await run.s.waitFor(READY, 5000);
    expect(entries(run, "permission-concurrent/answer")).toEqual([
      { toolCallId: "pc-1", outcome: { outcome: "selected", optionId: "allow-once" } },
      { toolCallId: "pc-2", outcome: { outcome: "selected", optionId: "reject-once" } },
    ]);
    await run.s.waitFor("Answers: pc-1: allow-once, pc-2: reject-once", 5000);
  }, 20000);

  test("Cancel with two open: the double Esc answers both cancelled and sends session/cancel", async () => {
    const run = start("permission-concurrent");
    await prompt(run);
    await run.s.waitFor(() => header(run.s).includes("1 of 2"), 5000);
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => promptFocused(p), 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor(READY, 5000);
    expect(entries(run, "session/request_permission/response")).toEqual([{ outcome: { outcome: "cancelled" } }, { outcome: { outcome: "cancelled" } }]);
    expect(run.agent().map((e) => e.method)).toContain("session/cancel");
    expect(cardRows(run.s)).toEqual([]);
  }, 20000);
});

describe("withdrawn permission requests (task 5.5)", () => {
  // permission-withdraw at delay scale 1: each request is held 1.5 s before the agent withdraws it.
  test("Agent withdraws: the card leaves, the agent gets -32800, the conversation records the withdrawal", async () => {
    // 63x26: the card's padding and blank rows leave the conversation its keep of 4 rows at 63x21,
    // too few to show the withdrawal's record beside the turn's lines (day-one-feedback 13).
    const run = start("permission-withdraw", 1, 26);
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    await run.s.waitFor("pw-1: withdrawn", 5000);
    expect(entries(run, "session/request_permission/error")[0]).toMatchObject({ code: -32800 });
    expect(run.s.screenText().join("\n")).toContain("permission  withdrawn by agent");
    expect(run.events("permission_withdrawn")[0]).toMatchObject({ toolCallId: "pw-1" });
  }, 20000);

  test("Withdrawn while queued: the first card stays without 1 of 2, the second's record reads withdrawn by agent", async () => {
    // 63x26: the card's padding and blank rows leave the conversation its keep of 4 rows at 63x21,
    // too few to show the withdrawal's record beside the turn's lines (day-one-feedback 13).
    const run = start("permission-withdraw", 1, 26);
    await prompt(run);
    await run.s.waitFor("pw-1: withdrawn", 6000);
    await run.s.waitFor(() => header(run.s).includes("1 of 2"), 5000);
    // pw-3 is withdrawn after the hold; pw-2's card stays, on its own.
    await run.s.waitFor(() => entries(run, "session/request_permission/error").length === 2, 5000);
    await run.s.waitFor(() => cardRows(run.s).length > 0 && !header(run.s).includes("of 2"), 3000);
    expect(header(run.s)).toContain("#2");
    expect(run.events("permission_withdrawn").map((e) => e["toolCallId"])).toEqual(["pw-1", "pw-3"]);
    await run.s.waitFor((p) => p.screenText().filter((r) => r.includes("withdrawn by agent")).length === 2, 3000);
    await afterGuard();
    run.s.sendKeys("1", "Enter");
    await run.s.waitFor("pw-2: allow-once, pw-3: withdrawn", 5000);
  }, 20000);

  test("Withdrawn while focused: the card has focus; after the withdrawal the prompt box has focus", async () => {
    // 63x26: the card's padding and blank rows leave the conversation its keep of 4 rows at 63x21,
    // too few to show the withdrawal's record beside the turn's lines (day-one-feedback 13).
    const run = start("permission-withdraw", 1, 26);
    await prompt(run);
    await run.s.waitFor(() => cardRows(run.s).length > 0, 5000);
    // A draft in the prompt box, so pw-2's card, which follows at once, flashes instead of taking
    // focus; then Tab twice puts focus back on pw-1's card.
    run.s.sendKeys("Esc");
    await run.s.waitFor((p) => promptFocused(p), 3000);
    run.s.sendKeys({ text: "ab" });
    await run.s.waitFor((p) => promptText(p)[0] === "ab", 3000);
    run.s.sendKeys("Tab", "Tab");
    await run.s.waitFor((p) => !promptFocused(p) && cardRows(p).length > 0, 3000);
    expect(entries(run, "session/request_permission/error")).toEqual([]);
    await run.s.waitFor("pw-1: withdrawn", 5000);
    await run.s.waitFor((p) => promptFocused(p), 3000);
    run.s.sendKeys({ text: "x" });
    await run.s.waitFor((p) => promptText(p)[0] === "abx", 3000);
    expect(run.s.screenText().join("\n")).toContain("withdrawn by agent");
  }, 20000);
});
