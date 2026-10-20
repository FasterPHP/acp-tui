// Export of the conversation as Markdown to a file (design of record 6.3
// "`/export` writes the whole conversation as Markdown to a file").
//
// - Format: `conversationMarkdown` (src/selection/export.ts), with no title,
//   so the file is exactly the model's Markdown rendering.
// - Where: the session's working directory (the directory acp-tui was
//   started from, decision 14), where the user will look for it and where
//   `/export` in the CLI agents writes; if that fails (read-only, removed),
//   the system's temporary directory (`$TMPDIR`, else `/tmp`).
// - Name: `acp-tui-<session>-<YYYYMMDD-HHMMSS>.md`, the session ID cut to
//   its first 12 characters of `[A-Za-z0-9_-]`. The file is created with
//   `wx` (exclusive), so an existing file is never overwritten: on a clash
//   `-2`, `-3` and so on are added before `.md`.
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ExportResult {
  readonly path: string;
  readonly bytes: number;
  /** True when the working directory failed and the file went to the temporary directory. */
  readonly fallback: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `acp-tui-<session>-<stamp>` (without the extension). */
export function exportBaseName(sessionId: string | null, at: Date): string {
  const id = (sessionId ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12);
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return id === "" ? `acp-tui-${stamp}` : `acp-tui-${id}-${stamp}`;
}

/** Creates `<dir>/<base>.md` (or `-2`, `-3`, ...) exclusively and writes `text`; returns the path. */
async function writeNew(dir: string, base: string, text: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const path = join(dir, n === 1 ? `${base}.md` : `${base}-${n}.md`);
    let handle;
    try {
      handle = await open(path, "wx", 0o644);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    try {
      await handle.writeFile(text, "utf8");
    } finally {
      await handle.close();
    }
    return path;
  }
  throw new Error(`no free file name for ${base}.md in ${dir}`);
}

/** Writes the export to `cwd`, else to the temporary directory. */
export async function writeExport(text: string, options: { cwd: string; sessionId: string | null; now?: Date; tmp?: string }): Promise<ExportResult> {
  const base = exportBaseName(options.sessionId, options.now ?? new Date());
  const bytes = Buffer.byteLength(text, "utf8");
  try {
    return { path: await writeNew(options.cwd, base, text), bytes, fallback: false };
  } catch {
    return { path: await writeNew(options.tmp ?? tmpdir(), base, text), bytes, fallback: true };
  }
}
