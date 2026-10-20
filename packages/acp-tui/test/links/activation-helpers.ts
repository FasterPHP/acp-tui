// Shared by activation.test.ts and activation.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function socketDir(): { dir: string; path: string } {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-act-"));
  return { dir, path: join(dir, "wayland-test") };
}
