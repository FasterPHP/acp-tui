// The harness that needs a login (spec tui-agent-session "Harness needs a login"): ACP's error
// -32000, "authentication required", at `session/new` or `session/prompt`. acp-tui does not
// advertise `terminal-auth`, so the harness's own text is the one written for a terminal user.
import { sanitise } from "acp-model";
import { displayWidth, truncateEnd } from "../layout/segments.ts";

/** ACP's "authentication required" error code. */
export const AUTH_REQUIRED_CODE = -32000;

/** The widest the harness's own text is shown (columns). */
const MESSAGE_COLUMNS = 300;

/** What the built-in `auggie` needs the user to do, added when its message does not say so. */
export const AUGGIE_LOGIN_STEP = "run auggie login in a terminal, then start acp-tui again";

/** Whether `error` is the harness answering "authentication required". */
export function isAuthRequired(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === AUTH_REQUIRED_CODE;
}

/** Thrown for an authentication-required answer; the message is the whole text shown to the user. */
export class LoginRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginRequiredError";
  }
}

export interface LoginMessageOptions {
  /** The harness's name in the catalogue, or `ad hoc`. */
  readonly harness: string | undefined;
  /** True for the built-in `auggie`, which gets the login step added. */
  readonly builtInAuggie: boolean;
}

/** `harness 'auggie' needs you to log in: <message>`: the harness's message sanitised, on one line
 *  and at most 300 columns; for the built-in `auggie` with the login step when the message lacks
 *  `auggie login`. */
export function loginMessage(error: unknown, options: LoginMessageOptions): string {
  const raw = error instanceof Error ? error.message : String(error);
  let text = sanitise(raw, "approval").replace(/\s+/g, " ").trim();
  if (displayWidth(text) > MESSAGE_COLUMNS) text = truncateEnd(text, MESSAGE_COLUMNS);
  const who = options.harness === undefined || options.harness === "ad hoc" ? "the ad hoc harness" : `harness '${sanitise(options.harness, "approval").replace(/\s+/g, " ").trim()}'`;
  let message = `${who} needs you to log in${text === "" ? "" : `: ${text}`}`;
  if (options.builtInAuggie && !text.includes("auggie login")) message += `; ${AUGGIE_LOGIN_STEP}`;
  return message;
}
