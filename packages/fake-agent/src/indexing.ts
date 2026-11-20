// Auggie 1.2.2's indexing lines (auggie-1x-support task 2.5). In ACP mode a workspace with no allow
// rule is not indexed, and the reason arrives as an agent message right after `session/new` and
// `session/load`; `--allow-indexing` allows a workspace for the session. fake-agent mimics that per
// workspace (the session's directory and each `--add-workspace`), with a store file standing for
// the allow rules in Auggie's settings.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface IndexingOptions {
  /** `--allow-indexing`: every workspace that is not denied is allowed (and stored when there is a store). */
  readonly allow: boolean;
  /** `--indexing-store <file>`: JSON `{ "indexingAllowDirs": [...] }`, read at start, written when a directory is allowed. */
  readonly storePath?: string;
  /** `--indexing-deny <dir>` (repeatable): refused even with `--allow-indexing` or a stored rule. */
  readonly deny: readonly string[];
  /** `--indexing-limited <dir>` (repeatable): indexing starts but stops at the file limit. */
  readonly limited: readonly string[];
  /** `--add-workspace <dir>` (repeatable): workspaces beside the session's directory. */
  readonly addWorkspace: readonly string[];
}

const NO_OPTIONS: IndexingOptions = { allow: false, deny: [], limited: [], addWorkspace: [] };

export function disabledLine(dir: string): string {
  return `Indexing disabled for current workspace "${dir}".\n`;
}

export function limitedLine(dir: string): string {
  return `Indexing limited for "${dir}": file limit reached. Use a smaller workspace or exclude files with .augmentignore.\n`;
}

export class IndexingPolicy {
  private readonly options: IndexingOptions;
  private readonly allowed = new Set<string>();

  constructor(options: IndexingOptions = NO_OPTIONS) {
    this.options = options;
    const { storePath } = options;
    if (storePath !== undefined && existsSync(storePath)) {
      const parsed: unknown = JSON.parse(readFileSync(storePath, "utf8"));
      const dirs = (parsed as { indexingAllowDirs?: unknown } | null)?.indexingAllowDirs;
      if (Array.isArray(dirs)) {
        for (const dir of dirs) if (typeof dir === "string") this.allowed.add(dir);
      }
    }
  }

  /** The lines to send for a session in `cwd`: one per workspace that is not (fully) allowed. */
  lines(cwd: string): string[] {
    const { allow, deny, limited, addWorkspace, storePath } = this.options;
    const lines: string[] = [];
    let changed = false;
    for (const dir of new Set([cwd, ...addWorkspace])) {
      if (limited.includes(dir)) {
        lines.push(limitedLine(dir));
      } else if (deny.includes(dir)) {
        lines.push(disabledLine(dir));
      } else if (allow) {
        if (!this.allowed.has(dir)) {
          this.allowed.add(dir);
          changed = true;
        }
      } else if (!this.allowed.has(dir)) {
        lines.push(disabledLine(dir));
      }
    }
    if (changed && storePath !== undefined) {
      writeFileSync(storePath, `${JSON.stringify({ indexingAllowDirs: [...this.allowed] }, null, 2)}\n`, "utf8");
    }
    return lines;
  }
}
