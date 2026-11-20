// auggie-1x-support task 10.1 (design D16; spec tui-agent-session "Auggie's indexing line becomes a
// question" and "Other indexing lines from Auggie"): the whole-text match of Auggie 1.x's indexing
// lines, and the client handler's interception, which takes them out before the model only for a
// harness whose profile has the patterns.
import { describe, expect, test } from "bun:test";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { ModelEvent } from "acp-model";
import { createClientHandler } from "../../src/agent/client-handler.ts";
import { profileFor } from "../../src/agent/harness-profiles.ts";
import { indexingIntercept, matchIndexingLine, type IndexingLine } from "../../src/agent/indexing.ts";

const DISABLED = 'Indexing disabled for current workspace "/work/app".\n';
const LIMITED = 'Indexing limited for "/work/app": file limit reached. Use a smaller workspace or exclude files with .augmentignore.\n';
const HOME = 'Indexing disabled for "/home/user": home directory or parent directory. Start auggie in a project directory.';

describe("matchIndexingLine", () => {
  test("each pattern, with or without the line end", () => {
    expect(matchIndexingLine(DISABLED)).toEqual({ kind: "disabled", directory: "/work/app" });
    expect(matchIndexingLine(DISABLED.trimEnd())).toEqual({ kind: "disabled", directory: "/work/app" });
    expect(matchIndexingLine(LIMITED)).toEqual({ kind: "limited", directory: "/work/app", text: LIMITED.trimEnd() });
    expect(matchIndexingLine(HOME)).toEqual({ kind: "home", directory: "/home/user", text: HOME });
  });

  test("near misses are not indexing lines", () => {
    for (const text of [
      'Indexing disabled for current workspace "/work/app"',
      ' Indexing disabled for current workspace "/work/app".',
      'Note: Indexing disabled for current workspace "/work/app".',
      'Indexing disabled for current workspace "/work/app".\nand more',
      'Indexing disabled for current workspace "/work/app".\n\n',
      'indexing disabled for current workspace "/work/app".',
      'Indexing disabled for "/work/app": something else.',
      "Indexing limited for /work/app: file limit reached.",
      "",
    ]) {
      expect(matchIndexingLine(text)).toBeNull();
    }
  });
});

describe("the client handler's interception", () => {
  const chunk = (text: string): SessionNotification => ({ sessionId: "s-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
  function setup(agentInfo: { name: string; version: string } | null) {
    const events: ModelEvent[] = [];
    const taken: IndexingLine[] = [];
    const intercept = indexingIntercept(profileFor(agentInfo), { take: (line) => (taken.push(line), true) });
    const handler = createClientHandler({ dispatch: (event) => events.push(event), now: () => 1, ...(intercept ? { intercept } : {}) });
    return { handler, events, taken };
  }

  test("auggie 1.x: each pattern is taken and never dispatched; other text passes", async () => {
    const { handler, events, taken } = setup({ name: "auggie", version: "1.2.2" });
    for (const text of [DISABLED, LIMITED, HOME]) await handler.client.sessionUpdate(chunk(text));
    expect(events).toEqual([]);
    expect(taken.map((l) => l.kind)).toEqual(["disabled", "limited", "home"]);
    await handler.client.sessionUpdate(chunk(`Before. ${DISABLED}`));
    expect(events).toHaveLength(1);
  });

  test("a chunk during a turn is taken too (the card waits for the turn to end)", async () => {
    const { handler, events, taken } = setup({ name: "auggie", version: "1.3.0-prerelease.202611181212" });
    await handler.client.sessionUpdate(chunk("Working on it."));
    await handler.client.sessionUpdate({ sessionId: "s-1", update: { sessionUpdate: "tool_call", toolCallId: "call_1", title: "bash", status: "in_progress" } });
    await handler.client.sessionUpdate(chunk(DISABLED));
    expect(events.map((e) => (e.type === "session_update" ? e.update.sessionUpdate : e.type))).toEqual(["agent_message_chunk", "tool_call"]);
    expect(taken).toHaveLength(1);
  });

  test("another harness, Auggie 0.x and a harness without a version: the identical text is agent text", async () => {
    for (const info of [{ name: "other", version: "1.2.2" }, { name: "auggie", version: "0.36.0 (commit 7c61e5bb)" }, { name: "auggie", version: "" }, null]) {
      const { handler, events, taken } = setup(info);
      await handler.client.sessionUpdate(chunk(DISABLED));
      expect(events).toHaveLength(1);
      expect(taken).toEqual([]);
    }
  });

  test("a sink that declines the line leaves it as agent text", async () => {
    const events: ModelEvent[] = [];
    const intercept = indexingIntercept(profileFor({ name: "auggie", version: "1.2.2" }), { take: () => false })!;
    const handler = createClientHandler({ dispatch: (event) => events.push(event), now: () => 1, intercept });
    await handler.client.sessionUpdate(chunk(DISABLED));
    expect(events).toHaveLength(1);
  });
});
