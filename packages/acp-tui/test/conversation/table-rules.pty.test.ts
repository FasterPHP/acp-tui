// Rules between table rows in the real CLI (spec tui-rendering "Rules between table rows",
// scenario "Copy ignores the rules"): fake-agent's `copy-fixtures` table in a narrow pane, where
// its cells wrap, drawn with the default `auto` (rules between the body rows) and with `never`;
// the table copied whole (`y` on its item) is the same text either way.
import { afterEach, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { configEnv } from "../pty/config-home.ts";
import { localEnv, osc52Payloads } from "../selection/pty.ts";
import { sendPrompt, startCli, type CliRun } from "./cli.ts";

let run: CliRun | undefined;
afterEach(async () => {
  await run?.session.dispose();
  run = undefined;
});

const ruleRows = (s: PtySession) => s.screenText().filter((l) => /^\s*├/.test(l));

async function copyTable(rules: "never" | undefined): Promise<{ copied: string; rules: number }> {
  const config = { density: "compact", ...(rules ? { markdown: { table_row_rules: rules } } : {}) };
  run = startCli({ scenario: "copy-fixtures", cols: 50, rows: 90, env: { ...configEnv(config), ...localEnv() } });
  const s = run.session;
  await sendPrompt(s, "give me things to copy");
  await s.waitFor((p) => READY.test(p.screenText().join("\n")) && p.screenText().some((l) => /^\s*╰/.test(l)) && p.screenText().some((l) => l.includes("The third paragraph")), 15000);
  const rules0 = ruleRows(s).length;
  s.sendKeys("Tab"); // the conversation, cursor on the last item
  await Bun.sleep(100);
  s.sendKeys("Home"); // the user's prompt
  for (let k = 0; k < 2; k++) {
    s.sendKeys({ text: "j" });
    await Bun.sleep(50);
  }
  s.sendKeys({ text: "y" }); // the table
  await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > 0, 5000);
  return { copied: osc52Payloads(s.rawOutput())[0]!, rules: rules0 };
}

test("a ruled table copies the same text as an unruled one", async () => {
  const ruled = await copyTable(undefined);
  await run?.session.dispose();
  const plain = await copyTable("never");
  // The header rule is the only one under `never`; `auto` adds one between each pair of body rows
  // of a table whose cells wrap (three body rows: two more).
  expect(plain.rules).toBe(1);
  expect(ruled.rules).toBe(3);
  expect(ruled.copied).toBe(plain.copied);
  expect(ruled.copied).toContain("created_at");
  expect(ruled.copied).not.toMatch(/[├┼┤─]/);
}, 60000);
