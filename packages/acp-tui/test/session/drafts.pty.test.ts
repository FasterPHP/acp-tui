// Unsent drafts under a PTY (prompt-box-feedback groups 6 to 8; specs tui-sessions "Unsent drafts
// kept per session", "Draft files are private", "Draft limits and failures", "Drafts restored when
// a session is reopened", "Draft files are not trusted", "Restoring into a prompt box with text",
// "Drafts across a session switch"; tui-screen "Unsent draft in the exit text", "Draft printed as
// typed"). Every run has its own XDG_CONFIG_HOME and XDG_STATE_HOME (./list-world.ts).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { promptText, READY, RUNNING } from "../pty/regions.ts";
import { WINDOWS } from "../windows.ts";
import { chooseSession, draftWorld, exitLines, keep, promptIs, type DraftWorld } from "./drafts-helpers.ts";

const sessions: PtySession[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) s.kill("SIGTERM");
  await Promise.all(sessions.splice(0).map((s) => s.dispose()));
});

function open(d: DraftWorld, args: string[], size: { cols?: number; rows?: number } = {}): PtySession {
  const s = d.w.start(["-a", "fake", ...args], { cwd: d.repo, ...size });
  sessions.push(s);
  return s;
}

const RESUME = "resume: acp-tui --resume s-0";
const posix = test.skipIf(WINDOWS);

describe("keeping a draft when a session is left (tasks 7.1)", () => {
  posix("Kept on Ctrl+D: the text and cursor in a 0600 file in a 0700 directory, nothing in the index, and the exit text is the resume line alone", async () => {
    const d = draftWorld();
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "fix the" }, "Shift+Enter", { text: "tests" });
    await s.waitFor(promptIs(s, ["fix the", "tests"]), 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(d.text("s-0")).toBe("fix the\ntests");
    const body = JSON.parse(readFileSync(d.file("s-0"), "utf8"));
    expect(body).toMatchObject({ version: 1, harness: "fake", sessionId: "s-0", cursor: 13, mentions: [] });
    expect(statSync(d.file("s-0")).mode & 0o777).toBe(0o600);
    expect(statSync(d.dir).mode & 0o777).toBe(0o700);
    expect(d.indexText()).not.toContain("fix the");
    expect(exitLines(s)).toEqual([RESUME]);
    // Detach never cancels or closes, and the draft cost nothing on the wire.
    expect(d.w.received("fake").map((e) => e.method)).not.toContain("session/prompt");
  }, 40000);

  test("Kept on SIGHUP: closing the terminal window keeps the draft", async () => {
    const d = draftWorld();
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "half a thought" });
    await s.waitFor(promptIs(s, ["half a thought"]), 5000);
    s.kill("SIGHUP");
    await s.wait(10000);
    expect(d.text("s-0")).toBe("half a thought");
  }, 40000);

  test("a session whose prompt was answered keeps its draft (not only one opened from history)", async () => {
    const d = draftWorld();
    const s = open(d, []);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor("InvoiceTotal", 10000);
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "next thing" });
    await s.waitFor(promptIs(s, ["next thing"]), 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    const created = d.w.received("fake").find((e) => e.method === "session/new");
    expect(created).toBeDefined();
    const lines = exitLines(s);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith("resume: acp-tui --resume ");
  }, 40000);

  test("Not kept before the first answered prompt: no file, the draft below the command line, no resume line", async () => {
    const d = draftWorld();
    const s = open(d, []);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "explain the build" });
    await s.waitFor(promptIs(s, ["explain the build"]), 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(d.has("s-0")).toBe(false);
    expect(exitLines(s)).toEqual(["draft (not sent):", "explain the build"]);
  }, 40000);

  test("Session that cannot be reopened: the two lines below the command line, and nothing else", async () => {
    const d = draftWorld({ load: false });
    const s = open(d, []);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor("InvoiceTotal", 10000);
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "first line" }, "Shift+Enter", { text: "second line" });
    await s.waitFor(promptIs(s, ["first line", "second line"]), 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(exitLines(s)).toEqual(["draft (not sent):", "first line", "second line"]);
  }, 40000);

  test("Nothing under none: no draft, no resume line", async () => {
    const d = draftWorld({ load: false });
    const s = open(d, ["--exit-print", "none"]);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "unsent" });
    await s.waitFor(promptIs(s, ["unsent"]), 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(exitLines(s)).toEqual([]);
  }, 40000);

  test("Store turned off: nothing written, the resume line, a blank line, then the draft; a file from an earlier run is left alone and not restored", async () => {
    const d = draftWorld({ keep: false });
    keep(d, "s-0", "older");
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(READY, 15000);
    expect(promptText(s)).toEqual([""]);
    s.sendKeys({ text: "half a thought" });
    await s.waitFor(promptIs(s, ["half a thought"]), 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(exitLines(s)).toEqual([RESUME, "", "draft (not sent):", "half a thought"]);
    expect(d.text("s-0")).toBe("older");
  }, 40000);

  test("State directory not writable: acp-tui exits normally and prints the draft after the resume line", async () => {
    const d = draftWorld();
    mkdirSync(join(d.w.stateHome, "acp-tui"), { recursive: true });
    writeFileSync(d.dir, "a file where the directory should be");
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "half a thought" });
    await s.waitFor(promptIs(s, ["half a thought"]), 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(exitLines(s)).toEqual([RESUME, "", "draft (not sent):", "half a thought"]);
  }, 40000);

  test("Too large: a draft of 300 KiB is not stored and is printed in full", async () => {
    const d = draftWorld();
    const s = open(d, ["-r", "s-0"], { cols: 120, rows: 40 });
    await s.waitFor(READY, 15000);
    const line = "x".repeat(99);
    const lines = Array.from({ length: 3100 }, (_, i) => `${String(i).padStart(4, "0")} ${line}`);
    s.paste(lines.join("\n"));
    await s.waitFor((p) => p.screenText().some((r) => r.includes("3099") || r.includes("2999")), 20000);
    await s.flush();
    s.sendKeys("Ctrl+D");
    expect(await s.wait(20000)).toBe(0);
    expect(d.has("s-0")).toBe(false);
    const out = exitLines(s);
    expect(out.slice(0, 2)).toEqual([RESUME, ""]);
    expect(out[2]).toBe("draft (not sent):");
    expect(out.slice(3)).toEqual(lines);
  }, 90000);
});

describe("the draft in the exit text (tasks 7.2)", () => {
  test("Long draft in full: 400 lines, one of 300 characters, written as lines with none added", async () => {
    const d = draftWorld({ load: false });
    const s = open(d, [], { cols: 80, rows: 30 });
    await s.waitFor(READY, 15000);
    const lines = Array.from({ length: 400 }, (_, i) => (i === 7 ? "w".repeat(300) : `line ${i}`));
    s.paste(lines.join("\n"));
    await s.waitFor((p) => p.screenText().some((r) => r.includes("line 399") || r.includes("line 39")), 10000);
    await s.flush();
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(exitLines(s)).toEqual(["draft (not sent):", ...lines]);
  }, 40000);

  test("Tabs and pasted escapes: spaces to the next eight-column stop, no ESC byte and no tab", async () => {
    const d = draftWorld({ load: false });
    const s = open(d, []);
    await s.waitFor(READY, 15000);
    s.paste("a\tb\x1b]52;c;ZXZpbA==\x07");
    await s.waitFor((p) => p.screenText().some((r) => r.includes("a")), 5000);
    await s.flush();
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(exitLines(s)).toEqual(["draft (not sent):", "a       b"]);
    const raw = s.rawOutput();
    const tail = raw.slice(raw.lastIndexOf("draft (not sent):"));
    expect(tail).not.toContain("\x1b");
    expect(tail).not.toContain("\t");
    expect(tail).not.toContain("ZXZpbA");
  }, 40000);
});

describe("restoring a draft (tasks 8.1)", () => {
  test("Restored by --continue: two lines, the cursor after `fix`, nothing sent", async () => {
    const d = draftWorld();
    keep(d, "s-0", "fix the\ntests", 3);
    const s = open(d, ["-c"]);
    await s.waitFor(promptIs(s, ["fix the", "tests"]), 15000);
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "X" });
    await s.waitFor(promptIs(s, ["fixX the", "tests"]), 5000);
    expect(d.w.received("fake").map((e) => e.method)).not.toContain("session/prompt");
  }, 40000);

  test("Undo after a restore: Ctrl+Z leaves the restored draft in place", async () => {
    const d = draftWorld();
    keep(d, "s-0", "abc");
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(promptIs(s, ["abc"]), 15000);
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "\x1a" });
    await s.flush();
    await Bun.sleep(200);
    expect(promptText(s)).toEqual(["abc"]);
    // Typing after it is undone back to the restored text, not to nothing.
    s.sendKeys({ text: "d" });
    await s.waitFor(promptIs(s, ["abcd"]), 5000);
    s.sendKeys({ text: "\x1a" });
    await s.waitFor(promptIs(s, ["abc"]), 5000);
  }, 40000);

  test("Restored from the session list: the mention is drawn as written and sending it sends a resource_link", async () => {
    const d = draftWorld();
    keep(d, "s-1", "look at @src/app.ts", 19, [{ start: 8, end: 19, path: "src/app.ts", text: "@src/app.ts" }]);
    const s = open(d, []);
    await s.waitFor(READY, 15000);
    await chooseSession(s, "Two");
    await s.waitFor(promptIs(s, ["look at @src/app.ts"]), 10000);
    await s.waitFor(READY, 10000);
    s.sendKeys("Enter");
    await s.waitFor(() => d.w.received("fake").some((e) => e.method === "session/prompt"), 10000);
    const prompt = d.w.received("fake").find((e) => e.method === "session/prompt");
    expect(JSON.stringify(prompt)).toContain("promptBlockCount");
    expect((prompt?.params as { promptBlockCount: number }).promptBlockCount).toBe(2);
  }, 40000);

  test("Removed once sent: the restored draft is sent and its file goes", async () => {
    const d = draftWorld();
    keep(d, "s-0", "send me");
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(promptIs(s, ["send me"]), 15000);
    await s.waitFor(READY, 10000);
    expect(d.has("s-0")).toBe(true);
    s.sendKeys("Enter");
    await s.waitFor(() => d.w.received("fake").some((e) => e.method === "session/prompt"), 10000);
    await s.waitFor(() => !d.has("s-0"), 5000);
  }, 40000);

  test("Removed when emptied: the whole restored draft deleted and Ctrl+D", async () => {
    const d = draftWorld();
    keep(d, "s-0", "to be deleted");
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(promptIs(s, ["to be deleted"]), 15000);
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "\x01" }, "Backspace");
    await s.waitFor(promptIs(s, [""]), 5000);
    s.sendKeys("Ctrl+D");
    expect(await s.wait(10000)).toBe(0);
    expect(d.has("s-0")).toBe(false);
    expect(exitLines(s)).toEqual([RESUME]);
  }, 40000);

  test("Store turned off: the reopened session's prompt box is empty", async () => {
    const d = draftWorld({ keep: false });
    keep(d, "s-0", "older");
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(READY, 15000);
    await Bun.sleep(300);
    expect(promptText(s)).toEqual([""]);
  }, 40000);

  test("Hostile draft file: no escape sequence or bell reaches the prompt box or the terminal, the mention is plain text", async () => {
    const d = draftWorld();
    keep(d, "s-0", "x");
    // The store would sanitise on load; the file is written by hand, as an attacker would.
    const hostile = { version: 1, harness: "fake", sessionId: "s-0", text: "a\x1b]52;c;ZXZpbA==\x07b\x07c @x/y", cursor: 999, mentions: [{ start: 0, end: 3, path: "x/y", text: "@x/y" }], savedAt: Date.now() };
    writeFileSync(d.file("s-0"), JSON.stringify(hostile));
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(promptIs(s, ["abc @x/y"]), 15000);
    await s.waitFor(READY, 10000);
    expect(s.rawOutput()).not.toContain("ZXZpbA");
    expect(s.rawOutput()).not.toContain("\x1b]52");
    s.sendKeys({ text: "Z" });
    await s.waitFor(promptIs(s, ["abc @x/yZ"]), 5000);
  }, 40000);

  test("Text typed while the harness starts: the typed text first, a blank line, the restored draft, and a notice", async () => {
    const d = draftWorld({ args: ["--start-delay", "2500"] });
    keep(d, "s-0", "old");
    // `-r <id>` shows nothing until the session is found, so the text is typed on the splash of a
    // new session and the session is chosen from the list once the harness is up (the list cannot open before).
    const s = open(d, []);
    await s.waitFor(/starting/, 10000);
    s.sendKeys({ text: "new" });
    await s.waitFor(promptIs(s, ["new"]), 5000);
    await s.waitFor(READY, 20000);
    await chooseSession(s, "One");
    await s.waitFor(promptIs(s, ["new", "", "old"]), 20000);
    await s.waitFor((p) => p.screenText().some((r) => r.includes("draft restored after your text")), 5000);
  }, 60000);
});

describe("switching sessions (tasks 8.2)", () => {
  test("Switch keeps the draft of the session left: `for b` is restored, and opening `a` again restores `for a`", async () => {
    const d = draftWorld();
    keep(d, "s-1", "for b");
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "for a" });
    await s.waitFor(promptIs(s, ["for a"]), 5000);
    await chooseSession(s, "Two");
    await s.waitFor(promptIs(s, ["for b"]), 15000);
    expect(d.text("s-0")).toBe("for a");
    await s.waitFor(READY, 10000);
    await chooseSession(s, "One");
    await s.waitFor(promptIs(s, ["for a"]), 15000);
    expect(d.text("s-1")).toBe("for b");
  }, 90000);

  test("Switch from a session that cannot be reopened: the text stays in the prompt box", async () => {
    const d = draftWorld();
    const s = open(d, []);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "unsent" });
    await s.waitFor(promptIs(s, ["unsent"]), 5000);
    await chooseSession(s, "Two");
    await s.waitFor(() => d.w.received("fake").some((e) => e.method === "session/load"), 15000);
    await s.waitFor(READY, 10000);
    expect(promptText(s)).toEqual(["unsent"]);
    expect(d.has("s-1")).toBe(false);
  }, 60000);

  test("Switch from a session that cannot be reopened into one with a kept draft: the text first, a blank line, the draft", async () => {
    const d = draftWorld();
    keep(d, "s-1", "for b");
    const s = open(d, []);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "unsent" });
    await s.waitFor(promptIs(s, ["unsent"]), 5000);
    await chooseSession(s, "Two");
    await s.waitFor(promptIs(s, ["unsent", "", "for b"]), 15000);
  }, 60000);

  test("Refused switch: with a turn running and `next` in the box, choosing another session changes nothing", async () => {
    const d = draftWorld({ scenario: "basic", args: ["--delay-scale", "1000"] });
    const s = open(d, ["-r", "s-0"]);
    await s.waitFor(READY, 15000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor(RUNNING, 5000);
    s.sendKeys({ text: "next" });
    await s.waitFor(promptIs(s, ["next"]), 5000);
    await chooseSession(s, "Two", { closes: false });
    // The list stays open with the refusal; closing it shows the box as it was.
    await s.waitFor((p) => p.screenText().some((r) => r.includes("turn")), 5000);
    s.sendKeys("Esc");
    await s.waitFor(promptIs(s, ["next"]), 5000);
    expect(d.has("s-0")).toBe(false);
    expect(d.has("s-1")).toBe(false);
  }, 60000);

  test("Last writer wins: two processes on one session, `one` then `two` on leaving; reopening restores `two`", async () => {
    const d = draftWorld();
    const first = open(d, ["-r", "s-0"]);
    const second = open(d, ["-r", "s-0"]);
    await first.waitFor(READY, 15000);
    await second.waitFor(READY, 15000);
    first.sendKeys({ text: "one" });
    second.sendKeys({ text: "two" });
    await first.waitFor(promptIs(first, ["one"]), 5000);
    await second.waitFor(promptIs(second, ["two"]), 5000);
    first.sendKeys("Ctrl+D");
    expect(await first.wait(10000)).toBe(0);
    second.sendKeys("Ctrl+D");
    expect(await second.wait(10000)).toBe(0);
    const third = open(d, ["-r", "s-0"]);
    await third.waitFor(promptIs(third, ["two"]), 15000);
  }, 90000);
});
