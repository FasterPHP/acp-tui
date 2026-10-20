// The exit text (phase-1a task 4.3, mvp-sessions tasks 8.1, 8.3 and 12.2,
// design decision 12, spec tui-screen "Exit text below the command line"):
// what acp-tui prints on the main screen after the final reset. `summary`
// (the default; the name is kept though it now means the resume line, Marcus,
// 5 October 2026, IDE check 10.4, decision A) is one line,
//
//   resume: acp-tui --resume <id>
//
// with ` -- <command and arguments>` added for an agent given after `--`
// (`adHocCommand`), each word quoted when it needs it (for a POSIX shell, for PowerShell on Windows), since
// the index never stores a command to run (design decision 2). It is printed
// only when the session can be reopened (`canReopen`: the agent advertises
// `loadSession` or `sessionCapabilities.resume`; and `hadPromptOrOpened`: it
// has had a prompt or was itself opened by load or resume). Otherwise nothing
// is printed: no session ID, title, agent or directory. `none` prints
// nothing. `last-answer` and `transcript` (mvp-conversation task 7.1)
// add the last answer or the whole conversation as plain, sanitised
// text wrapped at the terminal's width (src/find/hand-back.ts), after a blank
// line when there is a resume line, else at once. An error that ends the run
// is printed by the lifecycle after this text.
//
// Every part is sanitised with acp-model's sanitiser in approval mode (the
// model has already sanitised the agent's fields in default mode; the command
// is not the agent's but is not trusted either), and tabs and line breaks
// become spaces so the line stays one line. The text starts with `\r` and each
// line ends with `\n`: the terminal is back in cooked mode, and nothing
// addresses the cursor, so the text lands where the cursor is, on the row
// below the command line.
import { sanitise, type Session } from "acp-model";
import { shellWordFor } from "../platform/shell-quote.ts";
import type { Platform } from "../platform/paths.ts";
import { handBackLines } from "../find/hand-back.ts";
import type { ExitPrint } from "./options.ts";

/**
 * Sanitised and on one line. Approval mode also drops bidi controls and
 * zero-width characters: the line stays on the main screen next to the
 * user's shell, where nothing should reorder or hide text.
 */
function clean(text: string): string {
  return sanitise(text, "approval").replace(/[\t\n\v\f]+/g, " ");
}

/** A word for the user's shell: for a POSIX shell as is when it holds only safe characters, else in
 *  single quotes with each embedded single quote written `'\''`; on Windows (`platform`
 *  `win32`) for PowerShell, in single quotes with an embedded single quote doubled. */
export function shellQuote(word: string, platform: Platform = process.platform): string {
  return shellWordFor(word, platform);
}

export interface ExitTextInput {
  readonly session: (Pick<Session, "id"> & Partial<Pick<Session, "order" | "items">>) | null;
  /** The agent advertises `loadSession` or `sessionCapabilities.resume`; default false (no resume line). */
  readonly canReopen?: boolean;
  /** The session has had a prompt, or was itself opened by load or resume; default false (no resume line). */
  readonly hadPromptOrOpened?: boolean;
  /** The agent command given after `--` (`ad hoc`), repeated in the resume line; default null (a named agent). */
  readonly adHocCommand?: readonly string[] | null;
  /** The platform whose shell the resume line is quoted for; default `process.platform`. */
  readonly platform?: Platform;
  /** The terminal's width in columns when acp-tui exits (`last-answer`, `transcript`); default 80. */
  readonly width?: number;
}

/** The resume line without its line ending, or null when the session cannot be reopened or has nothing to reopen. */
export function resumeLine({ session, canReopen, hadPromptOrOpened, adHocCommand, platform }: ExitTextInput): string | null {
  if (!session?.id || !canReopen || !hadPromptOrOpened) return null;
  const id = clean(session.id);
  // An ID that starts with `-` would read as an option after `--resume` (design decision 9).
  const base = id.startsWith("-") ? `resume: acp-tui --resume=${shellQuote(id, platform)}` : `resume: acp-tui --resume ${shellQuote(id, platform)}`;
  if (!adHocCommand || adHocCommand.length === 0) return base;
  return `${base} -- ${adHocCommand.map((word) => shellQuote(clean(word), platform)).join(" ")}`;
}

/** The exit text to write after the final reset; empty for `none`, and for `summary` when the
 *  session cannot be resumed. */
export function exitText(mode: ExitPrint, input: ExitTextInput): string {
  if (mode === "none") return "";
  const resume = resumeLine(input);
  const head = resume === null ? "" : `\r${resume}\n`;
  if (mode === "summary") return head;
  const { session } = input;
  const lines = session?.order && session.items ? handBackLines(mode, { order: session.order, items: session.items }, input.width ?? 80) : null;
  if (lines === null || lines.length === 0) return head;
  const body = lines.map((l) => `${l}\n`).join("");
  return resume === null ? `\r${body}` : `${head}\n${body}`;
}
