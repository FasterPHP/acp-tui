// Phase-1a task 1.7: @agentclientprotocol/sdk 1.5.0 exposes elicitation on
// both sides, so the scenario sends a three-question form and then a URL
// request through the SDK's own AgentSideConnection.createElicitation.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type {
  CompleteElicitationNotification,
  CreateElicitationRequest,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import { ELICITATION_URL, ELICITATION_URL_ID } from "../src/scenarios/elicitation.ts";
import { spawnFakeAgent } from "./helpers.ts";

describe("fake-agent elicitation scenario (phase-1a task 1.7)", () => {
  test("asks a three-question form, then a URL request, and completes the URL one", async () => {
    const requests: CreateElicitationRequest[] = [];
    const completed: CompleteElicitationNotification[] = [];
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "elicitation",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("elicitation does not request permission");
        },
        async createElicitation(params) {
          requests.push(params);
          return params.mode === "form"
            ? { action: "accept", content: { strategy: "copy", checks: ["tests", "types"], notes: "be careful" } }
            : { action: "accept" };
        },
        async completeElicitation(params) {
          completed.push(params);
        },
      },
    });
    try {
      await handle.conn.initialize({
        protocolVersion: 1,
        clientCapabilities: { elicitation: { form: {}, url: {} } },
      });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "ask me things" }],
      });
      expect(result.stopReason).toBe("end_turn");

      expect(requests.map((r) => r.mode)).toEqual(["form", "url"]);
      const form = requests[0] as Extract<CreateElicitationRequest, { mode: "form" }>;
      expect(Object.keys(form.requestedSchema.properties ?? {})).toEqual(["strategy", "checks", "notes"]);
      expect(form.requestedSchema.required).toEqual(["strategy"]);
      const url = requests[1] as Extract<CreateElicitationRequest, { mode: "url" }>;
      expect(url).toMatchObject({ elicitationId: ELICITATION_URL_ID, url: ELICITATION_URL });

      // elicitation/complete is a notification: the client may still be dispatching it when the
      // prompt response resolves, so wait for it rather than asserting at once.
      for (let waited = 0; completed.length === 0 && waited < 2000; waited += 10) await Bun.sleep(10);
      expect(completed).toEqual([{ elicitationId: ELICITATION_URL_ID }]);

      const text = updates
        .flatMap((u) => (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text" ? [u.content.text] : []))
        .join("");
      expect(text).toContain('"strategy":"copy"');
      expect(text).toContain("URL: accepted");
    } finally {
      handle.stop();
    }
  });

  test("a declined form is reported and the URL request still follows", async () => {
    const modes: string[] = [];
    const handle = spawnFakeAgent({
      scenario: "elicitation",
      client: {
        async sessionUpdate() {},
        async requestPermission() {
          throw new Error("elicitation does not request permission");
        },
        async createElicitation(params) {
          modes.push(params.mode);
          return { action: "decline" };
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "ask me things" }],
      });
      expect(result.stopReason).toBe("end_turn");
      expect(modes).toEqual(["form", "url"]);
    } finally {
      handle.stop();
    }
  });

  test("a client without elicitation gets a message, not a crash", async () => {
    const updates: SessionUpdate[] = [];
    const handle = spawnFakeAgent({
      scenario: "elicitation",
      client: {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
        async requestPermission() {
          throw new Error("elicitation does not request permission");
        },
      },
    });
    try {
      await handle.conn.initialize({ protocolVersion: 1 });
      const session = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
      const result = await handle.conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "ask me things" }],
      });
      expect(result.stopReason).toBe("end_turn");
      const text = updates
        .flatMap((u) => (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text" ? [u.content.text] : []))
        .join("");
      expect(text).toContain("Elicitation failed");
    } finally {
      handle.stop();
    }
  });
});
