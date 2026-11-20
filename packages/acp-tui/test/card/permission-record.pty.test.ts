// A permission answered against fake-agent's `auggie-1` `permission` turn, its record read in
// verbose density: the question keeps its line breaks, the command on its own row.
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

const rowsOf = (s: PtySession) => s.screenText().map((r) => r.replace(/[│┃▏▕]/g, "").trim());

test.skipIf(WINDOWS)("the expanded permission record keeps the question's lines; collapsed it is one line", async () => {
  const w = listWorld();
  const repo = w.dir("repo");
  w.configure({ auggie: ["--scenario", "auggie-1", "--allow-indexing"] }, { density: "verbose" });
  session = w.start(["auggie"], { cwd: repo, cols: 100, rows: 60 });
  const s = session;
  await s.waitFor(READY, 20000);
  s.sendKeys({ text: "permission" }, "Enter");
  await s.waitFor((p) => p.screenText().some((r) => r.includes("1 Yes")), 15000);
  await Bun.sleep(400);
  s.sendKeys("Enter");
  await s.waitFor((p) => rowsOf(p).some((r) => /^permission\s+Yes$/.test(r)), 10000);
  const rows = rowsOf(s);
  const at = rows.findIndex((r) => /^permission\s+Yes$/.test(r));
  // The header keeps the answer; the question follows, the command on its own row, indented.
  const body = rows.slice(at + 1).filter((r) => r !== "").slice(0, 3);
  expect(body[0]).toMatch(/^⚠️\s+Tool "bash" requires approval:$/);
  expect(body.slice(1)).toEqual(["echo allowed-probe", "Allow?"]);
  // The record's own row (the tool call's row says execute).
  const raw = s.screenText().filter((r) => r.includes("echo allowed-probe") && !r.includes("execute"));
  expect(raw).toHaveLength(1);
  expect(raw[0]).not.toContain("Allow?");
  // Indented two columns past the question's other lines.
  const indent = (r: string) => r.length - r.trimStart().length;
  const allow = s.screenText().find((r) => r.includes("Allow?") && !r.includes("approval"))!;
  expect(indent(raw[0]!.replace(/[│┃▏▕]/g, " "))).toBe(indent(allow.replace(/[│┃▏▕]/g, " ")) + 2);
  expect(s.screenText().some((r) => r.includes("approval: echo"))).toBe(false);
}, 60000);
