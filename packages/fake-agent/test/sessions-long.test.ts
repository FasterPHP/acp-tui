// mvp-sessions task 2.3: `long-session --items N` is loadable. With --load,
// session/load of the session `long-session` replays exactly the history the
// scenario's first prompt sends (8303 updates at 5000 items), and a prompt
// after the load gets the short reply, never the history again.
import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { LONG_SESSION_SESSION_ID, LONG_SESSION_UPDATED_AT } from "../src/index.ts";
import { recordingClient, rejectionOf, spawnFakeAgent } from "./helpers.ts";

/** The updates the first prompt of a fresh long-session sends. */
async function firstPromptUpdates(items: number): Promise<SessionUpdate[]> {
  const { client, updates } = recordingClient();
  const handle = spawnFakeAgent({ scenario: "long-session", items, client });
  try {
    await handle.conn.initialize({ protocolVersion: 1 });
    const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
    await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "replay everything" }] });
    return updates;
  } finally {
    handle.stop();
  }
}

describe("long-session through session/load (mvp-sessions task 2.3)", () => {
  test("the session ID is 'long-session'", () => {
    expect(LONG_SESSION_SESSION_ID).toBe("long-session");
  });

  test("loading it replays 8303 updates at 5000 items, as the first prompt sends today", async () => {
    const { client, updates } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "long-session", items: 5000, args: ["--load"], client });
    try {
      const init = await handle.conn.initialize({ protocolVersion: 1 });
      expect(init.agentCapabilities?.loadSession).toBe(true);
      const response = await handle.conn.loadSession({ sessionId: LONG_SESSION_SESSION_ID, cwd: "/tmp", mcpServers: [] });
      expect(response).toEqual({});
      expect(updates).toHaveLength(8303);
      expect(updates.filter((update) => update.sessionUpdate === "plan")).toHaveLength(200);
    } finally {
      handle.stop();
    }
    // The count is the same as the first prompt's (and the content too, checked at a smaller size below).
    expect((await firstPromptUpdates(5000)).length).toBe(8303);
  }, 120000);

  test("the replay is identical to the first prompt's updates, in order", async () => {
    const expected = await firstPromptUpdates(300);
    const { client, updates } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "long-session", items: 300, args: ["--load"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await handle.conn.loadSession({ sessionId: LONG_SESSION_SESSION_ID, cwd: "/tmp", mcpServers: [] });
      expect(updates).toEqual(expected);
    } finally {
      handle.stop();
    }
  }, 60000);

  test("after the load, a prompt gets the short reply and the history is not repeated", async () => {
    const { client, updates } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "long-session", items: 100, args: ["--load"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await handle.conn.loadSession({ sessionId: LONG_SESSION_SESSION_ID, cwd: "/tmp", mcpServers: [] });
      updates.length = 0;
      const result = await handle.conn.prompt({
        sessionId: LONG_SESSION_SESSION_ID,
        prompt: [{ type: "text", text: "and now?" }],
      });
      expect(result.stopReason).toBe("end_turn");
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ sessionUpdate: "agent_message_chunk", messageId: "long-reply-2" });
    } finally {
      handle.stop();
    }
  }, 60000);

  test("it is listed with --list, under the agent's working directory, with a fixed time", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "long-session", items: 40, args: ["--list", "--load"], cwd: "/tmp", client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const { sessions } = await handle.conn.listSessions({ cwd: "/tmp" });
      expect(sessions).toEqual([
        {
          sessionId: LONG_SESSION_SESSION_ID,
          cwd: "/tmp",
          title: "Long session (40 items)",
          updatedAt: LONG_SESSION_UPDATED_AT,
        },
      ]);
      // Another directory does not list it.
      expect((await handle.conn.listSessions({ cwd: "/elsewhere" })).sessions).toEqual([]);
    } finally {
      handle.stop();
    }
  });

  test("without --load there is no load: the scenario behaves as before", async () => {
    const { client } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "long-session", items: 10, client });
    try {
      const init = await handle.conn.initialize({ protocolVersion: 1 });
      expect(init.agentCapabilities?.loadSession).toBe(false);
      expect(await rejectionOf(
        handle.conn.loadSession({ sessionId: LONG_SESSION_SESSION_ID, cwd: "/tmp", mcpServers: [] }),
      )).toMatchObject({ code: -32601 });
    } finally {
      handle.stop();
    }
  });
});

// mvp-conversation task 1.2: `--history` sends the whole history to a new session before any prompt
// is answered, so the budget and open-at-end checks need no turn.
describe("long-session --history (mvp-conversation task 1.2)", () => {
  /** Waits until `updates` holds `count` entries, or fails after `ms`. */
  async function until(updates: readonly SessionUpdate[], count: number, ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (updates.length < count && Date.now() < deadline) await Bun.sleep(10);
  }

  test("5000 items: a new session is sent 8303 updates with no prompt, identical to the first prompt's", async () => {
    const { client, updates } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "long-session", items: 5000, args: ["--history"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      await until(updates, 8303, 60000);
      await Bun.sleep(100);
      expect(updates).toHaveLength(8303);
      expect(updates.filter((update) => update.sessionUpdate === "plan")).toHaveLength(200);
      expect(updates.filter((update) => update.sessionUpdate === "user_message_chunk").length).toBeGreaterThan(100);
    } finally {
      handle.stop();
    }
  }, 120000);

  test("the history equals the first prompt's updates, and the first prompt then gets the short reply", async () => {
    const expected = await firstPromptUpdates(300);
    const { client, updates } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "long-session", items: 300, args: ["--history"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      // The prompt is answered only after the whole history has gone out.
      const result = await handle.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "and now?" }] });
      expect(result.stopReason).toBe("end_turn");
      expect(updates.slice(0, expected.length)).toEqual(expected);
      expect(updates).toHaveLength(expected.length + 1);
      expect(updates.at(-1)).toMatchObject({ sessionUpdate: "agent_message_chunk", messageId: "long-reply-2" });
    } finally {
      handle.stop();
    }
  }, 60000);

  test("every new session gets its own copy, and session/load of one replays it again", async () => {
    const { client, updates } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "long-session", items: 50, args: ["--history", "--load"], client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const first = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      await handle.conn.prompt({ sessionId: first.sessionId, prompt: [{ type: "text", text: "wait" }] });
      const history = updates.length - 1;
      expect(history).toBeGreaterThan(50);
      const second = await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      await handle.conn.prompt({ sessionId: second.sessionId, prompt: [{ type: "text", text: "wait" }] });
      expect(updates).toHaveLength(2 * (history + 1));
      updates.length = 0;
      await handle.conn.loadSession({ sessionId: first.sessionId, cwd: "/tmp", mcpServers: [] });
      expect(updates).toHaveLength(history);
    } finally {
      handle.stop();
    }
  }, 60000);

  test("without --history a new session is sent nothing until it is prompted", async () => {
    const { client, updates } = recordingClient();
    const handle = spawnFakeAgent({ scenario: "long-session", items: 50, client });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      await handle.conn.newSession({ cwd: "/tmp", mcpServers: [] });
      await Bun.sleep(200);
      expect(updates).toHaveLength(0);
    } finally {
      handle.stop();
    }
  });
});
