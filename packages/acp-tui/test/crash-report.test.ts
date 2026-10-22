// Spec tui-screen "Crash report": the file's name and contents and its failure.
import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crashFileStamp, crashReportText, writeCrashReport } from "../src/crash-report.ts";
import { clearRecentEvents, createDebugLogger } from "../src/log.ts";
import pkg from "../package.json" with { type: "json" };

beforeEach(clearRecentEvents);
const tmp = (): string => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-crash-"));

describe("crash report", () => {
  test("stamp is UTC, compact", () => {
    expect(crashFileStamp(new Date("2026-10-21T09:30:15.123Z"))).toBe("20261021T093015Z");
  });

  test("text: version lines, error, stack, events as JSON lines", () => {
    const text = crashReportText(new Error("boom"), ["acp-tui 0.1.0"], [{ event: "launch" }]);
    expect(text.startsWith("acp-tui 0.1.0\n")).toBe(true);
    expect(text).toContain("error: boom");
    expect(text).toContain("Error: boom\n    at ");
    expect(text).toContain('{"event":"launch"}');
  });

  test("writes 0600 in a 0700 directory, never overwrites, and holds no conversation text", () => {
    const state = tmp();
    createDebugLogger(undefined).log({ event: "launch", agent: "auggie" });
    const env = { XDG_STATE_HOME: state, TERM_PROGRAM: "zed" };
    const now = new Date("2026-10-21T09:30:15Z");
    const path = writeCrashReport(new Error("boom"), { env, now });
    expect(path).toBe(join(state, "acp-tui", "crashes", "20261021T093015Z.txt"));
    const text = readFileSync(path!, "utf8");
    expect(text.startsWith(`acp-tui ${pkg.version}`)).toBe(true);
    expect(text).toContain("error: boom");
    expect(text).toContain('"event":"launch"');
    if (process.platform !== "win32") {
      expect(statSync(path!).mode & 0o777).toBe(0o600);
      expect(statSync(join(state, "acp-tui", "crashes")).mode & 0o777).toBe(0o700);
    }
    // Exclusive create: the same second fails rather than overwriting.
    expect(writeCrashReport(new Error("again"), { env, now })).toBeNull();
    expect(readFileSync(path!, "utf8")).toContain("error: boom");
  });

  test.skipIf(process.platform === "win32")("null when the state directory cannot be written", () => {
    const state = tmp();
    writeFileSync(join(state, "acp-tui"), "a file, not a directory");
    expect(writeCrashReport(new Error("boom"), { env: { XDG_STATE_HOME: state } })).toBeNull();
    chmodSync(state, 0o700);
  });
});
