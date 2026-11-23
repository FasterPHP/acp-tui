// Smoke tests for the PTY harness (task 6.2 of Phase 0): a program runs at the
// requested size, a resize reaches it as SIGWINCH, and the emulator records
// raw output and answers terminal queries. Run against the alternate-screen
// probe (test/pty/screen-probe.tsx); test/pty/screen-probe.test.ts covers the
// phase-1a extensions. The Phase 0 checks of inline scrollback commits
// went with the inline renderer.
import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { startPty, type OscColours, type PtySession } from "./harness.ts";
import { WINDOWS } from "../windows.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const PROBE = "packages/acp-tui/test/pty/screen-probe.tsx";

let session: PtySession | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

function start(cols = 80, rows = 24): PtySession {
  session = startPty(["bun", PROBE, "--no-mouse"], { cols, rows, cwd: ROOT });
  return session;
}

describe("PTY harness", () => {
  test("runs a full-screen program at 80x24 and reads its screen", async () => {
    const s = start();
    await s.waitFor((p) => p.screenText()[0]!.startsWith("SCREEN-PROBE ready 80x24"), 10000);
    expect(s.cols).toBe(80);
    expect(s.rows).toBe(24);
    expect(s.screenText()).toHaveLength(24);
    s.sendKeys("Ctrl+Q");
    expect(await s.wait()).toBe(0);
    expect(s.exitCode).toBe(0);
  }, 15000);

  test("resize reaches the child as SIGWINCH and resizes the emulator", async () => {
    const s = start();
    await s.waitFor("ready 80x24", 10000);
    s.resize(100, 30);
    await s.waitFor("ready 100x30");
    expect(s.screenText()).toHaveLength(30);
    s.resize(60, 20);
    await s.waitFor("ready 60x20");
    expect(s.screenText()).toHaveLength(20);
    s.sendKeys("Ctrl+Q");
    expect(await s.wait()).toBe(0);
  }, 15000);

  // Skipped on Windows: ConPTY answers or swallows the terminal queries (CSI 6n, DECRQM) itself, so the harness never sees them.
  test.skipIf(WINDOWS)("records raw output and answers terminal queries", async () => {
    const s = start();
    await s.waitFor("ready", 10000);
    // OpenTUI asks for the cursor position at start-up; the reply comes from xterm.
    expect(s.rawOutput()).toContain("\x1b[6n");
    // Synchronised output brackets every frame.
    expect(s.rawOutput()).toContain("\x1b[?2026h");
    s.sendKeys("Ctrl+Q");
    await s.wait();
  }, 15000);

  describe("OSC colour replies", () => {
    const ECHO = "packages/acp-tui/test/pty/osc-echo.ts";
    async function got(queries: string[], colours: OscColours | undefined): Promise<{ s: PtySession; reply: string }> {
      session = startPty(["bun", ECHO, ...queries], { cwd: ROOT, cols: 200, colours });
      const s = session;
      await s.waitFor("END", 10000);
      const line = s.screenText().find((l) => l.includes("GOT")) ?? "";
      return { s, reply: line.slice(line.indexOf("GOT") + 4, line.lastIndexOf("END")).trim() };
    }
    const FOOT: OscColours = {
      foreground: "#212121",
      background: "#fafafa",
      cursor: "#000000",
      palette: ["#000000", "#cc0000", "#00aa00"],
      terminator: "bel",
    };

    test.skipIf(WINDOWS)("answers OSC 10, 11 and 12 and records the queries", async () => {
      const { s, reply } = await got(["10", "11", "12"], FOOT);
      expect(reply).toBe("^[]10;rgb:2121/2121/2121^G^[]11;rgb:fafa/fafa/fafa^G^[]12;rgb:0000/0000/0000^G");
      expect(s.oscQueries).toEqual([10, 11, 12]);
    }, 15000);

    test.skipIf(WINDOWS)("answers OSC 4 for the palette indices given, in the foot form", async () => {
      const { s, reply } = await got(["4:0", "4:2", "4:9"], FOOT);
      expect(reply).toBe("^[]4;0;rgb:0000/0000/0000^G^[]4;2;rgb:0000/aaaa/0000^G");
      expect(s.oscQueries).toEqual([4, 4, 4]);
    }, 15000);

    test.skipIf(WINDOWS)("ends replies with ST by default", async () => {
      const { reply } = await got(["12", "4:1"], { cursor: "#112233", palette: ["#000000", "#ff0000"] });
      expect(reply).toBe("^[]12;rgb:1111/2222/3333^[\\^[]4;1;rgb:ffff/0000/0000^[\\");
    }, 15000);

    test.skipIf(WINDOWS)("swallows OSC 4 and 12 when no palette or cursor is set", async () => {
      const { s, reply } = await got(["4:0", "12", "10"], { foreground: "#101010" });
      expect(reply).toBe("^[]10;rgb:1010/1010/1010^[\\");
      expect(s.oscQueries).toEqual([4, 12, 10]);
    }, 15000);

    test.skipIf(WINDOWS)("cursorFollowsSet answers OSC 12 ? with the colour last set, until OSC 112", async () => {
      const { reply } = await got(["@100", "12", "set:#336699", "12", "reset", "12"], { cursor: "#000000", cursorFollowsSet: true, terminator: "bel" });
      expect(reply).toBe("^[]12;rgb:0000/0000/0000^G^[]12;rgb:3333/6666/9999^G^[]12;rgb:0000/0000/0000^G");
    }, 15000);

    test.skipIf(WINDOWS)("setColours changes the cursor and palette answered later", async () => {
      session = startPty(["bun", ECHO, "@1500", "12", "4:0"], { cwd: ROOT, cols: 200, colours: FOOT });
      const s = session;
      s.setColours({ cursor: "#c0caf5", palette: ["#1a1b26"] });
      await s.waitFor("END", 10000);
      const line = s.screenText().find((l) => l.includes("GOT")) ?? "";
      expect(line).toContain("^[]12;rgb:c0c0/caca/f5f5^[\\^[]4;0;rgb:1a1a/1b1b/2626^[\\");
    }, 15000);
  });
});
