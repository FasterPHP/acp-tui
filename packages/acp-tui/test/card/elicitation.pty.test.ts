// mvp-chrome-and-keys tasks 5.6 and 5.7: the elicitation card as product (no
// `--spike`), the real CLI against fake-agent's `elicitation` scenario at
// 63x21. Specs tui-layout "Elicitation card", tui-agent-session "Elicitation
// requests". The system opener is a stub script (`ACP_TUI_OPENER`) that records
// its argument vector; the clipboard is OSC 52 into the headless terminal
// (`localEnv`), so nothing reaches a browser or the user's clipboard.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, READY, REQUIRES_ACTION, statusRow, uncard } from "../pty/regions.ts";
import { boxRows, startChrome, type ChromeRun } from "../overlay/cli.ts";
import { localEnv, osc52Payloads } from "../selection/pty.ts";
import { configEnv } from "../pty/config-home.ts";
import { planUrlOpen } from "../../src/card/url.ts";
import { WINDOWS } from "../windows.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const URL = "https://example.invalid/fake-agent/authorise";

/** A stub opener: writes `$#` then each argument on its own line to `$OPENER_LOG`. */
function stubOpener(): { script: string; log: string } {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-opener-"));
  const script = join(dir, "opener.sh");
  const log = join(dir, "argv.txt");
  writeFileSync(script, '#!/bin/sh\n{ printf "%s\\n" "$#"; for a in "$@"; do printf "%s\\n" "$a"; done; } > "$OPENER_LOG"\n');
  chmodSync(script, 0o755);
  return { script, log };
}

function start(opts: { args?: string[]; env?: Record<string, string | undefined> } = {}): ChromeRun & { opener: string } {
  const opener = stubOpener();
  const run = startChrome({ scenario: "elicitation", args: opts.args ?? [], env: localEnv({ ACP_TUI_OPENER: opener.script, OPENER_LOG: opener.log, ...opts.env }) });
  session = run.s;
  return { ...run, opener: opener.log };
}

async function prompt(run: ChromeRun, text = "go"): Promise<void> {
  await run.s.waitFor(READY, 10000);
  run.s.sendKeys({ text }, "Enter");
}

// The card's rows without the frame and its padding columns (`uncard`); its padding rows read "".
const card = (s: PtySession) => boxRows(s, "◊ ").map((r) => uncard(r));
const responses = (run: ChromeRun) => run.agent().filter((e) => e.method === "elicitation/create/response").map((e) => e.params);
const afterGuard = () => Bun.sleep(400);
const notice = (s: PtySession) => promptBox(s)[0] ?? "";

/** Declines the form (Esc twice on its required first question), which brings the URL request. */
async function toUrl(run: ChromeRun): Promise<void> {
  await prompt(run);
  await run.s.waitFor("Question 1 of 3", 5000);
  await afterGuard();
  run.s.sendKeys("Esc");
  await run.s.waitFor("again declines", 3000);
  run.s.sendKeys("Esc");
  await run.s.waitFor("Open a link", 5000);
  await afterGuard();
}

describe("elicitation card (task 5.6)", () => {
  test("Told apart from a permission request: the header reads Question with the marker, never Permission", async () => {
    const run = start();
    await prompt(run);
    await run.s.waitFor("Question 1 of 3", 5000);
    const header = boxRows(run.s, "◊ ")[0] ?? "";
    expect(header).toStartWith("╭─ ◊ Question 1 of 3");
    expect(run.s.screenText().join("\n")).not.toContain("Permission");
    // The review and the URL request keep the word.
    await afterGuard();
    run.s.sendKeys("Esc");
    await run.s.waitFor("again declines", 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor("Open a link", 5000);
    expect(boxRows(run.s, "◊ ")[0]).toStartWith("╭─ ◊ Question  Open a link");
  }, 20000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts and test/card/url.test.ts).
  test.skipIf(WINDOWS)("Open the URL: the opener gets exactly the URL as its one argument, a notice names the host, the card waits for elicitation/complete", async () => {
    const run = start();
    await toUrl(run);
    expect(card(run.s)).toContain("1 open   2 copy   3 accept   4 decline");
    run.s.sendKeys("1", "Enter");
    await run.s.waitFor(() => existsSync(run.opener) && readFileSync(run.opener, "utf8").endsWith("\n"), 5000);
    expect(readFileSync(run.opener, "utf8").split("\n").slice(0, -1)).toEqual(["1", URL]);
    await run.s.waitFor((p) => notice(p).includes("opening example.invalid"), 3000);
    // Opening accepts; the agent then completes the request and the card leaves.
    await run.s.waitFor(() => responses(run).length === 2, 5000);
    expect(responses(run)[1]).toEqual({ action: "accept" });
    await run.s.waitFor("URL: accepted", 5000);
    await run.s.waitFor(READY, 5000);
    expect(boxRows(run.s, "◊ ")).toEqual([]);
  }, 20000);

  test("the opener's plan for the spec's URL: exactly https://example.com/auth?x=1 as one argument; over SSH a copy; never a non-web scheme", () => {
    expect(planUrlOpen("https://example.com/auth?x=1", { ACP_TUI_OPENER: "/stub" }, "linux")).toEqual({ action: "open", argv: ["/stub", "https://example.com/auth?x=1"], host: "example.com" });
    expect(planUrlOpen("https://example.com/auth?x=1", {}, "linux")).toMatchObject({ argv: ["xdg-open", "https://example.com/auth?x=1"] });
    expect(planUrlOpen("https://example.com/auth?x=1", { SSH_CONNECTION: "1 2 3 4" }, "linux")).toEqual({ action: "copy", host: "example.com" });
    expect(planUrlOpen("file:///etc/passwd", {}, "linux").action).toBe("refuse");
    expect(planUrlOpen("--help", {}, "linux").action).toBe("refuse");
    expect(planUrlOpen("https://example.com/a b", {}, "linux").action).toBe("refuse");
  });

  test("Copy the URL: copied under the clipboard rules (OSC 52 here), the toast names the path; nothing is answered", async () => {
    // The busy track at 25 per cent (the default before 15 October 2026), so the cut notice still
    // shows the path at 63 columns: this test is about the notice.
    const run = start({ env: configEnv({ density: "compact", busy: { track_percent: 25 } }) });
    await toUrl(run);
    run.s.sendKeys("2", "Enter");
    await run.s.waitFor((p) => notice(p).includes("OSC 52"), 5000);
    // The notice sits in the middle of the prompt box's top border, cut to fit (task 4.4).
    expect(notice(run.s)).toContain(`sent ${URL.length} chars to the terminal (OSC 52`);
    expect(osc52Payloads(run.s.rawOutput())).toContain(URL);
    expect(responses(run)).toHaveLength(1);
    expect(existsSync(run.opener)).toBe(false);
    // Then decline.
    run.s.sendKeys("4", "Enter");
    await run.s.waitFor(() => responses(run).length === 2, 5000);
    expect(responses(run)[1]).toEqual({ action: "decline" });
  }, 20000);

  test("Over SSH, open copies the URL instead and says so", async () => {
    const run = start({ env: { SSH_CONNECTION: "10.0.0.1 50000 10.0.0.2 22" } });
    await toUrl(run);
    run.s.sendKeys("1", "Enter");
    await run.s.waitFor((p) => notice(p).includes("SSH session: copied the link to example.invalid instead"), 5000);
    expect(existsSync(run.opener)).toBe(false);
  }, 20000);

  test("Capability advertised: initialize names elicitation with form and url, and still no fs or terminal", async () => {
    const run = start();
    await run.s.waitFor(READY, 10000);
    const init = run.agent().find((e) => e.method === "initialize")?.params as { clientCapabilities: Record<string, unknown> };
    expect(init.clientCapabilities).toMatchObject({ elicitation: { form: {}, url: {} }, fs: { readTextFile: false, writeTextFile: false }, terminal: false });
  }, 20000);

  test("Form answered: copy, tests and types ticked, the text question skipped: accept with strategy and checks", async () => {
    const run = start();
    await prompt(run);
    await run.s.waitFor("Question 1 of 3", 5000);
    await afterGuard();
    run.s.sendKeys("2", "Enter");
    await run.s.waitFor("Question 2 of 3", 3000);
    run.s.sendKeys("1", "2", "Enter");
    await run.s.waitFor("Question 3 of 3", 3000);
    run.s.sendKeys("Esc");
    await run.s.waitFor("Review your answers", 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)[0]).toEqual({ action: "accept", content: { strategy: "copy", checks: ["tests", "types"] } });
  }, 20000);

  test("Turn cancelled: interrupting the turn answers the open request cancel, sends session/cancel and removes the card", async () => {
    // The spec's route: the palette's `Interrupt the turn` (task 6.2), opened by Ctrl+P from the card.
    const run = start();
    await prompt(run);
    await run.s.waitFor("Question 1 of 3", 5000);
    run.s.sendKeys("Ctrl+P");
    await run.s.waitFor(/Commands \d+/, 3000);
    run.s.sendKeys({ text: "interrupt the" });
    await run.s.waitFor(/Commands 1 /, 3000);
    run.s.sendKeys("Enter");
    await run.s.waitFor(() => responses(run).length === 1, 5000);
    expect(responses(run)[0]).toEqual({ action: "cancel" });
    await run.s.waitFor(() => run.agent().some((e) => e.method === "session/cancel"), 5000);
    await run.s.waitFor(() => boxRows(run.s, "◊ ").length === 0, 5000);
  }, 20000);
});

describe("requires_action while an elicitation is open (task 5.7)", () => {
  test("the status row reads requires_action while the card is open, and not once it is answered", async () => {
    const run = start();
    await prompt(run);
    await run.s.waitFor("Question 1 of 3", 5000);
    await run.s.waitFor(REQUIRES_ACTION, 3000);
    await afterGuard();
    run.s.sendKeys("Esc");
    await run.s.waitFor("again declines", 3000);
    run.s.sendKeys("Esc");
    // The URL request opens next: requires_action again, until it is answered.
    await run.s.waitFor("Open a link", 5000);
    await run.s.waitFor(REQUIRES_ACTION, 3000);
    await afterGuard();
    run.s.sendKeys("3", "Enter");
    await run.s.waitFor(READY, 5000);
    expect(statusRow(run.s)).not.toContain("requires_action");
  }, 20000);
});
