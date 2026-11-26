// focus-groups task 4.2 (spec tui-layout "Activity line contents" and "Activity line linger"; design
// D6): the turn's count at the right of the activity line, against fake-agent. `task-messages --hold`
// holds turn 2's last call in progress; `usage-without-cost` sends a message and no call; `fast-tools`
// with a long linger ends its turn while the line still lingers. The clock-bound linger scenarios
// are in activity-linger.pty.timing.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { sendPrompt, startCli } from "../conversation/cli.ts";
import { configEnv } from "../pty/config-home.ts";
import type { PtySession } from "../pty/harness.ts";
import { ACTIVITY_COUNT, promptBox, READY, RUNNING, withoutBar } from "../pty/regions.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

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
async function held(cols: number, rows: number, env?: Record<string, string | undefined>, shown = /Run tm-final.*\(1 running\)/) {
  const run = startCli({ scenario: "task-messages", agentArgs: ["--hold"], delayScale: 0, cols, rows, env });
  session = run.session;
  await sendPrompt(run.session, "one");
  await run.session.waitFor("Task 2 done.", 10000);
  await run.session.waitFor(READY, 10000);
  await sendPrompt(run.session, "two");
  await run.session.waitFor((p) => shown.test(line(p)), 10000);
  return run;
}

describe("activity line contents (task 4.2)", () => {
  test("Count beside the running call: the call's title at the left and `2 tool calls (1 running) · 1 thought` ending where the tool lines' index ends", async () => {
    const run = await held(90, 30, configEnv({ density: "compact" }));
    const text = line(run.session);
    expect(text).toMatch(/^ {2}Run tm-final\b.* +2 tool calls \(1 running\) · 1 thought$/);
    expect(ACTIVITY_COUNT.exec(text)?.[0]).toBe("2 tool calls (1 running) · 1 thought");
    // Its last column is the one a tool line's index ends in.
    const tool = withoutBar(run.session.screenText()).find((l) => /^ {2}[→←] .* #\d+$/.test(l));
    expect(tool).toBeDefined();
    expect(text).toHaveLength(tool!.trimEnd().length);
  });

  test("the count is there in every density, with the focus lines above it", async () => {
    for (const density of ["compact", "focus", "full"] as const) {
      const run = await held(90, 30, configEnv({ density }));
      expect(line(run.session)).toMatch(/^ {2}Run tm-final\b.* +2 tool calls \(1 running\) · 1 thought$/);
      run.session.kill("SIGTERM");
      await run.session.dispose();
      session = undefined;
    }
  }, 60000);

  test("One gap, no count: turn 1 of task-messages at delay scale 50 shows the first call's title alone while it runs, before any message", async () => {
    const run = startCli({ scenario: "task-messages", delayScale: 50, cols: 90, rows: 30 });
    session = run.session;
    await sendPrompt(run.session, "go");
    await run.session.waitFor((p) => line(p) === "  Read tm-first.txt", 10000);
    expect(run.session.screenText().join("\n")).not.toContain("Task 1 started.");
    expect(ACTIVITY_COUNT.test(line(run.session))).toBe(false);
  }, 30000);

  test("Count before anything runs: a turn that has sent only a message has a blank activity line", async () => {
    const run = startCli({ scenario: "usage-without-cost", delayScale: 6, cols: 90, rows: 30 });
    session = run.session;
    await sendPrompt(run.session, "one");
    await run.session.waitFor(READY, 15000);
    await sendPrompt(run.session, "two");
    // The second turn sends a message and two usage updates over a second: no call, no thought.
    await run.session.waitFor(RUNNING, 5000);
    for (let i = 0; i < 10; i++) {
      await run.session.flush();
      expect(line(run.session)).toBe("");
      await Bun.sleep(50);
    }
  }, 30000);

  test("Narrow pane: at 50 columns the call's title is truncated or dropped and `2 tool calls (1 running)` is still shown", async () => {
    const run = await held(50, 30, configEnv({ density: "compact" }), /2 tool calls \(1 running\)/);
    const text = line(run.session);
    expect(text).toContain("2 tool calls (1 running)");
    expect(text.length).toBeLessThanOrEqual(47);
    expect(text).toMatch(/^ {2}(Run tm-\S*… · )?(plan \d\/\d)?.*2 tool calls/);
  });
});

describe("activity line linger with the count (task 4.2)", () => {
  test("Turn ends during the linger: the next frame shows a blank activity line on the same row and the end line carries the counts", async () => {
    // A linger of 5 s outlasts fast-tools' 3 s silence, so the turn ends while the line lingers.
    const run = startCli({ scenario: "fast-tools", delayScale: 0.3, cols: 90, rows: 30, env: configEnv({ density: "compact", activity: { linger_seconds: 5 } }) });
    session = run.session;
    await sendPrompt(run.session, "go");
    await run.session.waitFor((p) => /^ {2}✓ Edit src\/Pool\.php$/.test(line(p)), 10000);
    const top = boxTop(run.session);
    await run.session.waitFor("Pool now releases its connections", 10000);
    await run.session.waitFor((p) => /end turn/.test(p.screenText().join("\n")), 10000);
    await run.session.flush();
    expect(boxTop(run.session)).toBe(top);
    expect(line(run.session)).toBe("");
  }, 30000);
});
