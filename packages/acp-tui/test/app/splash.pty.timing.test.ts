// tui-layout "Start-up progress" ("Long start"): the seconds the splash shows from the fifth on,
// captured at fixed times, so a timing file.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { listWorld } from "../session/list-world.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

describe("start-up progress on the splash", () => {
  test("Long start: at 3 seconds `starting…` with no seconds, at 7 seconds `starting… 6 s` or 7 s, and the harness name in the same columns", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "basic", "--start-delay", "9000"] });
    const began = Date.now();
    const s = (session = w.start(["-a", "fake"], { cwd: repo, cols: 100, rows: 30 }));
    await s.waitFor((p) => p.screenText().join("\n").includes("starting…"), 10000);
    const row = (): string => s.screenText().find((r) => r.includes("Harness:"))!;
    await Bun.sleep(Math.max(0, began + 3000 - Date.now()));
    await s.flush();
    const early = row();
    expect(early.trim()).toMatch(/^Harness: fake · \S starting…$/);
    await Bun.sleep(Math.max(0, began + 7000 - Date.now()));
    await s.flush();
    const late = row();
    expect(late.trim()).toMatch(/^Harness: fake · \S starting… [67] s$/);
    expect(late.indexOf("Harness:")).toBe(early.indexOf("Harness:"));
    await s.waitFor(READY, 15000);
  }, 40000);
});
