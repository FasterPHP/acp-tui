// mvp-chrome-and-keys task 2.3: `permission-withdraw` and `permission-concurrent`, driven by a
// scripted client. The client is built with the SDK's `client()` API, whose request handlers see
// the request's abort signal (the legacy `Client` interface does not pass it on), which is how a
// client learns that the agent sent `$/cancel_request`.
import { describe, expect, test } from "bun:test";
import { RequestError, client, type RequestPermissionRequest, type SessionUpdate } from "@agentclientprotocol/sdk";
import { REQUEST_CANCELLED_CODE } from "../src/scenarios/permission-withdraw.ts";
import { makeTempDir, readLog, spawnFakeAgentStream } from "./helpers.ts";

interface Run {
  readonly stopReason: string;
  readonly updates: SessionUpdate[];
  /** The permission requests as they arrived, in order. */
  readonly requests: RequestPermissionRequest[];
  readonly log: { method: string; params: unknown }[];
}

/**
 * Runs one prompt against `scenario`. `answer` handles each permission request; it gets the
 * request and a promise that settles when the agent withdraws that request.
 */
async function run(
  scenario: string,
  answer: (request: RequestPermissionRequest, withdrawn: Promise<void>) => Promise<"allow-once" | "reject-once" | "withdrawn" | "cancelled">,
  options: { readonly args?: readonly string[] } = {},
): Promise<Run> {
  const logPath = `${makeTempDir()}/log.jsonl`;
  const handle = spawnFakeAgentStream({ scenario, logPath, ...(options.args ? { args: options.args } : {}) });
  const updates: SessionUpdate[] = [];
  const requests: RequestPermissionRequest[] = [];
  const app = client()
    .onNotification("session/update", (ctx) => {
      updates.push(ctx.params.update);
    })
    .onRequest("session/request_permission", async (ctx) => {
      requests.push(ctx.params);
      const withdrawn = new Promise<void>((resolve) => {
        if (ctx.signal.aborted) resolve();
        else ctx.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      const result = await answer(ctx.params, withdrawn);
      if (result === "withdrawn") throw RequestError.requestCancelled();
      if (result === "cancelled") return { outcome: { outcome: "cancelled" } };
      return { outcome: { outcome: "selected", optionId: result } };
    });
  try {
    const stopReason = await app.connectWith(handle.stream, async (cx) => {
      await cx.request("initialize", { protocolVersion: 1 });
      const session = await cx.request("session/new", { cwd: "/tmp", mcpServers: [] });
      const response = await cx.request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: "go" }] });
      return response.stopReason;
    });
    return { stopReason, updates, requests, log: readLog(logPath) };
  } finally {
    handle.stop();
  }
}

const methods = (log: Run["log"], method: string) => log.filter((entry) => entry.method === method).map((entry) => entry.params);
const messages = (updates: SessionUpdate[]) =>
  updates.flatMap((update) => (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" ? [update.content.text] : []));

describe("fake-agent permission-withdraw scenario (mvp-chrome-and-keys task 2.3)", () => {
  test("withdraws a lone request, then the second of two, and logs the -32800 answers", async () => {
    let releaseSecond!: () => void;
    const thirdWithdrawn = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const result = await run("permission-withdraw", async (request, withdrawn) => {
      const id = request.toolCall.toolCallId;
      if (id === "pw-2") {
        // The first of the two stays open until the second has been withdrawn.
        await thirdWithdrawn;
        return "allow-once";
      }
      await withdrawn;
      if (id === "pw-3") releaseSecond();
      return "withdrawn";
    });

    expect(result.stopReason).toBe("end_turn");
    expect(result.requests.map((request) => request.toolCall.toolCallId)).toEqual(["pw-1", "pw-2", "pw-3"]);

    // The agent received the request-cancelled error for the two withdrawn requests, and the
    // answer for the one that stayed open.
    expect(methods(result.log, "session/request_permission/error")).toEqual([
      { code: REQUEST_CANCELLED_CODE, message: expect.stringContaining("cancelled") },
      { code: REQUEST_CANCELLED_CODE, message: expect.stringContaining("cancelled") },
    ]);
    expect(methods(result.log, "session/request_permission/response")).toEqual([
      { outcome: { outcome: "selected", optionId: "allow-once" } },
    ]);
    // pw-2 and pw-3 settle independently, so only the first entry has a fixed place.
    const results = methods(result.log, "permission-withdraw/result");
    expect(results[0]).toEqual({ toolCallId: "pw-1", result: "withdrawn" });
    expect(results.slice(1)).toEqual(
      expect.arrayContaining([
        { toolCallId: "pw-3", result: "withdrawn" },
        { toolCallId: "pw-2", result: "selected", optionId: "allow-once" },
      ]),
    );
    expect(results).toHaveLength(3);

    // The turn tells what happened to each.
    expect(messages(result.updates).join("")).toBe("pw-1: withdrawn\npw-2: allow-once, pw-3: withdrawn\n");
    const statuses = result.updates.flatMap((update) =>
      update.sessionUpdate === "tool_call_update" ? [`${update.toolCallId}:${update.status}`] : [],
    );
    expect(statuses).toEqual(["pw-1:failed", "pw-2:completed", "pw-3:failed"]);
  });

  test("a request answered before the agent withdraws it is reported as answered", async () => {
    let releaseSecond!: () => void;
    const thirdWithdrawn = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const result = await run("permission-withdraw", async (request, withdrawn) => {
      const id = request.toolCall.toolCallId;
      if (id === "pw-1") return "reject-once";
      if (id === "pw-2") {
        await thirdWithdrawn;
        return "allow-once";
      }
      await withdrawn;
      releaseSecond();
      return "withdrawn";
    });
    expect(result.stopReason).toBe("end_turn");
    expect(methods(result.log, "permission-withdraw/result")[0]).toEqual({ toolCallId: "pw-1", result: "selected", optionId: "reject-once" });
  });

  test("interrupting the turn (cancelled answers) ends it cancelled", async () => {
    const result = await run("permission-withdraw", async () => "cancelled");
    expect(result.stopReason).toBe("cancelled");
    expect(methods(result.log, "permission-withdraw/result")[0]).toEqual({ toolCallId: "pw-1", result: "cancelled" });
  });
});

describe("fake-agent permission-concurrent scenario (mvp-chrome-and-keys task 2.3)", () => {
  test("sends both requests before either is answered, and each gets its own response", async () => {
    let openTogether = 0;
    let maxOpen = 0;
    const result = await run("permission-concurrent", async (request) => {
      openTogether += 1;
      maxOpen = Math.max(maxOpen, openTogether);
      // Answer the second request first, then the first, to show the answers are matched to requests.
      if (request.toolCall.toolCallId === "pc-1") await Bun.sleep(100);
      openTogether -= 1;
      return request.toolCall.toolCallId === "pc-1" ? "allow-once" : "reject-once";
    });

    expect(result.stopReason).toBe("end_turn");
    expect(maxOpen).toBe(2);
    expect(result.requests.map((request) => request.toolCall.toolCallId)).toEqual(["pc-1", "pc-2"]);
    // The responses arrive in the order the client sent them (the second request was answered
    // first) and each is tied to its tool call by the scenario's own entries.
    expect(methods(result.log, "session/request_permission/response")).toEqual([
      { outcome: { outcome: "selected", optionId: "reject-once" } },
      { outcome: { outcome: "selected", optionId: "allow-once" } },
    ]);
    expect(methods(result.log, "permission-concurrent/answer")).toEqual([
      { toolCallId: "pc-2", outcome: { outcome: "selected", optionId: "reject-once" } },
      { toolCallId: "pc-1", outcome: { outcome: "selected", optionId: "allow-once" } },
    ]);
    expect(messages(result.updates).join("")).toBe("Answers: pc-1: allow-once, pc-2: reject-once\n");
    const statuses = result.updates.flatMap((update) =>
      update.sessionUpdate === "tool_call_update" ? [`${update.toolCallId}:${update.status}`] : [],
    );
    expect(statuses).toEqual(["pc-1:completed", "pc-2:failed"]);
  });

  test("cancelled answers end the turn cancelled", async () => {
    const result = await run("permission-concurrent", async () => "cancelled");
    expect(result.stopReason).toBe("cancelled");
    expect(methods(result.log, "permission-concurrent/answer")).toHaveLength(2);
  });
});
