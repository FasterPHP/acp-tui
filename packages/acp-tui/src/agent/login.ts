// The harness that needs a login (spec tui-agent-session "Harness needs a login"): ACP's error
// -32000, "authentication required", at `session/new` or `session/prompt`. acp-tui does not
// advertise `terminal-auth`, so the harness's own text is the one written for a terminal user.
import { sanitise } from "acp-model";
import { displayWidth, truncateEnd } from "../layout/segments.ts";
import { auggieLoginCommand } from "./command.ts";
import { agentErrorReason } from "./errors.ts";
import type { HarnessProfile } from "./harness-profiles.ts";

/** ACP's "authentication required" error code. */
export const AUTH_REQUIRED_CODE = -32000;

/** The widest the harness's own text is shown (columns). */
const MESSAGE_COLUMNS = 300;

/** What a harness whose program has a login command needs the user to do, added when its message does not say so. */
export function loginStep(command: string): string {
  return `run ${command} in a terminal, then start acp-tui again`;
}

/** What Auggie needs the user to do (`auggie.cmd login` on Windows). */
export const AUGGIE_LOGIN_STEP = loginStep(auggieLoginCommand());

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
  /** The login command of the harness's program (`auggie login`, `opencode auth login`;
   *  src/agent/hints.ts), which gets the login step added; undefined when the program has none. */
  readonly loginHint?: string | undefined;
}

/** `harness 'auggie' needs you to log in: <message>`: the harness's message sanitised, on one line
 *  and at most 300 columns; for a program with a login command, with the login step when the message lacks
 *  that command. */
export function loginMessage(error: unknown, options: LoginMessageOptions): string {
  const raw = error instanceof Error ? error.message : String(error);
  let text = sanitise(raw, "approval").replace(/\s+/g, " ").trim();
  if (displayWidth(text) > MESSAGE_COLUMNS) text = truncateEnd(text, MESSAGE_COLUMNS);
  const who = options.harness === undefined || options.harness === "ad hoc" ? "the ad hoc harness" : `harness '${sanitise(options.harness, "approval").replace(/\s+/g, " ").trim()}'`;
  let message = `${who} needs you to log in${text === "" ? "" : `: ${text}`}`;
  if (options.loginHint !== undefined && !text.includes(options.loginHint)) message += `; ${loginStep(options.loginHint)}`;
  return message;
}

/** The login command to name: the profile's when the harness has one, else the program's
 *  (`hints.ts`: `auggie login` before any profile is known), else none. */
export function loginCommandFor(profile: HarnessProfile | null, programHint: string | undefined): string | undefined {
  return profile !== null ? profile.loginCommand() : programHint;
}

/** What a harness that signals "not logged in" by its model list (`auggie-1`) shows after
 *  `session/new`, `session/load` or `session/resume`: a `model` config option whose current value is
 *  `unknown/unknown` and which offers no choices. Only that exact signature counts (spec
 *  tui-agent-session "Auggie 1.x not logged in at the start"). */
export function isLoggedOutSignature(profile: HarnessProfile | null, configOptions: readonly unknown[] | null | undefined): boolean {
  if (profile === null || !profile.signalsLoggedOutByModel || !configOptions) return false;
  return configOptions.some((raw) => {
    const option = raw as { category?: unknown; id?: unknown; currentValue?: unknown; options?: unknown };
    return (option.category === "model" || option.id === "model") && option.currentValue === "unknown/unknown" && Array.isArray(option.options) && option.options.length === 0;
  });
}

/** The reason an `auggie-1` prompt error gives when no model could be used (`No API key found for unknown.`). */
const NO_API_KEY = /^No API key found/;

/** Whether a prompt error is `auggie-1`'s logged-out answer: its reason (`data.details`) starts `No API key found`. */
export function isNoApiKey(profile: HarnessProfile | null, error: unknown): boolean {
  if (profile === null || !profile.signalsLoggedOutByModel) return false;
  const reason = agentErrorReason(error);
  return reason !== null && NO_API_KEY.test(reason);
}

/** The login text for a failed start, the harness's own message in place of an error's: `harness
 *  'auggie' needs you to log in; run auggie auth login in a terminal, then start acp-tui again`. */
export function loggedOutStartMessage(options: LoginMessageOptions): string {
  return loginMessage(new Error(""), options);
}

/** The conversation's error line for `isNoApiKey`: `harness 'auggie' needs you to log in: <reason>; run ...`. */
export function noApiKeyMessage(error: unknown, options: LoginMessageOptions): string {
  return loginMessage(new Error(agentErrorReason(error) ?? ""), options);
}
