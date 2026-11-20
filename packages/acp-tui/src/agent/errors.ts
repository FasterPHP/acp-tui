// The text of an error a harness answered a request with (spec tui-agent-session "Reasons in
// agent errors"): the JSON-RPC message, plus the reason the harness gives in `data` when there is
// one. Auggie 1.x answers `-32603 Internal error` for nearly everything and says what went wrong
// only in `data.details`.
import { sanitise } from "acp-model";

/** The longest reason shown (characters, the ellipsis included). */
const REASON_LIMIT = 240;

function textOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function rawReason(error: unknown): string | null {
  const data = (error as { data?: unknown } | null)?.data;
  if (data === null || data === undefined) return null;
  const direct = textOf(data);
  if (direct !== null) return direct;
  if (typeof data !== "object") return null;
  const record = data as { details?: unknown; message?: unknown };
  return textOf(record.details) ?? textOf(record.message);
}

/** The reason in a JSON-RPC error's `data` (a string, or a string `details` or `message`): its first
 *  non-empty line, sanitised and cut to 240 characters with `…`; null when there is none. */
export function agentErrorReason(error: unknown): string | null {
  const raw = rawReason(error);
  if (raw === null) return null;
  const line = sanitise(raw, "approval")
    .split(/\r\n|\r|\n/)
    .map((part) => part.trim())
    .find((part) => part !== "");
  if (line === undefined) return null;
  const chars = Array.from(line);
  return chars.length > REASON_LIMIT ? `${chars.slice(0, REASON_LIMIT - 1).join("")}…` : line;
}

/** The error's message plus `: <reason>` (not repeated when it equals the message). */
export function agentErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const reason = agentErrorReason(error);
  if (reason === null || reason === message.trim()) return message;
  return `${message}: ${reason}`;
}
