// auggie-1x-support task 6.2 and 6.3 (spec tui-rendering "Tool titles from raw input", "Command
// results recognised"): fake-agent `auggie-1`'s `tools` turn through the real CLI under `verbose`:
// the bare titles `bash`, `read`, `edit` and `write` drawn as their command or path, and pi's
// failure drawn as `Output:` and `Return code: 1`, `exit 1` on the collapsed line.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPty, type PtySession } from "../pty/harness.ts";
import { CLI, FAKE_AGENT, PREFILL, sendPrompt, settle } from "./cli.ts";
import { withoutBar } from "../pty/regions.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function tempDir(label: string): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), `acp-tui-${label}-`)));
}

async function start(): Promise<PtySession> {
  const cwd = tempDir("tool-titles");
  const config = tempDir("tool-titles-config");
  mkdirSync(join(config, "acp-tui"));
  writeFileSync(join(config, "acp-tui", "config.jsonc"), `{ "density": "verbose" }`);
  session = startPty(["bun", CLI, "--", "--", "bun", FAKE_AGENT, "--scenario", "auggie-1", "--delay-scale", "0", "--allow-indexing"], {
    cols: 100,
    rows: 50,
    cwd,
    env: { XDG_CONFIG_HOME: config },
    prefill: PREFILL,
  });
  await sendPrompt(session, "tools");
  await session.waitFor(/expected cat failed/, 20000);
  await settle(session);
  return session;
}

function conversation(s: PtySession): string[] {
  const rows = withoutBar(s.screenText());
  const end = rows.findIndex((r) => r.startsWith("╭"));
  return rows.slice(0, end < 0 ? rows.length : end);
}

describe("auggie-1 tool calls (tasks 6.2 and 6.3)", () => {
  test("verbose: command and paths are the titles, and pi's failure is a command result", async () => {
    const s = await start();
    s.sendKeys("Home");
    await settle(s, 60);
    const rows = conversation(s);
    const text = rows.join("\n");
    expect(rows.find((r) => /execute\s+seq 1 3/.test(r))).toBeDefined();
    expect(rows.find((r) => /read\s+README\.md/.test(r))).toBeDefined();
    expect(rows.find((r) => /edit\s+notes\.txt/.test(r))).toBeDefined();
    expect(rows.find((r) => /edit\s+hello\.txt/.test(r))).toBeDefined();
    const failed = rows.find((r) => /execute\s+cat does-not-exist\.txt/.test(r));
    expect(failed).toBeDefined();
    expect(failed).toMatch(/exit 1/);
    expect(text).not.toMatch(/execute\s+bash/);
    expect(text).not.toMatch(/read\s+read\b/);
    expect(text).toContain("Return code: 1");
    expect(text).toContain("Output: cat: does-not-exist.txt: No such file or directory");
    expect(text).not.toContain("Command exited with code");
  }, 40000);
});
