// mvp-chrome-and-keys task 2.1 verification: `acp-tui -- fake-agent --scenario config-options`
// under the PTY harness. acp-tui does not render commands yet, so the check is on fake-agent's
// log: it records both `available_commands_update`s as sent (one after session/new, one at the
// end of the first turn) and the session carries on.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { startCli } from "../keys/cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

describe("fake-agent config-options commands under acp-tui (mvp-chrome-and-keys task 2.1)", () => {
  test("the log records both available_commands_update, the second dropping one command", async () => {
    const run = startCli("config-options", 0, { cols: 63, rows: 21 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    const sent = () =>
      run
        .entries()
        .filter((entry) => entry.method === "session/update/sent")
        .map((entry) => (entry.params as { update: { sessionUpdate: string; availableCommands?: { name: string; input?: { hint: string } }[] } }).update);

    // After session/new, before any prompt.
    await run.s.waitFor(() => sent().length === 1, 5000);
    expect(sent()[0]?.availableCommands?.map((command) => [command.name, command.input?.hint ?? null])).toEqual([
      ["review", "PR number"],
      ["compact", null],
    ]);

    // At the end of the first turn.
    run.s.sendKeys({ text: "go" }, "Enter");
    await run.s.waitFor(() => sent().length === 2, 5000);
    expect(sent().map((update) => update.sessionUpdate)).toEqual(["available_commands_update", "available_commands_update"]);
    expect(sent()[1]?.availableCommands?.map((command) => command.name)).toEqual(["review"]);

    // acp-tui carried on: the turn finished and it is idle again.
    await run.s.waitFor(READY, 5000);
  }, 30000);
});
