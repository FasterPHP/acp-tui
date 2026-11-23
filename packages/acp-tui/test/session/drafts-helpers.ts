// Shared by the draft PTY tests (prompt-box-feedback groups 6 to 8). Not a test file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDraftStore, draftFileName, type DraftStore } from "../../src/session/drafts.ts";
import type { PtySession } from "../pty/harness.ts";
import { promptText } from "../pty/regions.ts";
import { boxRows } from "../overlay/cli.ts";
import { listWorld, type ListWorld } from "./list-world.ts";

export const MINUTE = 60_000;

export interface DraftWorld {
  readonly w: ListWorld;
  readonly repo: string;
  /** `<state>/acp-tui/drafts`. */
  readonly dir: string;
  readonly store: DraftStore;
  /** The path of a session's draft file. */
  file(sessionId: string): string;
  /** Whether the session's draft file exists. */
  has(sessionId: string): boolean;
  /** The text of the session's draft file, or null. */
  text(sessionId: string): string | null;
  /** The session index file's text. */
  indexText(): string;
}

export interface DraftWorldOptions {
  /** fake-agent advertises `loadSession` and holds the fixtures `s-0` ("One") and `s-1` ("Two"); default true. */
  readonly load?: boolean;
  /** `prompt.keep_drafts`; default true. */
  readonly keep?: boolean;
  /** More fake-agent arguments. */
  readonly args?: readonly string[];
  /** The fake-agent scenario; default `copy-fixtures`, which answers every prompt at once. */
  readonly scenario?: string;
}

/** A world with two indexed sessions `s-0` (newest) and `s-1` of `fake` in `repo`. */
export function draftWorld(options: DraftWorldOptions = {}): DraftWorld {
  const w = listWorld();
  const repo = w.dir("repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "app.ts"), "export {};\n");
  const fixtures = w.sessions("store", [
    { sessionId: "s-0", cwd: repo, title: "One", updatedAt: new Date(Date.now() - MINUTE).toISOString(), turns: [] },
    { sessionId: "s-1", cwd: repo, title: "Two", updatedAt: new Date(Date.now() - 2 * MINUTE).toISOString(), turns: [] },
  ]);
  const args = ["--scenario", options.scenario ?? "copy-fixtures", ...(options.load === false ? [] : ["--load", "--sessions", fixtures]), ...(options.args ?? [])];
  w.configure({ fake: args }, options.keep === false ? { prompt: { keep_drafts: false } } : {});
  w.record(
    { agent: "fake", sessionId: "s-0", directory: repo, title: "One", at: Date.now() - MINUTE },
    { agent: "fake", sessionId: "s-1", directory: repo, title: "Two", at: Date.now() - 2 * MINUTE },
  );
  const dir = join(w.stateHome, "acp-tui", "drafts");
  const key = (id: string) => ({ harness: "fake", sessionId: id });
  const file = (id: string) => join(dir, draftFileName(key(id)));
  return {
    w,
    repo,
    dir,
    store: createDraftStore({ dir }),
    file,
    has: (id) => existsSync(file(id)),
    text: (id) => (existsSync(file(id)) ? (JSON.parse(readFileSync(file(id), "utf8")) as { text: string }).text : null),
    indexText: () => readFileSync(join(w.stateHome, "acp-tui", "sessions.jsonl"), "utf8"),
  };
}

/** Writes the draft `text` for `fake`'s session `id`. */
export function keep(d: DraftWorld, id: string, text: string, cursor = text.length, mentions: readonly { start: number; end: number; path: string; text: string }[] = []): void {
  d.store.save({ harness: "fake", sessionId: id }, { text, cursor, mentions });
}

const ESCAPES = /\x1b\[[0-9;?<=>]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>78]/g;

/** The lines written after the final reset, from the raw output (so the terminal's wrapping does not matter). */
export function exitLines(s: PtySession): string[] {
  const raw = s.rawOutput();
  const tail = raw.slice(raw.lastIndexOf("\x1b[?1049l")).replace(ESCAPES, "").replace(/\r/g, "");
  const lines = tail.split("\n");
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  while (lines.length > 0 && lines[0] === "") lines.shift();
  return lines;
}

/** Opens the session list with `/sessions` and chooses the entry titled `title`. */
export async function chooseSession(s: PtySession, title: string, options: { closes?: boolean } = {}): Promise<void> {
  // The palette (Ctrl+P) works with any draft in the prompt box; `/` would not.
  s.sendKeys("Ctrl+P");
  await s.waitFor(/Commands \d+/, 5000);
  s.sendKeys({ text: "session list" });
  await s.waitFor(() => boxRows(s, "Commands").some((r) => r.includes("Open the session list")), 5000);
  s.sendKeys("Enter");
  await s.waitFor(() => boxRows(s, /─ Sessions/).length > 0, 5000);
  s.sendKeys({ text: title });
  await s.waitFor(() => boxRows(s, /─ Sessions/).some((r) => r.includes(`› ${title}`)), 5000);
  s.sendKeys("Enter");
  // The list closes once the session is open (a refused switch keeps it open with the reason).
  if (options.closes !== false) await s.waitFor(() => boxRows(s, /─ Sessions/).length === 0, 15000);
}

export const promptIs = (s: PtySession, lines: string[]) => () => {
  const now = promptText(s);
  return now.length === lines.length && now.every((l, i) => l === lines[i]);
};
