// The turn's totals in the turn-end line (focus-groups tasks 3.1 and 3.2; specs tui-conversation
// "Turn totals in the turn-end line" and "Interrupted turns") through the real CLI against
// fake-agent: `task-messages` for the turns with several gaps, `auggie-1` and `slow-turn` for the
// turns with one.
import { afterEach, describe, expect, test } from "bun:test";
import { configHome } from "../pty/config-home.ts";
import { withoutBar } from "../pty/regions.ts";
import { count, sendPrompt, settle, startCli, type CliRun } from "./cli.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const DURATION = String.raw`\d+(?:\.\d)?(?:ms|s)`;
const rows = (r: CliRun) => withoutBar(r.session.screenText());

async function interrupt(r: CliRun): Promise<void> {
  const s = r.session;
  s.sendKeys("Esc");
  await s.waitFor(/esc again to interrupt/, 5000);
  s.sendKeys("Esc");
}

describe("turn totals in the turn-end line", () => {
  for (const density of ["focus", "compact", "verbose"] as const) {
    test(`totals of a turn: turn 1 of task-messages in ${density}`, async () => {
      run = startCli({ scenario: "task-messages", rows: 80, env: configHome({ density }).env });
      await sendPrompt(run.session, "go");
      await run.session.waitFor(new RegExp(String.raw`^ {2}end turn · 6 tool calls \(1 failed\) · 1 thought · ${DURATION}`, "m"), 15000);
      await settle(run.session);
      expect(count(run.session, new RegExp(String.raw`^ {2}end turn · 6 tool calls \(1 failed\) · 1 thought · ${DURATION}$`))).toBe(1);
    });
  }

  test("interrupted on a running call: task-messages --hold, turn 2", async () => {
    run = startCli({ scenario: "task-messages", rows: 80, agentArgs: ["--hold"], env: configHome({ density: "focus" }).env });
    const s = run.session;
    await sendPrompt(s, "first");
    await s.waitFor(/^ {2}end turn · 6 tool calls/m, 15000);
    await sendPrompt(s, "second");
    await s.waitFor(/Run tm-final/, 15000);
    await s.waitFor(() => rows(run!).some((r) => /Found it\./.test(r)), 5000);
    await Bun.sleep(300);
    await interrupt(run);
    await s.waitFor(new RegExp(String.raw`^ {2}interrupted · 2 tool calls \(1 stopped\) · 1 thought · ${DURATION}`, "m"), 10000);
    await settle(s);
    expect(count(s, new RegExp(String.raw`^ {2}interrupted · 2 tool calls \(1 stopped\) · 1 thought · ${DURATION}$`))).toBe(1);
    // The first turn's line is as it was.
    expect(count(s, new RegExp(String.raw`^ {2}end turn · 6 tool calls \(1 failed\) · 1 thought · ${DURATION}$`))).toBe(1);
  });

  test("turn 2 of task-messages without the hold: two tool calls, one thought", async () => {
    run = startCli({ scenario: "task-messages", rows: 80, env: configHome({ density: "focus" }).env });
    const s = run.session;
    await sendPrompt(s, "first");
    await s.waitFor(/^ {2}end turn · 6 tool calls/m, 15000);
    await sendPrompt(s, "second");
    await s.waitFor(new RegExp(String.raw`^ {2}end turn · 2 tool calls · 1 thought · ${DURATION}$`, "m"), 15000);
  });

  test("the context goes first, then the totals, in a pane too narrow for them", async () => {
    run = startCli({ scenario: "task-messages", cols: 40, rows: 80, env: configHome({ density: "focus" }).env });
    const s = run.session;
    await sendPrompt(s, "go");
    // 40 columns less the margins: the line fits only without totals.
    await s.waitFor(new RegExp(String.raw`^ {2}end turn · ${DURATION}$`, "m"), 15000);
    await settle(s);
    expect(rows(run).some((r) => /tool calls/.test(r) && /end turn/.test(r))).toBe(false);
  });
});

describe("interrupted turns", () => {
  test("agent says end_turn after the interrupt: interrupted, no totals (one run)", async () => {
    run = startCli({ scenario: "auggie-1", agentArgs: ["--allow-indexing"], env: configHome({ density: "focus" }).env });
    const s = run.session;
    await sendPrompt(s, "slow");
    await s.waitFor(/sleep 30/, 15000);
    await Bun.sleep(300);
    await interrupt(run);
    await s.waitFor(new RegExp(String.raw`^ {2}interrupted · ${DURATION}$`, "m"), 15000);
    await settle(s);
    expect(count(s, /^ {2}end turn/)).toBe(0);
  });

  test("agent says cancelled after the interrupt: interrupted with its duration", async () => {
    run = startCli({ scenario: "slow-turn", delayScale: 4, env: configHome({ density: "focus" }).env });
    const s = run.session;
    await sendPrompt(s, "go");
    await s.waitFor(/requires_action|Read|st-1|tool/i, 10000);
    await Bun.sleep(300);
    await interrupt(run);
    await s.waitFor(new RegExp(String.raw`^ {2}interrupted · ${DURATION}$`, "m"), 15000);
    expect(count(s, /^ {2}cancelled/)).toBe(0);
  });

  test("a turn not interrupted keeps end turn", async () => {
    run = startCli({ scenario: "auggie-1", agentArgs: ["--allow-indexing"], env: configHome({ density: "focus" }).env });
    const s = run.session;
    await sendPrompt(s, "hello");
    await s.waitFor(new RegExp(String.raw`^ {2}end turn · ${DURATION}$`, "m"), 15000);
  });
});
