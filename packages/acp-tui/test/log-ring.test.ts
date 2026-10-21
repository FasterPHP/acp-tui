// The in-memory ring behind the crash report: the last 200 events, with or without ACP_TUI_LOG.
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearRecentEvents, createDebugLogger, RING_SIZE, recentEvents } from "../src/log.ts";

beforeEach(clearRecentEvents);

describe("debug log ring", () => {
  test("keeps events in order without a path, and writes nothing", () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-ring-"));
    const log = createDebugLogger(undefined);
    log.log({ event: "a", n: 1 });
    log.log({ event: "b" });
    expect(recentEvents().map((e) => e["event"])).toEqual(["a", "b"]);
    expect(recentEvents()[0]).toMatchObject({ n: 1 });
    expect(typeof recentEvents()[0]!["ts"]).toBe("string");
    expect(existsSync(join(dir, "x"))).toBe(false);
  });

  test("is bounded to the last 200 events", () => {
    const log = createDebugLogger(undefined);
    for (let i = 0; i < RING_SIZE + 25; i += 1) log.log({ event: "e", i });
    const events = recentEvents();
    expect(RING_SIZE).toBe(200);
    expect(events).toHaveLength(200);
    expect(events[0]).toMatchObject({ i: 25 });
    expect(events.at(-1)).toMatchObject({ i: 224 });
  });

  test("with a path the same events go to the file too", () => {
    const path = join(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-ring-")), "log.jsonl");
    createDebugLogger(path).log({ event: "x" });
    expect(recentEvents().map((e) => e["event"])).toEqual(["x"]);
    expect(readFileSync(path, "utf8")).toContain('"event":"x"');
  });
});
