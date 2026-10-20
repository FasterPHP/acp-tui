// The JediTerm half of safe-sgr.test.ts (parallel-tests task 2.2; read its header): every fake-agent
// scenario run as PhpStorm's terminals identify themselves (`TERMINAL_EMULATOR=JetBrains-JediTerm`)
// must write no SGR with a colon and none with parameter 9, 53 or 58. Split out so that the two
// halves of the old 65-test file run in different workers.
import { afterEach, describe, expect, test } from "bun:test";
import { ROWS, RUN_LIMIT_MS, SCENARIOS, disposeSession, findUnsafeSgr, runScenario } from "./safe-sgr-helpers.ts";
import { WINDOWS } from "../windows.ts";

afterEach(disposeSession);

// Skipped on Windows: it scans the raw SGR bytes of the PTY stream, which ConPTY rewrites.
describe.skipIf(WINDOWS)("Output stream over every scenario", () => {
  for (const terminal of ["jetbrains"] as const) {
    for (const name of Object.keys(SCENARIOS)) {
      test(`${name} (${terminal} terminal): no SGR with a colon, none with parameter 9, 53 or 58`, async () => {
        const raw = await runScenario(name, terminal, ROWS[name]);
        // The run reached the alternate screen and drew truecolour surfaces, so the scan means something.
        expect(raw).toContain("\x1b[?1049h");
        expect(raw).toMatch(/\x1b\[[0-9;]*48;2;/);
        expect(findUnsafeSgr(raw)).toEqual([]);
      }, RUN_LIMIT_MS + 15000);
    }
  }
});
