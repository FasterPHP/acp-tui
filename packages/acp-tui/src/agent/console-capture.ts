// Console capture (task 5.4): while the full-screen renderer is active,
// nothing may write to the terminal outside OpenTUI's own renderables --
// including the SDK's own diagnostics. The client-side SDK logs dropped or
// malformed notifications with `console.error("Error handling notification",
// message.raw, response.error)` (see docs/phase-0-notes/fake-agent.md, the
// unknown-variant finding); left alone this would corrupt the
// screen the moment an agent sends something the SDK's zod schema rejects.
//
// This redirects console.log/info/debug/warn/error for the lifetime of the
// app to an in-memory ring buffer (full text, for local diagnostics only,
// never printed) plus a length-only line in the debug log if enabled --
// design section 8 forbids message/prompt text in the debug log, and SDK
// console arguments can include the raw notification payload, which may
// contain agent message text, so only its length is recorded there.
import type { DebugLogger } from "../log.ts";
import { RingBuffer } from "./ring-buffer.ts";

type ConsoleMethod = "log" | "info" | "debug" | "warn" | "error";
const METHODS: readonly ConsoleMethod[] = ["log", "info", "debug", "warn", "error"];

export interface ConsoleCapture {
  /** Full captured text, for local troubleshooting only -- never rendered. */
  readonly buffer: RingBuffer;
  /** Restores the original console methods. Safe to call more than once. */
  restore(): void;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function captureConsole(logger: DebugLogger, maxBytes = 64 * 1024): ConsoleCapture {
  const buffer = new RingBuffer(maxBytes);
  const original = {} as Record<ConsoleMethod, (...args: unknown[]) => void>;

  for (const method of METHODS) {
    // Stored as-is (not bound): restoring must put back the exact original function reference,
    // not a wrapper, so a caller comparing by identity (or another library that already saved its
    // own reference) sees the real original again.
    original[method] = console[method];
    console[method] = (...args: unknown[]): void => {
      const text = args.map(safeStringify).join(" ");
      buffer.push(`${text}\n`);
      logger.log({ event: "console", level: method, length: text.length });
    };
  }

  let restored = false;
  return {
    buffer,
    restore(): void {
      if (restored) return;
      restored = true;
      for (const method of METHODS) console[method] = original[method];
    },
  };
}
