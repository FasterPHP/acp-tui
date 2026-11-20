// auggie-1x-support, spec tui-agent-session "Reasons in agent errors", under a PTY against
// fake-agent `auggie-1`: a refused reopen below the command line, and a refused prompt in the
// conversation.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openSessionIndex } from "../../src/session/session-index.ts";
import { startPty, type PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");

let session: PtySession | null = null;
afterEach(async () => {
  await session?.dispose();
  session = null;
});

function world(scenarioArgs: readonly string[]) {
  const base = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-error-reasons-")));
  const configHome = join(base, "config");
  const stateHome = join(base, "state");
  mkdirSync(join(configHome, "acp-tui"), { recursive: true });
  const args = ["--delay-scale", "0", ...scenarioArgs];
  writeFileSync(
    join(configHome, "acp-tui", "config.jsonc"),
    JSON.stringify({ density: "compact", agent_servers: { auggie: { command: "bun", args: [FAKE_AGENT, ...args] } }, default_agent_server: "auggie" }),
  );
  return { base, stateHome, env: { XDG_CONFIG_HOME: configHome, XDG_STATE_HOME: stateHome } };
}

function start(w: ReturnType<typeof world>, args: readonly string[], size = { cols: 400, rows: 30 }): PtySession {
  session = startPty(["bun", CLI, ...args], { ...size, cwd: w.base, env: w.env, prefill: "$ acp-tui\r\n" });
  return session;
}

describe("Reasons in agent errors (PTY)", () => {
  test("Reopen failure with details: the line below the command line names the session and reads the reason and code", async () => {
    const w = world(["--scenario", "auggie-1"]);
    openSessionIndex({ stateHome: w.stateHome }).record({ agent: "auggie", sessionId: "s-9", directory: w.base, title: "Gone" });
    const s = start(w, ["--resume", "s-9"]);
    expect(await s.wait(20000)).toBe(1);
    await s.flush();
    expect(s.screenText().join("")).toContain("cannot open session s-9 with harness 'auggie': the harness answered Internal error: Session s-9 not found (-32603)");
  }, 40000);

  test("Internal error with details: the conversation's error line reads the reason, not the advice", async () => {
    const w = world(["--scenario", "auggie-1-noauth", "--offer-models"]);
    const s = start(w, []);
    await s.waitFor(READY, 20000);
    s.sendKeys({ text: "hello" }, "Enter");
    await s.waitFor("Internal error: No API key found for unknown.", 10000);
    expect(s.screenText().join("\n")).not.toContain("Use /login");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 40000);
});
