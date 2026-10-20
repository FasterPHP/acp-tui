// Shared by session-list-startup.pty.test.ts and session-list-startup.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import type { PtySession } from "../pty/harness.ts";
import { listBody, listRows, type ListWorld } from "./list-world.ts";

export const MINUTE = 60_000;
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
export const listOpen = (s: PtySession) => listRows(s).length > 0;
export const methods = (w: ListWorld) => w.received("fake").map((e) => e.method);
/** The footer row: the row above the list's bottom border (a one-line footer). */
export const footerLine = (s: PtySession) => (listBody(s).at(-1) ?? "").trim();
/** The screen row of the list's top border, or -1. */
export const topRow = (s: PtySession) => s.screenText().findIndex((r) => r.startsWith("╭─ Sessions"));
/** The screen row a list row's text starts on, or -1. */
export const rowOf = (s: PtySession, title: string) => s.screenText().findIndex((r) => r.startsWith("│ ") && r.includes(title));

/** Records `n` sessions of `fake` in `repo` in the index, newest first (`Session 00` ...). */
export function indexSessions(w: ListWorld, repo: string, n: number, first = 0, titlePrefix = "Session"): void {
  for (let i = first; i < first + n; i++) {
    w.record({ agent: "fake", sessionId: `s-${i}`, directory: repo, title: `${titlePrefix} ${String(i).padStart(2, "0")}`, at: Date.now() - (i + 1) * MINUTE });
  }
}

/** A store fixture for the harness's own list: sessions `s-<first>` ... in `repo`, minutes ago. */
export function harnessSessions(w: ListWorld, repo: string, ids: readonly { id: string; title: string; minutes: number }[]): string {
  return w.sessions(
    "store",
    ids.map(({ id, title, minutes }) => ({ sessionId: id, cwd: repo, title, updatedAt: ago(minutes * MINUTE), turns: [] })),
  );
}
