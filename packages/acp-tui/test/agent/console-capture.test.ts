// Task 5.4: console capture unit test, plus the required check that the
// "basic" scenario's unknown-variant step (fake-agent's task 4.4 fixture)
// produces no terminal output once the SDK's own console.error is
// redirected -- design section 8's "nothing may write to the terminal while
// the footer is active" would otherwise be broken by the SDK's internal
// `console.error("Error handling notification", ...)` (see
// docs/phase-0-notes/fake-agent.md).
import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DebugLogger } from "../../src/log.ts";
import { captureConsole } from "../../src/agent/console-capture.ts";
import { startSession } from "../../src/session/controller.ts";
import { fakeAgentCommand } from "./fake-agent-command.ts";
import { waitFor } from "./wait-for.ts";

class RecordingLogger implements DebugLogger {
  readonly enabled = true;
  readonly entries: Array<Record<string, unknown>> = [];
  log(entry: Record<string, unknown>): void {
    this.entries.push(entry);
  }
}

describe("agent/console-capture (task 5.4)", () => {
  test("redirects console methods to a ring buffer and a length-only debug log entry", () => {
    const logger = new RecordingLogger();
    const capture = captureConsole(logger);
    try {
      console.error("Error handling notification", { some: "payload" });
    } finally {
      capture.restore();
    }

    expect(capture.buffer.tail()).toContain("Error handling notification");
    const consoleEntries = logger.entries.filter((e) => e["event"] === "console");
    expect(consoleEntries).toHaveLength(1);
    expect(consoleEntries[0]).toMatchObject({ event: "console", level: "error" });
    // Never the actual text (design section 8): only a length.
    expect(consoleEntries[0]).not.toHaveProperty("text");
    expect(consoleEntries[0]).not.toHaveProperty("args");
    expect(typeof consoleEntries[0]?.["length"]).toBe("number");
  });

  test("restore() puts back the original console methods", () => {
    const original = console.error;
    const capture = captureConsole(new RecordingLogger());
    expect(console.error).not.toBe(original);
    capture.restore();
    expect(console.error).toBe(original);
  });

  test("the basic scenario's unknown-variant step writes nothing to the real terminal once captured", async () => {
    const writeSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = new RecordingLogger();
    const capture = captureConsole(logger);

    try {
      const cwd = mkdtempSync(join(tmpdir(), "acp-tui-console-capture-"));
      const controller = await startSession({ command: fakeAgentCommand({ scenario: "basic" }), cwd });
      try {
        controller.prompt("trigger the unknown variant step");
        await waitFor(controller, (session) => session.state === "requires_action");
        const permissionItem = [...controller.getSession().items.values()].find(
          (item) => item.kind === "permission_record",
        );
        if (permissionItem?.kind === "permission_record") {
          const allowOnce = permissionItem.options.find((option) => option.kind === "allow_once");
          if (allowOnce) controller.answerPermission(allowOnce.optionId);
        }
        await waitFor(controller, (session) => session.state === "idle" && session.stopReason !== null);
      } finally {
        await controller.detach();
      }
    } finally {
      capture.restore();
      writeSpy.mockRestore();
    }

    // The whole point: no matter what the SDK logged internally, none of it reached the real
    // process.stderr -- everything went through the captured console methods instead.
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
