// Detach on Linux and macOS is unchanged by the Windows process-tree kill (windows-support D5): a
// harness that ignores the end of its input is ended by kill() after the grace period.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DebugLogger } from "../../src/log.ts";
import { startSession } from "../../src/session/controller.ts";

const FAKE_AGENT_MAIN = fileURLToPath(new URL("../../../fake-agent/src/main.ts", import.meta.url));

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === "win32")("detach kills a harness that ignores the end of its input", () => {
  test("after the grace period the process is gone, and detach has resolved", async () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-stubborn-"));
    const script = join(dir, "stubborn.ts");
    // fake-agent as it is, kept alive by a timer when its stdin ends.
    writeFileSync(script, `setInterval(() => {}, 1000);\nawait import(${JSON.stringify(FAKE_AGENT_MAIN)});\n`);
    const events: { event: string; pid?: number }[] = [];
    const logger = { enabled: true, log: (event: { event: string; pid?: number }) => void events.push(event) } as unknown as DebugLogger;
    const controller = await startSession({ command: ["bun", script, "--scenario", "basic", "--delay-scale", "0"], cwd: dir, logger, detachGraceMs: 300 });
    const pid = events.find((e) => e.event === "agent_launched")!.pid!;
    expect(running(pid)).toBe(true);

    const started = Date.now();
    await controller.detach();
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    for (let i = 0; i < 60 && running(pid); i++) await Bun.sleep(50);
    expect(running(pid)).toBe(false);
  });
});
