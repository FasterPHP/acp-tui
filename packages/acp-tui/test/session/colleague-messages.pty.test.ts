// colleague-preview, under a PTY against fake-agent configured as `auggie`: the login message
// (spec tui-agent-session "Harness needs a login"), the notice for an unchecked Auggie ("Harness
// version not yet checked") and the debug log events. No test launches a real `auggie`: the
// built-in is reached only through a shell shim on a PATH of our own.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { FAKE_AGENT, listBody, listWorld, type ListWorld } from "./list-world.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

const AUGGIE_TEXT = "Authentication required: Auggie does not currently support authenticating over ACP. Please run `auggie login` from your terminal then try again.";
const NOTICE_1_2 = "auggie 1.2.0 has not been checked with acp-tui; testers use 0.36.0";

/** A PATH holding bun and an `auggie` shim that runs fake-agent with `args`: the built-in `auggie`, found. */
function shimAuggie(w: ListWorld, args: readonly string[]): void {
  const bin = join(w.base, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "bun"));
  const shim = join(bin, "auggie");
  writeFileSync(shim, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_AGENT}' --delay-scale 0 ${args.join(" ")}\n`);
  chmodSync(shim, 0o755);
  w.env["PATH"] = bin;
}

describe.skipIf(process.platform === "win32")("Harness needs a login", () => {
  test("Not logged in at start-up: harness auggie configured as fake-agent --auth-required: exit 1 and the line says to log in, with the harness's text", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "basic", "--auth-required"] });
    const s = (session = w.start(["auggie"], { cwd: repo, cols: 220, rows: 30 }));
    expect(await s.wait(20000)).toBe(1);
    const text = s.screenText().join(" ").replace(/\s+/g, " ");
    expect(text).toContain(`acp-tui: harness 'auggie' needs you to log in: ${AUGGIE_TEXT}`);
    expect(w.events("auth_required")).toMatchObject([{ phase: "new" }]);
  }, 40000);

  test("Login hint added: the built-in auggie answering a bare Authentication required gets the login step", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    shimAuggie(w, ["--scenario", "basic", "--auth-required=bare"]);
    const s = (session = w.start([], { cwd: repo, cols: 220, rows: 30 }));
    expect(await s.wait(20000)).toBe(1);
    const text = s.screenText().join(" ").replace(/\s+/g, " ");
    expect(text).toContain("harness 'auggie' needs you to log in: Authentication required; run auggie login in a terminal, then start acp-tui again");
  }, 40000);

  test("a configured harness gets the harness's text and no added step", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "basic", "--auth-required=bare"] });
    const s = (session = w.start(["auggie"], { cwd: repo, cols: 220, rows: 30 }));
    expect(await s.wait(20000)).toBe(1);
    const text = s.screenText().join(" ").replace(/\s+/g, " ");
    expect(text).toContain("harness 'auggie' needs you to log in: Authentication required");
    expect(text).not.toContain("start acp-tui again");
  }, 40000);

  test("Logged out during a session: a prompt answered with -32000 gives the conversation's error line and the session stays open", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "basic", "--auth-required=prompt"] });
    const s = (session = w.start(["auggie"], { cwd: repo, cols: 200, rows: 30 }));
    await s.waitFor(READY, 20000);
    s.sendKeys({ text: "hello" });
    s.sendKeys("Enter");
    await s.waitFor("needs you to log in", 10000);
    await s.waitFor(READY, 5000);
    expect(w.events("auth_required")).toMatchObject([{ phase: "prompt" }]);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 40000);

  test("a new session from the list: the footer says to log in and the session in use is kept", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ other: ["--scenario", "basic"], auggie: ["--scenario", "basic", "--auth-required"] });
    const s = (session = w.start(["other"], { cwd: repo, cols: 200, rows: 30 }));
    await s.waitFor(READY, 20000);
    s.sendKeys("Ctrl+P");
    await s.waitFor(/Commands \d+/, 3000);
    s.sendKeys({ text: "session list" });
    await s.waitFor(/Commands 1 /, 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => listBody(s).some((r) => r.startsWith("New session with auggie")), 5000);
    s.sendKeys({ text: "with auggie" });
    await s.waitFor(() => listBody(s)[1]?.startsWith("New session with auggie") ?? false, 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => listBody(s).join(" ").replace(/\s+/g, " ").includes("harness 'auggie' needs you to log in"), 10000);
    // The session in use is untouched: no session/new went to the other harness's process twice.
    expect(w.received("other").filter((e) => e.method === "session/new")).toHaveLength(1);
  }, 40000);
});

describe.skipIf(process.platform === "win32")("Harness version not yet checked", () => {
  test("Second-generation Auggie: --agent-info auggie@1.2.0 shows the notice and the session is usable", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "basic", "--agent-info", "auggie@1.2.0"] });
    const s = (session = w.start(["auggie"], { cwd: repo, cols: 200, rows: 30 }));
    await s.waitFor(READY, 20000);
    await s.waitFor(NOTICE_1_2, 5000);
    expect(w.received("auggie").map((e) => e.method)).toEqual(["initialize", "session/new"]);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 40000);

  test("Auggie 0.36: no such notice", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "basic", "--agent-info", "auggie@0.36.0"] });
    const s = (session = w.start(["auggie"], { cwd: repo, cols: 200, rows: 30 }));
    await s.waitFor(READY, 20000);
    await Bun.sleep(500);
    expect(s.screenText().join("\n")).not.toContain("has not been checked");
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
  }, 40000);
});
