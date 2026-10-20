// Minimal JSON-lines logger for fake-agent diagnostics.
//
// Every received method (initialize, session/new, session/prompt,
// session/cancel, and session/close if it ever arrives) is appended as one
// JSON object per line, so acp-tui's own tests can assert on what fake-agent
// actually saw (for example, that detach sends neither session/close nor
// session/cancel). Writes are synchronous so line order matches call order
// even under concurrent turns; this never touches stdout, which must carry
// protocol only.
import { appendFileSync } from "node:fs";

export interface LogEntry {
  readonly ts: string;
  readonly method: string;
  readonly params: unknown;
}

export class ScenarioLogger {
  constructor(private readonly path: string | undefined) {}

  record(method: string, params: unknown): void {
    if (!this.path) {
      return;
    }
    const entry: LogEntry = { ts: new Date().toISOString(), method, params };
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
