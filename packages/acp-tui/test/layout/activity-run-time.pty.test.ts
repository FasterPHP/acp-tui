// Spec tui-layout "Activity line run time" and "Activity line linger" (change run-time-and-cmd-keys):
// the running turn's run time at the right of the activity line, against fake-agent, in place of the
// turn's count that focus-groups put there. `task-messages --hold` holds turn 2's last call in
// progress; `usage-without-cost` sends a message and no call; `fast-tools` with a long linger ends its
// turn while the line still lingers; `basic` opens a permission request. The run time ticks once a
// second, so it is matched as a pattern, never as an exact second. The clock-bound linger scenarios
// are in activity-linger.pty.timing.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { sendPrompt, startCli } from "../conversation/cli.ts";
import { configEnv } from "../pty/config-home.ts";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, READY, RUNNING, statusRow, withoutBar } from "../pty/regions.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

/** A run time as `formatElapsed` draws it: `7s`, `4m 35s`, `2h 03m`. */
const RUN_TIME = /(?:\d+s|\d+m \d{2}s|\d+h \d{2}m)$/;

/** The prompt box's top border row; -1 if none. */
function boxTop(s: PtySession): number {
  const rows = s.screenText();
  const box = promptBox(s);
  return rows.findIndex((row, y) => row === box[0] && rows[y + box.length - 1] === box.at(-1));
}

/** The activity line (the row above the prompt box, trimmed on the right and without the scroll
 *  bar's glyph). */
function line(s: PtySession): string {
  return (withoutBar(s.screenText())[boxTop(s) - 1] ?? "").trimEnd();
}

/** Turn 1 to its end, then turn 2 held with its last call in progress. */
async function held(cols: number, rows: number, env?: Record<string, string | undefined>) {
  const run = startCli({ scenario: "task-messages", agentArgs: ["--hold"], delayScale: 0, cols, rows, env });
  session = run.session;
  await sendPrompt(run.session, "one");
  await run.session.waitFor("Task 2 done.", 10000);
  await run.session.waitFor(READY, 10000);
  await sendPrompt(run.session, "two");
  await run.session.waitFor((p) => /^ {2}(?:\w+ )?Run tm-final\b/.test(line(p)), 10000);
  return run;
}

describe("activity line run time", () => {
  test("Run time beside the running call: the call's title at the left, the run time ending where the tool lines' index ends, no count", async () => {
    const run = await held(90, 30, configEnv({ density: "compact" }));
    const text = line(run.session);
    expect(text).toMatch(/^ {2}(?:\w+ )?Run tm-final\b.* +running \d+s$/);
    expect(text).not.toMatch(/tool calls?|thoughts?/);
    // Its last column is the one a tool line's index ends in.
    const tool = withoutBar(run.session.screenText()).find((l) => /^ {2}[→←] .* #\d+$/.test(l));
    expect(tool).toBeDefined();
    expect(text).toHaveLength(tool!.trimEnd().length);
    // The status row says nothing of the running state: the word is beside the time.
    expect(statusRow(run.session)).not.toMatch(/running/);
  });

  test("the run time is there in every density", async () => {
    for (const density of ["compact", "focus", "full"] as const) {
      const run = await held(90, 30, configEnv({ density }));
      expect(line(run.session)).toMatch(/^ {2}(?:\w+ )?Run tm-final\b.* +running \d+s$/);
      run.session.kill("SIGTERM");
      await run.session.dispose();
      session = undefined;
    }
  }, 60000);

  test("Ticking: the run time counts up while the call is held", async () => {
    const run = await held(90, 30);
    const first = RUN_TIME.exec(line(run.session))?.[0];
    expect(first).toBeDefined();
    await run.session.waitFor((p) => {
      const now = RUN_TIME.exec(line(p))?.[0];
      return now !== undefined && now !== first;
    }, 5000);
  });

  test("Run time before anything runs: a turn that has sent only a message shows the run time alone", async () => {
    const run = startCli({ scenario: "usage-without-cost", delayScale: 6, cols: 90, rows: 30 });
    session = run.session;
    await sendPrompt(run.session, "one");
    await run.session.waitFor(READY, 15000);
    await sendPrompt(run.session, "two");
    await run.session.waitFor(RUNNING, 5000);
    await run.session.waitFor((p) => /^ +running \d+s$/.test(line(p)), 5000);
    expect(line(run.session).trim()).toMatch(/^running \d+s$/);
  }, 30000);

  test("Idle: before the first prompt and after a turn the activity line is blank", async () => {
    const run = startCli({ scenario: "usage-without-cost", delayScale: 1, cols: 90, rows: 30 });
    session = run.session;
    await run.session.waitFor(READY, 15000);
    expect(line(run.session)).toBe("");
    await sendPrompt(run.session, "one");
    await run.session.waitFor((p) => /end turn/.test(p.screenText().join("\n")), 15000);
    await run.session.waitFor(READY, 15000);
    await run.session.flush();
    expect(line(run.session)).toBe("");
  }, 30000);

  test("Narrow pane: at 50 columns the call's title is truncated or dropped and the run time is still shown", async () => {
    const run = await held(50, 30, configEnv({ density: "compact" }));
    const text = line(run.session);
    expect(text).toMatch(/ running \d+s$/);
    expect(text.length).toBeLessThanOrEqual(47);
  });
});

describe("activity line linger with the run time", () => {
  test("Turn ends during the linger: the next frame shows a blank activity line on the same row", async () => {
    // A linger of 5 s outlasts fast-tools' 3 s silence, so the turn ends while the line lingers.
    const run = startCli({ scenario: "fast-tools", delayScale: 0.3, cols: 90, rows: 30, env: configEnv({ density: "compact", activity: { linger_seconds: 5 } }) });
    session = run.session;
    await sendPrompt(run.session, "go");
    await run.session.waitFor((p) => /^ {2}✓ (?:\w+ )?Edit src\/Pool\.php +running \d+s$/.test(line(p)), 10000);
    const top = boxTop(run.session);
    await run.session.waitFor("Pool now releases its connections", 10000);
    await run.session.waitFor((p) => /end turn/.test(p.screenText().join("\n")), 10000);
    await run.session.flush();
    expect(boxTop(run.session)).toBe(top);
    expect(line(run.session)).toBe("");
  }, 30000);
});
