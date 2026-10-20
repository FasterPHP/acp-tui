// day-two-feedback task 1.1: `--start-delay` holds back the answer to `initialize` and `--list-delay`
// the answer to `session/list`, by absolute times that `--delay-scale 0` (the test default) does not shrink.
//
// The timing tests of this file are in delays.timing.test.ts (parallel-tests: they run in the serial pass).
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { recordingClient, spawnFakeAgent } from "./helpers.ts";
import { SLACK_MS, timed } from "./delays-helpers.ts";

describe("fake-agent delays", () => {
  test("initialize answers no sooner than --start-delay", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--start-delay", "400"], client });
    try {
      const { value, ms } = await timed(() => handle.conn.initialize({ protocolVersion: 1 }));
      expect(value.protocolVersion).toBe(1);
      expect(ms).toBeGreaterThanOrEqual(400 - SLACK_MS);
    } finally {
      handle.stop();
    }
  });

  test("session/list answers no sooner than --list-delay, and initialize is not held back by it", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--list", "--list-delay", "400"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const list = await timed(() => handle.conn.listSessions({ cwd: tmpdir() }));
      expect(list.value.sessions).toEqual([]);
      expect(list.ms).toBeGreaterThanOrEqual(400 - SLACK_MS);
    } finally {
      handle.stop();
    }
  });
});
