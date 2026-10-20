// mvp-chrome-and-keys task 3.5 (spec tui-keymap "Input in one read"; design
// D11): keys that arrive in one input chunk are handled in order, each against
// the focus the keys before it left, and a chunk of exactly two ESC bytes is
// two Esc presses (S1 decision 5, S6 finding 2). The real CLI against
// fake-agent under the PTY harness; every multi-key input here is one write.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { CARD_HEADER, READY, RUNNING } from "../pty/regions.ts";
import { startCli } from "./cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const ACCENT_FG = 4;
const responses = (run: ReturnType<typeof startCli>) => run.entries().filter((e) => e.method === "session/request_permission/response").map((e) => e.params);

function conversationFocused(s: PtySession): boolean {
  const base = s.term.buffer.active.baseY;
  const rows = s.screenText();
  const card = rows.findIndex((r) => r.includes(CARD_HEADER));
  const end = card >= 0 ? card : rows.findIndex((r) => r.startsWith("╭"));
  for (let y = 0; y < end; y++) if (s.cell(base + y, 0)?.isInverse()) return true;
  return false;
}
function promptFocused(s: PtySession): boolean {
  const rows = s.screenText();
  let y = rows.length - 1;
  while (y >= 0 && !rows[y]!.startsWith("╰")) y--;
  return y >= 0 && s.cell(s.term.buffer.active.baseY + y, 0)?.getFgColor() === ACCENT_FG;
}

describe("Input in one read (task 3.5)", () => {
  test("Two Esc bytes in one read: with a turn running and the prompt box focused, ESC ESC cancels the turn", async () => {
    const run = startCli("basic", 1000);
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    await run.s.waitFor((p) => promptFocused(p), 5000);
    run.s.write("\x1b\x1b");
    await run.s.waitFor(() => run.methods().includes("session/cancel"), 5000);
    await run.s.waitFor(READY, 5000);
    expect(run.s.exitCode).toBeNull();
  }, 20000);

  test("Two Esc bytes in one read from a focused card: focus returns, interrupt arms, and the second Esc cancels, answering the request cancelled", async () => {
    const run = startCli("basic", 100, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(CARD_HEADER, 10000);
    run.s.write("\x1b\x1b");
    await run.s.waitFor(() => run.methods().includes("session/cancel"), 5000);
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "cancelled" } }]);
    await run.s.waitFor((p) => READY.test(p.screenText().join("\n")) && promptFocused(p), 5000);
  }, 30000);

  test.each([
    ["the docked card", []],
  ])("tab then a digit in one write (%s): with a card open and the conversation focused, tab, 3 and enter answer with the third option", async (_name, args) => {
    // delay-scale 100: about 2 s from the prompt being sent to the permission request.
    const run = startCli("basic", 100, { cols: 63, rows: 21, args });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(CARD_HEADER, 10000);
    // The card took focus (the prompt box was empty): Tab to the prompt box, Tab to the conversation.
    run.s.sendKeys("Tab", "Tab");
    await run.s.waitFor((p) => conversationFocused(p), 5000);
    // Past the card's 300 ms typing guard.
    await Bun.sleep(400);
    run.s.write("\t3\r");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "selected", optionId: "reject-once" } }]);
  }, 30000);

  test("Two Tabs, a digit and Enter in one write from the prompt box reach the card, and the draft is unchanged", async () => {
    const run = startCli("basic", 100, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(RUNNING, 5000);
    // A draft keeps focus in the prompt box when the card appears.
    run.s.sendKeys({ text: "n" });
    await run.s.waitFor(CARD_HEADER, 10000);
    await Bun.sleep(400);
    expect(promptFocused(run.s)).toBe(true);
    run.s.write("\t\t2\r");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)).toEqual([{ outcome: { outcome: "selected", optionId: "allow-always" } }]);
  }, 30000);
});
