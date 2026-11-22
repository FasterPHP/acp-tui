// The `tools` turn of fake-agent's `auggie-1` scenario in verbose density: the output of
// `seq 1 3` is drawn one line to a row, not joined as `1 2 3`.
import { afterEach, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { listWorld } from "../session/list-world.ts";
import { WINDOWS } from "../windows.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

test.skipIf(WINDOWS)("verbose density draws seq output on separate rows", async () => {
  const w = listWorld();
  const repo = w.dir("repo");
  w.configure({ auggie: ["--scenario", "auggie-1", "--allow-indexing"] }, { density: "verbose" });
  session = w.start(["auggie"], { cwd: repo, cols: 100, rows: 60 });
  const s = session;
  await s.waitFor(READY, 20000);
  s.sendKeys({ text: "tools" }, "Enter");
  await s.waitFor("seq succeeded", 15000);
  const rows = s.screenText().map((r) => r.replace(/[│┃▏▕]/g, "").trim());
  const at = rows.findIndex((r) => r === "1");
  expect(at).toBeGreaterThan(-1);
  expect(rows.slice(at, at + 3)).toEqual(["1", "2", "3"]);
  expect(rows.join("\n")).not.toContain("1 2 3");
}, 40000);
