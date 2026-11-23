// The prompt box's cursor colour against a terminal that answers like foot 1.28.0 with a light
// theme: OSC 4 for the palette, the three colours, BEL terminators, and `OSC 12 ?` answered with
// the colour the program set last (foot reports its current cursor colour). The recording this
// reproduces is test/fixtures/foot-light-cursor.txt.
import { afterEach, expect, test } from "bun:test";
import { startCli, type CliRun } from "../conversation/cli.ts";
import { READY } from "./regions.ts";
import { cursorColourProblems, type TerminalReplies } from "./cursor-colour.ts";
import type { OscColours } from "./harness.ts";
import { WINDOWS } from "../windows.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGKILL");
  await run?.session.dispose();
  run = undefined;
});

const REPLIES: TerminalReplies = { foreground: "#212121", background: "#fafafa", cursor: "#000000" };
const GREYS = Array.from({ length: 16 }, (_, i) => `#${(i * 17).toString(16).padStart(2, "0").repeat(3)}`);
const FOOT_LIGHT: OscColours = { ...REPLIES, palette: GREYS, terminator: "bel", cursorFollowsSet: true };

// Skipped on Windows: ConPTY answers or swallows the terminal's colour queries itself.
// Currently fails (the cursor stays white: foot reports the white acp-tui set, and that is adopted);
// the cursor colour change flips `test.failing` to `test`.
test.skipIf(WINDOWS).failing("foot with a light theme: the cursor is black, never white, and reset at exit", async () => {
  run = startCli({ scenario: "basic", colours: FOOT_LIGHT, cols: 101, rows: 49 });
  const s = run.session;
  await s.waitFor(READY, 15000);
  // The colour query goes out after the first frame; its outcome is a second OSC 12 or, when
  // nothing is adopted, nothing at all: wait for the black, and go on without it after 3 s.
  await s.waitFor((p) => p.rawOutput().includes("\x1b]12;?\x07"), 5000);
  await s.waitFor((p) => p.rawOutput().includes("\x1b]12;#000000\x07"), 3000).catch(() => {});
  s.sendKeys("Ctrl+D");
  await s.wait();
  expect(cursorColourProblems(s.rawOutput(), REPLIES, { allowTeardownDefault: true })).toEqual([]);
}, 30000);
