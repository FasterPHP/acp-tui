// Unsent drafts kept per session (spec tui-sessions "Unsent drafts kept per session", "Draft files
// are private", "Draft limits and failures" and "Draft files are not trusted"; design D10 to D13).
//
// One small JSON file per session in `drafts/` beside the session index, named by the SHA-256 of
// the harness name, a NUL and the session ID, so a hostile session ID never reaches a path. A draft
// may hold a secret, so the files are private: written whole to a temporary file created with mode
// 0600 and renamed over the old one (through `platform/replace-file.ts`, with the index's retries
// on Windows), in a directory of mode 0700, and deleted when the draft is sent or emptied. Nothing
// is written while the user types; the app saves when it leaves the session.
//
// A file is not trusted, as the index is not: it must parse, be of this version, be within the size
// limit and name the session it is stored for; its text passes the prompt box's input rule, a
// mention is kept only if its range lies inside the text and holds exactly its text, and the cursor
// is clamped to the text.
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { promptInput } from "../app/prompt-input.ts";
import { renameOver } from "../platform/replace-file.ts";

/** The largest draft stored, in bytes of UTF-8 (spec tui-sessions "Draft limits and failures"). */
export const MAX_DRAFT_BYTES = 256 * 1024;

/** The most draft files kept; the oldest by `savedAt` beyond it are removed after a write. */
export const MAX_DRAFT_FILES = 200;

/** A file larger than this is never read: the text's limit with room for JSON escapes and mentions. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const FILE_SUFFIX = ".json";

/** A mention in a draft: a range of the text (UTF-16 indices), the file's relative path and the text the range holds. */
export interface DraftMention {
  readonly start: number;
  readonly end: number;
  readonly path: string;
  readonly text: string;
}

/** The prompt box's draft: its text exactly as in the box, the cursor as a UTF-16 index and the intact mentions. */
export interface Draft {
  readonly text: string;
  readonly cursor: number;
  readonly mentions: readonly DraftMention[];
}

/** The session a draft belongs to: the harness's name in the configuration (or `ad hoc`) and the session ID. */
export interface DraftKey {
  readonly harness: string;
  readonly sessionId: string;
}

/** What `save` did: stored, not stored because over the limit, or not stored because the write failed. */
export type SaveResult = "saved" | "too_large" | "failed";

export interface DraftStore {
  /** Stores the draft (any older one for the session is replaced); an empty draft removes the file. */
  save(key: DraftKey, draft: Draft): SaveResult;
  /** The session's draft as the prompt box may take it, or null when there is none or the file is not trusted. */
  load(key: DraftKey): Draft | null;
  /** Removes the session's draft file; nothing happens when there is none. */
  remove(key: DraftKey): void;
}

export interface DraftStoreOptions {
  /** The `drafts/` directory (`platform/paths.ts` `draftsDirectory`). */
  readonly dir: string;
  /** Called at most once, with a one-line text, when the directory cannot be written. */
  readonly onWarning?: (text: string) => void;
  readonly now?: () => number;
  /** Test hooks for the limits. */
  readonly maxBytes?: number;
  readonly maxFiles?: number;
}

/** The file name of a session's draft. */
export function draftFileName(key: DraftKey): string {
  return `${createHash("sha256").update(`${key.harness}\0${key.sessionId}`).digest("hex")}${FILE_SUFFIX}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The part of `text` a cursor may stand at: not between the halves of a surrogate pair. */
function clampCursor(text: string, cursor: number): number {
  let at = Math.max(0, Math.min(text.length, Math.trunc(cursor)));
  if (at > 0 && at < text.length && text.charCodeAt(at) >= 0xdc00 && text.charCodeAt(at) <= 0xdfff && text.charCodeAt(at - 1) >= 0xd800 && text.charCodeAt(at - 1) <= 0xdbff) at--;
  return at;
}

/** A draft as the prompt box may take it: the text through its input rule, the intact mentions only, the cursor clamped. */
export function trustedDraft(value: unknown, maxBytes = MAX_DRAFT_BYTES): Draft | null {
  if (!isRecord(value) || typeof value["text"] !== "string") return null;
  if (Buffer.byteLength(value["text"]) > maxBytes) return null;
  const text = promptInput(value["text"]);
  if (text === "") return null;
  const mentions: DraftMention[] = [];
  if (Array.isArray(value["mentions"]) && text === value["text"]) {
    // The ranges are indices into the stored text: only when the input rule left it as it was do they still mean the same characters.
    for (const m of value["mentions"] as unknown[]) {
      if (!isRecord(m) || typeof m["path"] !== "string" || typeof m["text"] !== "string" || !Number.isInteger(m["start"]) || !Number.isInteger(m["end"])) continue;
      const start = m["start"] as number;
      const end = m["end"] as number;
      if (start < 0 || end <= start || end > text.length || text.slice(start, end) !== m["text"]) continue;
      const last = mentions.at(-1);
      if (last && start < last.end) continue;
      mentions.push({ start, end, path: m["path"], text: m["text"] });
    }
  }
  const cursor = typeof value["cursor"] === "number" && Number.isFinite(value["cursor"]) ? value["cursor"] : text.length;
  return { text, cursor: clampCursor(text, cursor), mentions };
}

export function createDraftStore(options: DraftStoreOptions): DraftStore {
  const { dir } = options;
  const now = options.now ?? Date.now;
  const maxBytes = options.maxBytes ?? MAX_DRAFT_BYTES;
  const maxFiles = options.maxFiles ?? MAX_DRAFT_FILES;
  let warned = false;

  const warn = (error: unknown): void => {
    if (warned) return;
    warned = true;
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    options.onWarning?.(`cannot keep the draft: ${reason}`);
  };

  const pathOf = (key: DraftKey): string => join(dir, draftFileName(key));

  function ensureDirectory(): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // A directory made earlier (or by another tool) may be wider; Windows has no such modes.
    if (process.platform !== "win32") chmodSync(dir, 0o700);
  }

  function remove(key: DraftKey): void {
    try {
      unlinkSync(pathOf(key));
    } catch {
      // No file, or it cannot be removed: nothing more to do.
    }
  }

  /** Removes the oldest files beyond the limit. */
  function prune(): void {
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith(FILE_SUFFIX));
    } catch {
      return;
    }
    if (names.length <= maxFiles) return;
    const aged = names.map((name) => {
      let savedAt = 0;
      try {
        const stat = statSync(join(dir, name));
        savedAt = stat.mtimeMs;
        if (stat.size <= MAX_FILE_BYTES) {
          const parsed: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
          if (isRecord(parsed) && typeof parsed["savedAt"] === "number" && Number.isFinite(parsed["savedAt"])) savedAt = parsed["savedAt"];
        }
      } catch {
        // An unreadable file counts by its modification time, or as the oldest.
      }
      return { name, savedAt };
    });
    aged.sort((a, b) => a.savedAt - b.savedAt || (a.name < b.name ? -1 : 1));
    for (const { name } of aged.slice(0, aged.length - maxFiles)) {
      try {
        unlinkSync(join(dir, name));
      } catch {
        // Left for the next write.
      }
    }
  }

  return {
    remove,

    save(key, draft) {
      if (draft.text === "") {
        remove(key);
        return "saved";
      }
      if (Buffer.byteLength(draft.text) > maxBytes) {
        // An older draft of the session must not come back in place of this one.
        remove(key);
        return "too_large";
      }
      const body = JSON.stringify({
        version: 1,
        harness: key.harness,
        sessionId: key.sessionId,
        text: draft.text,
        cursor: draft.cursor,
        mentions: draft.mentions,
        savedAt: now(),
      });
      const target = pathOf(key);
      const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      let fd: number | null = null;
      try {
        ensureDirectory();
        fd = openSync(temporary, "wx", 0o600);
        writeSync(fd, body);
        closeSync(fd);
        fd = null;
        renameOver(temporary, target);
      } catch (error) {
        if (fd !== null) {
          try {
            closeSync(fd);
          } catch {
            // Already closed.
          }
        }
        try {
          unlinkSync(temporary);
        } catch {
          // Never created.
        }
        warn(error);
        return "failed";
      }
      prune();
      return "saved";
    },

    load(key) {
      const file = pathOf(key);
      try {
        if (statSync(file).size > MAX_FILE_BYTES) return null;
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (!isRecord(parsed) || parsed["version"] !== 1 || parsed["harness"] !== key.harness || parsed["sessionId"] !== key.sessionId) return null;
        return trustedDraft(parsed, maxBytes);
      } catch {
        return null;
      }
    },
  };
}
