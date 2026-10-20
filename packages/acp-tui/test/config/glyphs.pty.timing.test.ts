// parallel-tests task 3.4: the glyph reload test whose assertion is a time bound (a reload to the ascii set redraws the permission card within a second), which runs in the serial pass.
// What the file covers is in the header of glyphs.pty.test.ts; its helpers are in glyphs-pty-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { sendPrompt } from "../conversation/cli.ts";
import { configHome, run, disposeSessions } from "./glyphs-pty-helpers.ts";

afterEach(disposeSessions);

describe("ASCII set (task 7.2)", () => {
  test("the default permission card has the unicode marker, and a reload to ascii redraws it within a second", async () => {
    const cfg = configHome(`{}`);
    const r = run({ scenario: "basic", cols: 80, rows: 40, env: { XDG_CONFIG_HOME: cfg.home } });
    const s = r.session;
    await sendPrompt(s, "go");
    await s.waitFor((p) => p.screenText().some((l) => l.startsWith("╭─ ◊ Permission")), 10000);
    const saved = Date.now();
    cfg.write(`{ "glyphs": { "set": "ascii", "overrides": { "permission.marker": "&" } } }`);
    await s.waitFor((p) => p.screenText().some((l) => l.startsWith("+- & Permission")), 1000);
    expect(Date.now() - saved).toBeLessThan(1000);
    expect(s.screenText().some((l) => l.startsWith("╭─ ◊ Permission"))).toBe(false);
    cfg.write(`{}`);
    await s.waitFor((p) => p.screenText().some((l) => l.startsWith("╭─ ◊ Permission")), 1000);
  }, 30000);
});
