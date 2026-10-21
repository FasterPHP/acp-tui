// The crash report (colleague-preview design D7, spec tui-screen "Crash report"): on an uncaught
// error, after the terminal is restored, `crashes/<YYYYMMDD>T<HHMMSS>Z.txt` in the state directory
// holds the version lines, the error and its stack, and the debug log's last events (method names,
// ids, states and timings, never conversation text).
import { constants, mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { recentEvents } from "./log.ts";
import { pathsFor, stateDirectory } from "./platform/paths.ts";
import { gatherVersionInfo, versionLines } from "./version.ts";

/** `20261021T093015Z` for a moment, in UTC. */
export function crashFileStamp(now: Date): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
}

/** The report's text: version lines, `error: <message>`, the stack, then the events as JSON lines. */
export function crashReportText(error: unknown, versions: readonly string[], events: readonly Record<string, unknown>[]): string {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : "(no stack)";
  const lines = [...versions, "", `error: ${message}`, "", stack, "", "events:", ...events.map((event) => JSON.stringify(event))];
  return `${lines.join("\n")}\n`;
}

/**
 * Writes the report and returns its path, or null when it cannot be written. The directory is
 * created 0700 and the file exclusively 0600 (modes are not applied on Windows).
 */
export function writeCrashReport(error: unknown, options: { env?: Readonly<Record<string, string | undefined>>; now?: Date; platform?: NodeJS.Platform } = {}): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  try {
    const rules = pathsFor(platform);
    const dir = rules.join(stateDirectory(env, platform), "crashes");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = rules.join(dir, `${crashFileStamp(options.now ?? new Date())}.txt`);
    const text = crashReportText(error, versionLines(gatherVersionInfo(env)), recentEvents());
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeSync(fd, text);
    } finally {
      closeSync(fd);
    }
    return path;
  } catch {
    return null;
  }
}
