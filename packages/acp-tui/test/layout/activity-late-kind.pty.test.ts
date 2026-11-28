// Auggie's `late` and `tools` turns in fake-agent. Spec tui-layout "Activity line run time" (run-time-and-cmd-keys design D9): a call whose kind and
// input arrive in an update after its first `tool_call` (Auggie's `late` turn in fake-agent) shows
// its kind on the activity row while it runs.
import { afterEach, expect, test } from "bun:test";
import { sendPrompt, startCli } from "../conversation/cli.ts";
import type { PtySession } from "../pty/harness.ts";
import { configEnv } from "../pty/config-home.ts";
import { promptBox, withoutBar } from "../pty/regions.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function line(s: PtySession): string {
  const rows = s.screenText();
  const box = promptBox(s);
  const top = rows.findIndex((row, y) => row === box[0] && rows[y + box.length - 1] === box.at(-1));
  return (withoutBar(rows)[top - 1] ?? "").trimEnd();
}

test("a kind that arrives in an update shows on the activity row while the call runs", async () => {
  const run = startCli({ scenario: "auggie-1", delayScale: 1, cols: 90, rows: 30, agentArgs: ["--allow-indexing"] });
  session = run.session;
  await sendPrompt(run.session, "late");
  await run.session.waitFor((p) => /^ {2}read src\/late-kind\.ts +running \d+s$/.test(line(p)), 10000);
});

test("the line that lingers after a call finishes names its kind too (a quick Auggie read or write)", async () => {
  const run = startCli({ scenario: "auggie-1", delayScale: 1, cols: 90, rows: 30, agentArgs: ["--allow-indexing"], env: configEnv({ activity: { linger_seconds: 20 } }) });
  session = run.session;
  await sendPrompt(run.session, "late");
  await run.session.waitFor((p) => /^ {2}✓ read src\/late-kind\.ts +running \d+s$/.test(line(p)), 10000);
}, 30000);
