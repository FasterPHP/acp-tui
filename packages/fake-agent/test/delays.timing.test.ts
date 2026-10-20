// parallel-tests task 5.1: the delay test with an upper bound (without --list-delay, session/list answers in under 300 ms), which runs in the serial pass; the tests with only a lower bound (an answer no sooner than the delay) stay in delays.test.ts.
// What the file covers is in the header of delays.test.ts; its helpers are in delays-helpers.ts.
import { describe, expect, test } from "bun:test";
import { recordingClient, spawnFakeAgent } from "./helpers.ts";
import { timed } from "./delays-helpers.ts";

describe("fake-agent delays", () => {
  test("without the options nothing waits", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "basic", args: ["--list"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const list = await timed(() => handle.conn.listSessions({ cwd: "/tmp" }));
      expect(list.ms).toBeLessThan(300);
    } finally {
      handle.stop();
    }
  });
});
