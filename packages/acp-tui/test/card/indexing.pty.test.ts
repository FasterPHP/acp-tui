// The indexing question (auggie-1x-support design D16): the real CLI against fake-agent's `auggie-1`
// scenario under a PTY, each run with its own configuration and session index (list-world.ts).
// Specs tui-agent-session "Auggie's indexing line becomes a question", "Allowing Auggie to index",
// "Declining Auggie's indexing" and "Other indexing lines from Auggie"; tui-layout "Indexing
// question card".
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { READY, RUNNING, REQUIRES_ACTION, promptBox, promptText } from "../pty/regions.ts";
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

  test("Added directory: the session directory is allowed, /add-dir ../lib restarts the harness with --add-workspace, and the card names the added directory only", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    const lib = w.dir("lib");
    // Auggie already has a rule for the session directory (as in check B), and a session store so the
    // restarted process can load the session.
    const store = join(w.base, "indexing.json");
    writeFileSync(store, JSON.stringify({ indexingAllowDirs: [repo] }));
    w.configure({ auggie: ["--scenario", "auggie-1", "--indexing-store", store, "--sessions", join(w.base, "sessions.json"), "--persist"] });
    const file = join(w.env["XDG_CONFIG_HOME"]!, "acp-tui", "config.jsonc");
    const config = JSON.parse(readFileSync(file, "utf8")) as { agent_servers: Record<string, Record<string, unknown>> };
    config.agent_servers["auggie"]!["additional_directory_args"] = ["--add-workspace", "{dir}"];
    writeFileSync(file, JSON.stringify(config));
    const s = start(w, repo, ["auggie"], { cols: 120, rows: 40 });
    await s.waitFor(READY, 20000);
    s.sendKeys({ text: "hello" }, "Enter");
    await s.waitFor("Hello from fake Auggie.", 10000);
    await s.waitFor(READY, 10000);
    expect(card(s)).toEqual([]);
    // `/` opens the slash menu; Esc leaves it as text, then the rest of the command.
    s.sendKeys({ text: "/" });
    await s.waitFor("Slash commands", 5000);
    s.sendKeys("Esc");
    await s.waitFor((p) => !p.screenText().join("\n").includes("Slash commands") && promptText(p).join("").trim() === "/", 5000);
    s.sendKeys({ text: "add-dir ../lib" }, "Enter");
    await s.waitFor("and reopen this session", 10000);
    s.sendKeys("Enter");
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    const body = cardBody(s);
    expect(body).toContain(lib);
    expect(body).not.toContain(repo);
    expect(w.received("auggie").filter((e) => e.method === "argv/add-workspace").map((e) => e.params?.["directories"])).toEqual([[lib]]);
    expect(methods(w)).toContain("session/load");
    expect(s.screenText().join("\n")).not.toContain("Indexing disabled");
  }, 60000);

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
  test("One directory at 63x21: Question from acp-tui, the directory, what allowing does, that Auggie remembers the choice, 1 allow indexing and 2 not now", async () => {
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
    for (const part of [repo, "--allow-indexing", "remembers your choice", "1 allow indexing 2 not now"]) expect(body).toContain(part);
    for (const gone of ["indexingAllowDirs", "never index", "reopens this session", "starts a new session"]) expect(body).not.toContain(gone);
    expect(rows.at(-1)).toContain("esc not now");
    expect(rows.at(-1)).toContain("up/down select");
    expect(rows.at(-1)).not.toContain("enter");
    // Never cut: every row of the body is inside the frame.
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(63);
  }, 40000);

  test("Nothing is selected: Enter does nothing until an arrow key chooses, then Enter answers; the footer says select, then enter choose", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo);
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await afterGuard();
    s.sendKeys("Enter");
    await Bun.sleep(600);
    expect(card(s).length).toBeGreaterThan(0);
    expect(methods(w)).toEqual(["initialize", "session/new"]);
    expect(card(s).at(-1)).toContain("select");
    // Down chooses `1 allow indexing`; the footer now says enter choose.
    s.sendKeys("Down");
    await s.waitFor(() => (card(s).at(-1) ?? "").includes("enter choose"), 5000);
    // Down again moves to `2 not now`; Enter declines and closes the card.
    s.sendKeys("Down", "Enter");
    await s.waitFor(() => card(s).length === 0, 5000);
    expect(methods(w)).toEqual(["initialize", "session/new"]);
  }, 40000);

  /** The screen row and column of `text` in the card, or null. */
  const cellOf = (s: PtySession, text: string): { x: number; y: number } | null => {
    const rows = s.screenText();
    for (let y = 0; y < rows.length; y++) {
      const x = rows[y]!.indexOf(text);
      if (x >= 0) return { x, y };
    }
    return null;
  };
  /** A cell of the prompt box's text row, two rows below the card's bottom frame. */
  const promptCell = (s: PtySession) => {
    const bottom = s.screenText().findIndex((r) => r.startsWith("╰") && r.includes("─"));
    return { x: 6, y: bottom + 2 };
  };

  test("Focus leaves and comes back: a click in the prompt box takes focus, Tab Tab (or a click on the card) returns it, then Esc answers not now; the status row says how to get back", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo, ["auggie"], { cols: 100, rows: 40 });
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await afterGuard();
    const at = promptCell(s);
    s.mouseClick(at.x, at.y);
    await s.waitFor(() => s.screenText().join("\n").includes("tab tab question"), 5000);
    // Esc with the prompt box focused does not answer the card.
    s.sendKeys("2");
    await Bun.sleep(400);
    expect(card(s).length).toBeGreaterThan(0);
    s.sendKeys("Backspace");
    s.sendKeys("Tab", "Tab");
    await s.waitFor(() => (card(s).at(-1) ?? "").includes("esc not now"), 5000);
    await s.waitFor(() => !s.screenText().join("\n").includes("tab tab question"), 5000);
    s.sendKeys("Esc");
    await s.waitFor(() => card(s).length === 0, 5000);
  }, 40000);

  test("A click on the card restores focus, a click on an option selects it without answering, and Enter then answers", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo, ["auggie"], { cols: 100, rows: 40 });
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await afterGuard();
    const at = promptCell(s);
    s.mouseClick(at.x, at.y);
    await s.waitFor(() => s.screenText().join("\n").includes("tab tab question"), 5000);
    // The option's row: its click focuses the card and selects it (enter choose appears).
    const two = cellOf(s, "2 not now")!;
    s.mouseClick(two.x + 3, two.y);
    await s.waitFor(() => (card(s).at(-1) ?? "").includes("enter choose"), 5000);
    expect(card(s).length).toBeGreaterThan(0);
    expect(methods(w)).toEqual(["initialize", "session/new"]);
    // Focus away again, then a click on the card's text restores it without selecting.
    s.mouseClick(at.x, at.y);
    await s.waitFor(() => s.screenText().join("\n").includes("tab tab question"), 5000);
    const body = cellOf(s, "Auggie is not indexing")!;
    s.mouseClick(body.x + 2, body.y);
    await s.waitFor(() => !s.screenText().join("\n").includes("tab tab question"), 5000);
    s.sendKeys("Enter");
    await s.waitFor(() => card(s).length === 0, 5000);
    expect(methods(w)).toEqual(["initialize", "session/new"]);
  }, 40000);

  test("A digit answers from the conversation too, as a permission card's does", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo, ["auggie"], { cols: 100, rows: 40 });
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await afterGuard();
    const at = promptCell(s);
    s.mouseClick(at.x, at.y);
    await s.waitFor(() => s.screenText().join("\n").includes("tab tab question"), 5000);
    s.sendKeys("Tab");
    await Bun.sleep(200);
    s.sendKeys({ text: "2" });
    await s.waitFor(() => card(s).length === 0, 5000);
  }, 40000);

  test("An arrow then Enter on 1 allows: the harness restarts with --allow-indexing", async () => {
    const w = listWorld();
    const repo = w.dir("repo");
    w.configure({ auggie: ["--scenario", "auggie-1"] });
    const s = start(w, repo);
    await s.waitFor(() => cardText(s).includes("2 not now"), 20000);
    await afterGuard();
    s.sendKeys("Down", "Enter");
    await s.waitFor(() => methods(w).includes("argv/allow-indexing"), 10000);
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
    await s.waitFor(READY, 10000);
    await s.waitFor(() => cardText(s).includes("2 not now"), 10000);
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
    // The harness writes its rule as it starts the new session; under load that can land after the
    // screen is ready, so wait for the file rather than reading it once.
    const allowed = (): unknown => (existsSync(store) ? JSON.parse(readFileSync(store, "utf8")).indexingAllowDirs : null);
    await first.waitFor(() => JSON.stringify(allowed()) === JSON.stringify([repo]), 10000);
    expect(allowed()).toEqual([repo]);
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
