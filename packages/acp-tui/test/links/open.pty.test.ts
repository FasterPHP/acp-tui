// Opening links in the real CLI (mvp-rendering task 6.3; spec tui-rendering "Opening links"):
// acp-tui under a PTY against fake-agent's `links` scenario, with the system opener replaced by a
// stub script (`ACP_TUI_OPENER`) that records its argument vector, one argument per line after
// the count. Nothing reaches a browser or the user's clipboard (see ../selection/pty.ts).
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, READY } from "../pty/regions.ts";
import { sendPrompt, startCli, type CliRun } from "../conversation/cli.ts";
import { localEnv, osc52Payloads } from "../selection/pty.ts";
import { fakeCompositor } from "./fake-compositor.ts";
import { WINDOWS } from "../windows.ts";

let run: CliRun | undefined;
afterEach(async () => {
  await run?.session.dispose();
  run = undefined;
});

/** A stub opener: writes `$#` then each argument on its own line to `$OPENER_LOG`. */
function stubOpener(): { script: string; log: string } {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-opener-"));
  const script = join(dir, "opener.sh");
  const log = join(dir, "argv.txt");
  writeFileSync(script, '#!/bin/sh\n{ printf "%s\\n" "$#"; for a in "$@"; do printf "%s\\n" "$a"; done; } > "$OPENER_LOG"\n');
  chmodSync(script, 0o755);
  return { script, log };
}

async function start(env: Record<string, string | undefined> = {}): Promise<{ s: PtySession; log: string; dir: string; events: CliRun["events"] }> {
  const opener = stubOpener();
  run = startCli({ scenario: "links", cols: 100, rows: 30, env: localEnv({ ACP_TUI_OPENER: opener.script, OPENER_LOG: opener.log, ...env }) });
  const s = run.session;
  await sendPrompt(s, "show me links");
  await s.waitFor((p) => p.screenText().some((l) => l.includes("A long one:")) && READY.test(p.screenText().join("\n")), 15000);
  return { s, log: opener.log, dir: dirname(run.logPath), events: run.events };
}

/** The cell (column, row) where `text` is first drawn. */
function cellOf(s: PtySession, text: string): [number, number] {
  const rows = s.screenText();
  const y = rows.findIndex((l) => l.includes(text));
  if (y < 0) throw new Error(`no ${JSON.stringify(text)} on screen\n${rows.join("\n")}`);
  return [rows[y]!.indexOf(text), y];
}

const toast = (s: PtySession) => promptBox(s)[0] ?? "";
const argv = (log: string) => readFileSync(log, "utf8").split("\n").slice(0, -1);

describe("opening links (task 6.3)", () => {
  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("Click opens: a click on a link starts the opener with the URL as its only argument, and the toast names the host", async () => {
    const { s, log, events } = await start();
    expect(s.screenText().some((l) => l.includes("One link: the docs (example.com)."))).toBe(true);
    const [x, y] = cellOf(s, "the docs");
    s.mouseClick(x + 2, y);
    await s.waitFor(() => existsSync(log) && readFileSync(log, "utf8").endsWith("\n"), 5000);
    expect(argv(log)).toEqual(["1", "https://example.com/docs"]);
    await s.waitFor((p) => toast(p).includes("opening example.com"), 5000);
    expect(events("link_open")).toEqual([expect.objectContaining({ action: "open", kind: "web", trigger: "click" })]);
  }, 30000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("the host after the label opens the same link; a bare URL and a mail link open as written", async () => {
    const { s, log } = await start();
    const [hx, hy] = cellOf(s, "(example.com).");
    s.mouseClick(hx + 3, hy);
    await s.waitFor(() => existsSync(log), 5000);
    await Bun.sleep(100);
    expect(argv(log)).toEqual(["1", "https://example.com/docs"]);
    await Bun.sleep(500);
    const [mx, my] = cellOf(s, "mail us");
    s.mouseClick(mx, my);
    await s.waitFor(() => readFileSync(log, "utf8").includes("mailto:"), 5000);
    expect(argv(log)).toEqual(["1", "mailto:team@example.com"]);
    await s.waitFor((p) => toast(p).includes("opening mail to team@example.com"), 5000);
  }, 30000);

  test("Drag over a link: the text is selected and copied, and nothing is opened", async () => {
    const { s, log, events } = await start();
    const [x, y] = cellOf(s, "inline link");
    s.mousePress(x, y);
    s.mouseMove(x + 3, y, "left");
    await Bun.sleep(15);
    s.mouseMove(x + 8, y, "left");
    await Bun.sleep(15);
    s.mouseRelease(x + 8, y);
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > 0, 5000);
    expect(osc52Payloads(s.rawOutput())[0]).toBe("inline li");
    await Bun.sleep(500);
    expect(existsSync(log)).toBe(false);
    expect(events("link_open")).toEqual([]);
  }, 30000);

  test("a refused link (javascript:) opens nothing when clicked", async () => {
    const { s, log, events } = await start();
    expect(s.screenText().some((l) => l.includes("script link (javascript:alert(1))"))).toBe(true);
    const [x, y] = cellOf(s, "script link");
    s.mouseClick(x + 1, y);
    await Bun.sleep(800);
    expect(existsSync(log)).toBe(false);
    expect(events("link_open")).toEqual([]);
  }, 30000);

  test("Over SSH: nothing is opened, the URL is copied, and the toast says it was copied instead", async () => {
    const { s, log, events } = await start({ SSH_CONNECTION: "10.0.0.1 50000 10.0.0.2 22" });
    const [x, y] = cellOf(s, "the docs");
    s.mouseClick(x, y);
    await s.waitFor((p) => osc52Payloads(p.rawOutput()).length > 0, 5000);
    expect(osc52Payloads(s.rawOutput())).toEqual(["https://example.com/docs"]);
    await s.waitFor((p) => toast(p).includes("SSH session: copied the link to example.com instead"), 5000);
    await Bun.sleep(300);
    expect(existsSync(log)).toBe(false);
    expect(events("link_open")).toEqual([expect.objectContaining({ action: "copy", kind: "web" })]);
  }, 30000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("a relative link opens the file's real path inside the working directory; one whose symlink leads outside is refused", async () => {
    const { s, log, dir } = await start();
    writeFileSync(join(dir, "README.md"), "# readme\n");
    const [x, y] = cellOf(s, "readme");
    s.mouseClick(x, y);
    await s.waitFor(() => existsSync(log), 5000);
    await Bun.sleep(100);
    expect(argv(log)).toEqual(["1", realpathSync(join(dir, "README.md"))]);
    // Now the same name as a symlink to a file outside the working directory.
    const outside = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret\n");
    writeFileSync(log, "");
    const { rmSync } = await import("node:fs");
    rmSync(join(dir, "README.md"));
    symlinkSync(join(outside, "secret.txt"), join(dir, "README.md"));
    await Bun.sleep(500);
    s.mouseClick(x, y);
    await s.waitFor((p) => toast(p).includes("not opened: README.md leads outside the working directory"), 5000);
    expect(readFileSync(log, "utf8")).toBe("");
  }, 30000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("openLink (`o`): the cursor's item with one link opens it; with several a chooser lists them and Enter opens the chosen one", async () => {
    const { s, log, events } = await start();
    // Tab focuses the conversation; the cursor starts on the last item, the turn's end, which has
    // no link.
    s.sendKeys("Tab");
    await Bun.sleep(300);
    s.sendKeys({ text: "o" });
    await s.waitFor((p) => toast(p).includes("no link in the item under the cursor"), 5000);
    // Up to the message with several links.
    s.sendKeys({ text: "k" });
    await Bun.sleep(200);
    s.sendKeys({ text: "o" });
    await s.waitFor((p) => p.screenText().some((l) => l.includes("Links")), 5000);
    const chooser = s.screenText().join("\n");
    for (const label of ["inline link", "https://example.com/bare/url", "mail us", "readme", "example.com/a/very/long"]) expect(chooser).toContain(label);
    expect(chooser).not.toContain("javascript:alert(1)  ");
    s.sendKeys("Down");
    await Bun.sleep(100);
    s.sendKeys("Enter");
    await s.waitFor(() => existsSync(log), 5000);
    await Bun.sleep(100);
    expect(argv(log)).toEqual(["1", "https://example.com/bare/url"]);
    await s.waitFor((p) => !p.screenText().some((l) => l.includes("╭─ Links")), 5000);
    // Up to the first message, whose one link opens at once.
    writeFileSync(log, "");
    s.sendKeys({ text: "k" });
    await Bun.sleep(200);
    s.sendKeys({ text: "o" });
    await s.waitFor(() => readFileSync(log, "utf8") !== "", 5000);
    await Bun.sleep(100);
    expect(argv(log)).toEqual(["1", "https://example.com/docs"]);
    expect(events("link_open").map((e) => e["trigger"])).toEqual(["key", "key"]);
  }, 30000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("the chooser takes a click as Enter (day-two-feedback task 13.6): a click on a link's row opens that link and closes the chooser", async () => {
    const { s, log } = await start();
    s.sendKeys("Tab");
    await Bun.sleep(300);
    s.sendKeys({ text: "k" });
    await Bun.sleep(200);
    s.sendKeys({ text: "o" });
    await s.waitFor((p) => p.screenText().some((l) => l.includes("╭─ Links")), 5000);
    const row = s.screenText().findIndex((l) => l.startsWith("│") && l.includes("https://example.com/bare/url"));
    expect(row).toBeGreaterThan(0);
    s.mouseClick(6, row);
    await s.waitFor(() => existsSync(log), 5000);
    await Bun.sleep(100);
    expect(argv(log)).toEqual(["1", "https://example.com/bare/url"]);
    await s.waitFor((p) => !p.screenText().some((l) => l.includes("╭─ Links")), 5000);
  }, 30000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (the Windows opener is rundll32, covered by the argv tests in test/links/open.test.ts).
  test.skipIf(WINDOWS)("C7: the opener gets an activation token from the compositor in XDG_ACTIVATION_TOKEN; the log says so, never the token", async () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-wayland-"));
    const socket = join(dir, "wayland-fake");
    const { server, seen } = fakeCompositor(socket);
    try {
      const script = join(dir, "opener.sh");
      const log = join(dir, "env.txt");
      writeFileSync(script, '#!/bin/sh\n{ printf "%s\\n" "$#" "$1" "token=$XDG_ACTIVATION_TOKEN"; } > "$OPENER_LOG"\n');
      chmodSync(script, 0o755);
      // Nothing is copied here, so the host clipboard never talks to the fake compositor.
      run = startCli({ scenario: "links", cols: 100, rows: 30, env: localEnv({ ACP_TUI_OPENER: script, OPENER_LOG: log, WAYLAND_DISPLAY: socket, XDG_ACTIVATION_TOKEN: "stale" }) });
      const s = run.session;
      await sendPrompt(s, "show me links");
      await s.waitFor((p) => p.screenText().some((l) => l.includes("A long one:")) && READY.test(p.screenText().join("\n")), 15000);
      const [x, y] = cellOf(s, "the docs");
      s.mouseClick(x + 1, y);
      await s.waitFor(() => existsSync(log) && readFileSync(log, "utf8").split("\n").length >= 4, 5000);
      expect(argv(log)).toEqual(["1", "https://example.com/docs", "token=tok-123"]);
      expect(seen.some((m) => m.object === 5 && m.opcode === 3)).toBe(true);
      await s.waitFor((p) => toast(p).includes("opening example.com"), 5000);
      const events = run.events("link_open");
      expect(events).toEqual([expect.objectContaining({ action: "open", kind: "web", trigger: "click", activation: "token" })]);
      expect(JSON.stringify(events)).not.toContain("tok-123");
      expect(JSON.stringify(events)).not.toContain("example.com");
    } finally {
      server.stop(true);
    }
  }, 30000);

  // Skipped on Windows: the opener is a #!/bin/sh stub that records its arguments (and Wayland activation tokens are Linux's).
  test.skipIf(WINDOWS)("C7: without a compositor the link opens all the same, with no token (an inherited one is not passed on)", async () => {
    const opener = stubOpener();
    writeFileSync(opener.script, '#!/bin/sh\n{ printf "%s\\n" "$#" "$1" "token=${XDG_ACTIVATION_TOKEN-unset}"; } > "$OPENER_LOG"\n');
    run = startCli({ scenario: "links", cols: 100, rows: 30, env: localEnv({ ACP_TUI_OPENER: opener.script, OPENER_LOG: opener.log, XDG_ACTIVATION_TOKEN: "stale" }) });
    const s = run.session;
    await sendPrompt(s, "show me links");
    await s.waitFor((p) => p.screenText().some((l) => l.includes("A long one:")) && READY.test(p.screenText().join("\n")), 15000);
    const [x, y] = cellOf(s, "the docs");
    s.mouseClick(x + 1, y);
    await s.waitFor(() => existsSync(opener.log) && readFileSync(opener.log, "utf8").split("\n").length >= 4, 5000);
    expect(argv(opener.log)).toEqual(["1", "https://example.com/docs", "token=unset"]);
    expect(run.events("link_open")).toEqual([expect.objectContaining({ action: "open", activation: "no-wayland" })]);
  }, 30000);
});
