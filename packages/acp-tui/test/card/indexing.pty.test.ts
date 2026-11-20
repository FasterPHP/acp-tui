// The indexing question (auggie-1x-support design D16): the real CLI against fake-agent's `auggie-1`
// scenario under a PTY, each run with its own configuration and session index (list-world.ts).
// Specs tui-agent-session "Auggie's indexing line becomes a question", "Allowing Auggie to index",
// "Declining Auggie's indexing" and "Other indexing lines from Auggie"; tui-layout "Indexing
// question card".
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { READY, RUNNING, REQUIRES_ACTION, promptBox } from "../pty/regions.ts";
import { boxRows } from "../overlay/cli.ts";
import { listBody, listRows, listWorld, type ListWorld } from "../session/list-world.ts";
import { WINDOWS } from "../windows.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

const SIZE = { cols: 63, rows: 21 };
const DISABLED = (dir: string) => `Indexing disabled for current workspace "${dir}".`;
/** The card's rows, frame included, or none. */
const card = (s: PtySession) => boxRows(s, "◊ Question");
const cardText = (s: PtySession) => card(s).join("\n");
/** The card's body joined into one line, the frame and the wrapping taken out. */
const cardBody = (s: PtySession) =>
  card(s)
    .slice(1, -1)
    .map((r) => r.replace(/^│\s?/, "").replace(/\s*│$/, "").trim())
    .join(" ")
    .replace(/\s+/g, " ");
const methods = (w: ListWorld) => w.received("auggie").map((e) => e.method);
const afterGuard = () => Bun.sleep(400);

function start(w: ListWorld, cwd: string, args: readonly string[] = ["auggie"], size: { cols: number; rows: number } = SIZE): PtySession {
  session = w.start(args, { cwd, ...size });
  return session;
}

/** Sends a prompt from the card: Tab to the prompt box first. */
async function promptPast(s: PtySession, text: string): Promise<void> {
  s.sendKeys("Tab");
  await Bun.sleep(100);
  s.sendKeys({ text }, "Enter");
}

describe.skipIf(WINDOWS)("Auggie's indexing line becomes a question", () => {
  test("Asked after a new session: no agent message, the splash stays, and the card names the directory", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo, ["auggie"], { cols: 100, rows: 40 });
    await s.waitFor(READY, 20000);
    await s.waitFor(() => cardText(s).includes("from acp-tui"), 5000);
    // The splash: its identity row and hints, so the conversation has no item.
    await s.waitFor("Harness: Auggie 1.2.2", 5000);
    const screen = s.screenText().join("\n");
    expect(cardBody(s)).toContain(repo);
    expect(screen).toContain("ctrl+d detach");
    expect(screen).not.toContain(DISABLED(repo));
    expect(w.events("indexing_line")).toMatchObject([{ kind: "disabled" }]);
  }, 40000);

  test("Another harness: the same text from a harness with no profile is agent text and no card opens", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1", "--agent-info", "other@1.2.2"] });
    const s = start(w, repo, ["auggie"], { cols: 120, rows: 30 });
    await s.waitFor(READY, 20000);
    await s.waitFor(DISABLED(repo), 5000);
    expect(card(s)).toEqual([]);
    expect(w.events("indexing_line")).toEqual([]);
  }, 40000);
});

describe.skipIf(WINDOWS)("Indexing question card", () => {
  test("One directory, before the first prompt, at 63x21: Question from acp-tui, the directory, what allowing does, the lasting rule, how to refuse for good, 1 allow indexing and 2 not now", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo);
    await s.waitFor(READY, 20000);
    await s.waitFor(() => cardText(s).includes("2 not now"), 5000);
    const rows = card(s);
    expect(rows[0]).toStartWith("╭─ ◊ Question  from acp-tui ─");
    expect(s.screenText().join("\n")).not.toContain("Permission");
    const body = cardBody(s);
    for (const part of [
      repo,
      "--allow-indexing",
      "starts a new session",
      "indexingAllowDirs in ~/.augment/settings.json",
      "To never index a directory, answer Auggie's own question in auggie, started in that directory.",
      "1 allow indexing 2 not now",
    ]) {
      expect(body).toContain(part);
    }
    expect(body).not.toContain("reopens this session");
    expect(rows.at(-1)).toContain("esc not now");
    // Never cut: every row of the body is inside the frame.
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(63);
  }, 40000);

  test("After an answered prompt the card says allowing reopens this session", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo);
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await promptPast(s, "hello");
    await s.waitFor(() => cardBody(s).includes("reopens this session"), 10000);
    expect(cardBody(s)).not.toContain("starts a new session");
  }, 40000);

  test("A directory joins the open card: the session directory and an added workspace, both named, the same two options", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    const lib = w.dir("lib");
    w.configure({ auggie: ["--scenario", "auggie-1", "--add-workspace", lib] });
    const s = start(w, repo, ["auggie"], { cols: 100, rows: 40 });
    await s.waitFor(() => cardBody(s).includes(lib), 20000);
    const body = cardBody(s);
    expect(body).toContain(repo);
    expect(body).toContain("these directories");
    expect(body).toContain("1 allow indexing 2 not now");
  }, 40000);

  test("Never during a turn: the card leaves while a turn runs and while its permission card is open, and comes back once the turn has ended", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo);
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await promptPast(s, "permission");
    await s.waitFor(REQUIRES_ACTION, 10000);
    await s.waitFor("◊ Permission", 5000);
    expect(card(s)).toEqual([]);
    await afterGuard();
    s.sendKeys("1", "Enter");
    await s.waitFor(READY, 10000);
    await s.waitFor(() => cardText(s).includes("2 not now"), 5000);
    expect(cardBody(s)).toContain(repo);
    // A running turn: the card leaves, and returns after the interrupt.
    await promptPast(s, "slow");
    await s.waitFor(RUNNING, 10000);
    expect(card(s)).toEqual([]);
    s.sendKeys("Esc", "Esc");
    await s.waitFor(READY, 10000);
    await s.waitFor(() => cardText(s).includes("2 not now"), 5000);
  }, 60000);
});

describe.skipIf(WINDOWS)("Allowing Auggie to index", () => {
  test("Allowed: after an answered prompt, 1 detaches the harness, starts it again with --allow-indexing, loads the session with its history, and no card or indexing message follows", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    // The sessions in a file, so the new process can load the one the first wrote.
    w.configure({ auggie: ["--scenario", "auggie-1", "--sessions", join(w.base, "sessions.json"), "--persist"] });
    const s = start(w, repo, ["auggie"], { cols: 100, rows: 40 });
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await promptPast(s, "hello");
    await s.waitFor(() => cardBody(s).includes("reopens this session"), 10000);
    // The card is back after the turn and, with the prompt box empty, has focus again.
    await afterGuard();
    s.sendKeys({ text: "1" });
    await s.waitFor(() => methods(w).includes("session/load"), 10000);
    await s.waitFor(READY, 10000);
    expect(methods(w).filter((m) => !m.endsWith("/response"))).toEqual(["initialize", "session/new", "session/prompt", "argv/allow-indexing", "initialize", "session/load"]);
    // The old process was detached (its stdin ended) and has exited.
    await s.waitFor(() => w.events("agent_exited_after_detach").length === 1, 5000);
    await Bun.sleep(500);
    expect(card(s)).toEqual([]);
    const screen = s.screenText().join("\n");
    expect(screen).toContain("hello");
    expect(screen).not.toContain("Indexing disabled");
  }, 40000);

  test("Allowed before the first prompt: the new process receives session/new in the same directory and no session/load", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo);
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await afterGuard();
    s.sendKeys({ text: "1" });
    await s.waitFor(() => methods(w).filter((m) => m === "session/new").length === 2, 10000);
    await s.waitFor(READY, 10000);
    expect(methods(w)).toEqual(["initialize", "session/new", "argv/allow-indexing", "initialize", "session/new"]);
    const news = w.received("auggie").filter((e) => e.method === "session/new");
    expect(news.map((e) => e.params?.["cwd"])).toEqual([repo, repo]);
    await Bun.sleep(500);
    expect(card(s)).toEqual([]);
  }, 40000);

  test("Rule kept by the harness: allowed once with --indexing-store, a later start runs without --allow-indexing and shows no card", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    const store = join(w.base, "indexing.json");
    w.configure({ auggie: ["--scenario", "auggie-1", "--indexing-store", store] });
    const first = start(w, repo);
    await first.waitFor(() => cardText(first).includes("2 not now"), 20000);
    await afterGuard();
    first.sendKeys({ text: "1" });
    await first.waitFor(() => methods(w).filter((m) => m === "session/new").length === 2, 10000);
    await first.waitFor(READY, 10000);
    expect(existsSync(store) && JSON.parse(readFileSync(store, "utf8")).indexingAllowDirs).toEqual([repo]);
    first.sendKeys("Ctrl+D");
    expect(await first.wait(10000)).toBe(0);
    await first.dispose();
    const before = methods(w).length;
    const second = start(w, repo);
    await second.waitFor(READY, 20000);
    await Bun.sleep(800);
    expect(methods(w).slice(before)).toEqual(["initialize", "session/new"]);
    expect(card(second)).toEqual([]);
    expect(second.screenText().join("\n")).not.toContain("Indexing disabled");
  }, 60000);
});

describe.skipIf(WINDOWS)("Declining Auggie's indexing", () => {
  test("Declined: 2 closes the card, and a new session in the same directory from the session list neither asks again nor draws the line", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo, ["auggie"], { cols: 100, rows: 30 });
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await afterGuard();
    s.sendKeys({ text: "2" });
    await s.waitFor(() => card(s).length === 0, 5000);
    // Another session in the directory, on the same harness process.
    s.sendKeys("Ctrl+P");
    await s.waitFor(/Commands \d+/, 3000);
    s.sendKeys({ text: "session list" });
    await s.waitFor(/Commands 1 /, 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => listRows(s).length > 0 && listBody(s).some((r) => r.startsWith("New session with auggie")), 5000);
    s.sendKeys({ text: "with auggie" });
    await s.waitFor(() => listBody(s)[1]?.startsWith("New session with auggie") ?? false, 3000);
    s.sendKeys("Enter");
    await s.waitFor(() => methods(w).filter((m) => m === "session/new").length === 2, 10000);
    await s.waitFor(() => w.events("indexing_line").length === 2, 5000);
    await Bun.sleep(500);
    expect(card(s)).toEqual([]);
    expect(s.screenText().join("\n")).not.toContain("Indexing disabled");
  }, 40000);

  test("Refused by a stored rule: allowed, the line comes again after the restart, a warning notice names the directory and indexingDenyDirs, and no card opens again", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1", "--indexing-deny", repo] });
    const s = start(w, repo, ["auggie"], { cols: 200, rows: 30 });
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await afterGuard();
    s.sendKeys({ text: "1" });
    await s.waitFor(() => (promptBox(s)[0] ?? "").includes("indexingDenyDirs"), 10000);
    expect(promptBox(s)[0]).toContain(`Auggie has a rule never to index ${repo}; remove it in auggie or from indexingDenyDirs`);
    await Bun.sleep(500);
    expect(card(s)).toEqual([]);
    expect(s.screenText().join("\n")).not.toContain("Indexing disabled");
  }, 40000);
});

describe.skipIf(WINDOWS)("Other indexing lines from Auggie", () => {
  test("File limit: a warning notice shows Auggie's text, no card opens and the conversation has no agent message for it", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1", "--indexing-limited", repo] });
    const s = start(w, repo, ["auggie"], { cols: 200, rows: 30 });
    await s.waitFor(READY, 20000);
    const text = `Indexing limited for "${repo}": file limit reached.`;
    await s.waitFor(() => (promptBox(s)[0] ?? "").includes(text), 5000);
    await Bun.sleep(300);
    expect(card(s)).toEqual([]);
    // Only the notice: the conversation (above the prompt box) has no copy of it.
    const screen = s.screenText();
    const top = screen.findIndex((r) => r.includes(text));
    expect(screen.filter((r) => r.includes(text))).toHaveLength(1);
    expect(screen[top]).toBe(promptBox(s)[0]);
  }, 40000);
});
