// Debug log (design D11, task 5.1): one JSON object per line, enabled by
// `ACP_TUI_LOG=<path>`. Records method names, request/session ids, state
// transitions and timings only -- NEVER prompt or message text (design
// section 8: "debug logs record method names, IDs and state transitions,
// not prompt content"). Writes are synchronous so line order matches call
// order, mirroring fake-agent's ScenarioLogger.
import { appendFileSync } from "node:fs";

export interface DebugLogEntry {
  readonly event: string;
  readonly [key: string]: unknown;
}

export interface DebugLogger {
  /** Appends one line. `at` defaults to `Date.now()` if not supplied. */
  log(entry: DebugLogEntry): void;
  readonly enabled: boolean;
}

class FileDebugLogger implements DebugLogger {
  readonly enabled = true;
  constructor(private readonly path: string) {}

  log(entry: DebugLogEntry): void {
    const line = { ts: new Date().toISOString(), ...entry };
    try {
      appendFileSync(this.path, `${JSON.stringify(line)}\n`, "utf8");
    } catch {
      // A debug log write failure must never crash the client; drop the line.
    }
  }
}

class NullDebugLogger implements DebugLogger {
  readonly enabled = false;
  log(): void {
    // no-op
  }
}

export const NULL_LOGGER: DebugLogger = new NullDebugLogger();

/** Reads `ACP_TUI_LOG` (or an explicit path) and returns the matching logger. */
export function createDebugLogger(path: string | undefined): DebugLogger {
  return path ? new FileDebugLogger(path) : NULL_LOGGER;
}

/** Small helper for timing a step and logging `{ event, ms }` plus extra fields. */
export function timeStep<T>(logger: DebugLogger, event: string, fn: () => Promise<T>, extra?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  return fn().then(
    (result) => {
      logger.log({ event, ms: Math.round(performance.now() - start), ok: true, ...extra });
      return result;
    },
    (error: unknown) => {
      logger.log({ event, ms: Math.round(performance.now() - start), ok: false, ...extra });
      throw error;
    },
  );
}
