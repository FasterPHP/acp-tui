// Phase 1a task 16.1: ACP_TUI_LOG records the types of each tool call's content
// (S7 follow-up: did the agent send `terminal` content?), never its text.
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { startCli, type CliRun } from "./cli.ts";

let run: CliRun | undefined;

/** Waits for a debug-log event; the log, not the screen, so layout changes do not matter here. */
async function waitEvent(r: CliRun, name: string, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms;
  while (r.events(name).length === 0) {
    if (Date.now() > deadline) throw new Error(`no ${name} event in ${ms} ms`);
    await Bun.sleep(20);
  }
}

afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

test("basic: tool_content events carry types (diff, content/text) and no content text", async () => {
  run = startCli({ scenario: "basic" });
  const s = run.session;
  await waitEvent(run, "session_new_response");
  await Bun.sleep(300);
  s.sendKeys({ text: "hello there" });
  await Bun.sleep(300);
  s.sendKeys("Enter");
  await waitEvent(run, "permission_opened");
  await Bun.sleep(450); // the permission prompt's key guard
  s.sendKeys("1"); // selects the first option (answers it in the Phase 0 card)
  await Bun.sleep(150);
  s.sendKeys("Enter"); // answers the selection; an empty composer ignores it
  await waitEvent(run, "prompt_response");

  const events = run.events("tool_content");
  expect(events).toContainEqual(
    expect.objectContaining({ source: "tool_call_update", toolCallId: "t2", content: [{ type: "diff" }] }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      source: "tool_call_update",
      toolCallId: "t1",
      content: [{ type: "content", block: "text" }],
    }),
  );

  const raw = readFileSync(run.logPath, "utf8");
  for (const text of ["FAKE_AGENT_PACKAGE_NAME", "new line 12", "line 10", "/work/src/index.ts", "hello there"]) {
    expect(raw).not.toContain(text);
  }
}, 20000);
