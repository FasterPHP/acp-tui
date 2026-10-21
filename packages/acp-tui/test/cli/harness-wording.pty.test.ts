// day-two-feedback task 4.5, the scenarios that need a real terminal (spec tui-agent-session "Harness
// as the user-facing term"): "Still starting" (a draft sent while the harness has not answered
// `initialize`) and "Harness fails to start", both through the harness named by position
// (`acp-tui fake`), against fake-agent only with a temporary XDG_CONFIG_HOME and XDG_STATE_HOME.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { promptText, READY } from "../pty/regions.ts";
import { listWorld } from "../session/list-world.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

describe("Still starting", () => {
  test("the harness auggie-like `fake` has not answered initialize and the user presses Enter on a draft: the notice reads `fake is still starting`, and the draft is kept", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ fake: ["--scenario", "basic", "--start-delay", "3000"] });
    const s = (session = w.start(["fake"], { cwd: repo, cols: 100, rows: 30 }));
    await s.waitFor((p) => p.screenText().join("\n").includes("starting…"), 15000);
    s.sendKeys({ text: "hello there" });
    await s.waitFor((p) => promptText(p)[0] === "hello there", 5000);
    s.sendKeys("Enter");
    await s.waitFor((p) => p.screenText().join("\n").includes("fake is still starting"), 5000);
    expect(s.screenText().join("\n")).not.toContain("the agent is still starting");
    expect(promptText(s)[0]).toBe("hello there");
    await s.waitFor(READY, 15000);
  }, 40000);
});

describe("Harness fails to start", () => {
  test("`acp-tui fake` where fake names a command that does not exist: the error below the command line names the harness fake and its command, and has no `agent command`", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    mkdirSync(join(w.base, "config", "acp-tui"), { recursive: true });
    writeFileSync(join(w.base, "config", "acp-tui", "config.jsonc"), JSON.stringify({ agent_servers: { fake: { command: "/no/such/harness-binary", args: ["--acp"] } } }));
    const s = (session = w.start(["fake"], { cwd: repo, cols: 100, rows: 30 }));
    expect(await s.wait(20000)).toBe(1);
    const text = s.screenText().join("");
    expect(text).toContain("acp-tui: could not start harness 'fake' (command '/no/such/harness-binary --acp')");
    expect(text).not.toContain("agent command");
  }, 40000);
});
