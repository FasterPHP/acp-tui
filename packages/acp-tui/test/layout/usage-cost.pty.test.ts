// day-one-feedback task 11.1 (spec model-session "Cost kept when an update omits it"): against
// fake-agent's `usage-without-cost`, the agent reports its cost once, at the end of turn 1, and
// sends usage updates with `used` and `size` only in turn 2, as claude-agent-acp 0.81.2 does. The
// status row shows `$0.42` after turn 1 and still during and after turn 2.
import { afterEach, expect, test } from "bun:test";
import { READY, RUNNING, statusRow } from "../pty/regions.ts";
import { sendPrompt, settle, startCli, type CliRun } from "../conversation/cli.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

const usageUpdates = (r: CliRun) => r.events("session_update").filter((e) => e["sessionUpdate"] === "usage_update").length;

test("the cost stays in the status row when later usage updates omit it", async () => {
  // 80 columns: the cost (priority 75) is shown at IDE-pane widths too (status.pty.test.ts).
  run = startCli({ scenario: "usage-without-cost", cols: 80, rows: 24, delayScale: 6 });
  const s = run.session;

  await sendPrompt(s, "turn one");
  await s.waitFor(/end turn/, 15000);
  await s.waitFor((p) => READY.test(p.screenText().join("\n")), 10000);
  await s.waitFor((p) => statusRow(p).includes("$0.42"), 5000);
  expect(usageUpdates(run)).toBe(1);

  // Turn 2: its first usage update (used and size only) arrives, and the turn is still running.
  await sendPrompt(s, "turn two");
  await s.waitFor(() => usageUpdates(run!) === 2, 10000);
  // (the agent pauses 6 s before its second update, so the turn is running for a while)
  await s.waitFor((p) => RUNNING.test(p.screenText().join("\n")) && statusRow(p).includes("$0.42"), 5000);
  expect(usageUpdates(run)).toBe(2);

  // The turn ends after its second update: still there.
  await s.waitFor(() => usageUpdates(run!) === 3, 10000);
  await s.waitFor((p) => READY.test(p.screenText().join("\n")), 10000);
  await settle(s, 100);
  expect(statusRow(s)).toContain("$0.42");
}, 60000);
