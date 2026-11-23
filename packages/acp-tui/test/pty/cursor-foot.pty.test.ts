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
test.skipIf(WINDOWS)("foot with a light theme: the cursor is black, never white, and reset at exit", async () => {
  run = startCli({ scenario: "basic", colours: FOOT_LIGHT, cols: 101, rows: 49 });
  const s = run.session;
  await s.waitFor(READY, 15000);
  // The cursor's colour is chosen from the replies and written when the prompt box's cursor shows.
  await s.waitFor((p) => p.rawOutput().includes("\x1b]12;#000000\x07"), 5000);
  s.sendKeys("Ctrl+D");
  await s.wait();
  expect(cursorColourProblems(s.rawOutput(), REPLIES, { allowTeardownDefault: true })).toEqual([]);
}, 30000);
