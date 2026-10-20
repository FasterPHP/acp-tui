// Shared by frame-log.test.ts and frame-log.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { createTestRenderer } from "@opentui/core/testing";
import type { CliRenderer } from "@opentui/core";
import { type DebugLogEntry, type DebugLogger } from "../../src/log.ts";

export function memoryLogger(): { logger: DebugLogger; entries: DebugLogEntry[] } {
  const entries: DebugLogEntry[] = [];
  return { logger: { enabled: true, log: (e) => void entries.push(e) }, entries };
}

export async function setup() {
  made = await createTestRenderer({ width: 40, height: 10 });
  renderer = made.renderer;
  return made;
}

let renderer: CliRenderer | null = null;
let made: Awaited<ReturnType<typeof createTestRenderer>> | null = null;

/** For each test file's `afterEach`. */
export async function disposeMade(): Promise<void> {
  await made?.dispose();
  made = null;
  renderer = null;
}
