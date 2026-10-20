// Phase-1a task 1.4: the hostile scenario puts the whole sanitiser corpus in
// every agent-supplied field, and acp-model (reducer plus sanitiser) stores
// none of it.
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { createSession, reduce, sanitise, type Item, type Session } from "acp-model";
import type {
  InitializeResponse,
  NewSessionResponse,
  RequestPermissionRequest,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import { CARD_IMITATION_TEXT, FENCED_CARD_IMITATION_TEXT, HOSTILE_FIELD_LABELS, HOSTILE_PAYLOADS, type HostileFieldLabel } from "../src/hostile.ts";
import { spawnFakeAgent } from "./helpers.ts";

// C0 controls other than tab and newline, DEL and the C1 range.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

interface Capture {
  readonly raw: Record<HostileFieldLabel, string>;
  readonly stored: Record<HostileFieldLabel, string>;
  readonly session: Session;
}

function textOf(update: SessionUpdate): string {
  if (
    (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk") &&
    update.content.type === "text"
  ) {
    return update.content.text;
  }
  return "";
}

async function runHostile(): Promise<Capture> {
  const updates: SessionUpdate[] = [];
  const requests: RequestPermissionRequest[] = [];
  const handle = spawnFakeAgent({
    scenario: "hostile",
    client: {
      async sessionUpdate(params) {
        updates.push(params.update);
      },
      async requestPermission(params) {
        requests.push(params);
        return { outcome: { outcome: "selected", optionId: "allow-once" } };
      },
    },
  });
  try {
    const init: InitializeResponse = await handle.conn.initialize({ protocolVersion: 1 });
    const created: NewSessionResponse = await handle.conn.newSession({ cwd: tmpdir(), mcpServers: [] });
    await handle.conn.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "go" }] });

    const request = requests[0] as RequestPermissionRequest;
    const config = created.configOptions?.[0];
    if (config?.type !== "select") throw new Error("hostile sends a select config option");
    const firstValue = (config.options as { value: string; name: string }[])[0]!;
    const toolCall = updates.find((u) => u.sessionUpdate === "tool_call");
    const toolDone = updates.find((u) => u.sessionUpdate === "tool_call_update");
    const plan = updates.find((u) => u.sessionUpdate === "plan");
    if (toolCall?.sessionUpdate !== "tool_call" || toolDone?.sessionUpdate !== "tool_call_update" || plan?.sessionUpdate !== "plan") {
      throw new Error("missing updates");
    }
    const toolOutput = toolDone.content?.[0];

    const raw: Record<HostileFieldLabel, string> = {
      "agentInfo.name": init.agentInfo?.name ?? "",
      message: textOf(updates.find((u) => u.sessionUpdate === "agent_message_chunk") as SessionUpdate),
      thought: textOf(updates.find((u) => u.sessionUpdate === "agent_thought_chunk") as SessionUpdate),
      "tool.title": toolCall.title,
      "tool.output": toolOutput?.type === "content" && toolOutput.content.type === "text" ? toolOutput.content.text : "",
      plan: plan.entries[0]?.content ?? "",
      "config.name": config.name,
      "config.value": firstValue.value,
      "permission.option": request.options[0]?.name ?? "",
    };

    let model: Session = createSession();
    let at = 0;
    model = reduce(model, { type: "session_created", response: created, cwd: tmpdir(), agentInfo: init.agentInfo ?? null, at: at++ });
    model = reduce(model, { type: "prompt_sent", text: "go", at: at++ });
    for (const update of updates) {
      if (update.sessionUpdate === "tool_call_update") {
        model = reduce(model, { type: "permission_opened", toolCallId: request.toolCall.toolCallId, request, at: at++ });
        model = reduce(model, { type: "permission_answered", toolCallId: request.toolCall.toolCallId, optionId: "allow-once", optionKind: "allow_once", at: at++ });
      }
      model = reduce(model, { type: "session_update", update, at: at++ });
    }
    model = reduce(model, { type: "prompt_response", stopReason: "end_turn", at: at++ });

    const items = model.order.map((id) => model.items.get(id) as Item);
    const first = <K extends Item["kind"]>(kind: K) => items.find((item) => item.kind === kind) as Extract<Item, { kind: K }>;
    const tool = first("tool_call");
    const configOption = model.configOptions[0];
    if (configOption?.type !== "select") throw new Error("config option lost");
    const storedFirst = (configOption.options as { value: string; name: string }[])[0]!;

    const stored: Record<HostileFieldLabel, string> = {
      "agentInfo.name": model.agent?.name ?? "",
      message: first("agent_message").text,
      thought: first("thought").text,
      "tool.title": tool.title,
      "tool.output": tool.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"),
      plan: model.plan[0]?.content ?? "",
      "config.name": configOption.name,
      "config.value": storedFirst.value,
      "permission.option": first("permission_record").options[0]?.name ?? "",
    };
    return { raw, stored, session: model };
  } finally {
    handle.stop();
  }
}

describe("fake-agent hostile scenario (phase-1a task 1.4)", () => {
  test("every agent-supplied field carries every payload, and acp-model stores none of them", async () => {
    const { raw, stored } = await runHostile();

    for (const label of HOSTILE_FIELD_LABELS) {
      // On the wire: the label, and every payload's exact bytes.
      expect(raw[label], label).toContain(label);
      for (const payload of HOSTILE_PAYLOADS) {
        expect(raw[label], `${label} carries ${payload.name}`).toContain(payload.text);
      }
      expect(raw[label]).toMatch(/\u001b/);

      // In the model: no control character, no escape sequence residue, the readable text intact.
      const value = stored[label];
      expect(value, label).toContain(label);
      expect(value, `${label} keeps a control character`).not.toMatch(CONTROL);
      for (const payload of HOSTILE_PAYLOADS) {
        const remaining = payload.strippedBy === "default" ? value : sanitise(value, "approval");
        expect(remaining, `${label} keeps ${payload.name} residue`).not.toContain(payload.residue);
        // The visible tag after each payload survives, so nothing swallowed its neighbours.
        expect(value, `${label} lost the ${payload.name} tag`).toContain(`<${payload.name}>`);
      }
      // Bidi and zero-width characters are removed by the approval sanitiser (permission
      // titles, commands, paths); ordinary text keeps them, as the model spec says.
      expect(sanitise(value, "approval")).not.toMatch(/[​-‏‪-‮⁠⁦-⁩﻿]/);
    }
  });

  test("the model's own strings are clean too: session metadata, items and the permission record", async () => {
    const { session } = await runHostile();
    const strings: string[] = [session.agent?.name ?? "", session.agent?.title ?? "", ...session.plan.map((e) => e.content)];
    for (const option of session.configOptions) {
      strings.push(option.name);
      if (option.type === "select") {
        strings.push(option.currentValue, ...(option.options as { value: string; name: string }[]).flatMap((o) => [o.value, o.name]));
      }
    }
    for (const id of session.order) {
      const item = session.items.get(id) as Item;
      if (item.kind === "permission_record") strings.push(item.title, ...item.options.map((o) => o.name));
      if (item.kind === "tool_call") strings.push(item.title);
    }
    expect(strings.length).toBeGreaterThan(10);
    for (const value of strings) {
      expect(value).not.toMatch(CONTROL);
    }
  });

  test("the message carries a plain-text imitation of the permission card, before the real request", async () => {
    const lines = CARD_IMITATION_TEXT.trimEnd().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toStartWith("╭─ ◊ Permission  execute  #1 ");
    expect(lines[0]).toEndWith("╮");
    expect(lines[1]).toStartWith("│ ");
    expect(lines[2]).toContain("1 allow once   2 allow always   3 reject once");
    expect(lines[3]).toStartWith("╰");
    expect(lines[3]).toEndWith("╯");
    // Plain text, one width, nothing a terminal would act on.
    expect(new Set(lines.map((line) => [...line].length)).size).toBe(1);
    expect(CARD_IMITATION_TEXT).not.toMatch(CONTROL);
    expect(CARD_IMITATION_TEXT).not.toContain("\u001b");

    const { raw } = await runHostile();
    expect(raw.message).toContain(CARD_IMITATION_TEXT);
    expect(raw.message.indexOf("Permission: execute rm -rf /")).toBeLessThan(raw.message.indexOf(lines[0]!));
  });

  test("the message also carries the card inside a code fence, after the plain imitation (mvp-rendering task 1.5)", async () => {
    const lines = FENCED_CARD_IMITATION_TEXT.split("\n");
    // One line of prose, a blank line, the fence, the four card rows, the closing fence.
    expect(lines.slice(0, 3)).toEqual(["The same card in a code block:", "", "```"]);
    expect(lines.slice(3, 7).join("\n") + "\n").toBe(CARD_IMITATION_TEXT);
    expect(lines[7]).toBe("```");
    // The card's own marker glyph and rounded frame are inside the fence, and the fence closes
    // only at its end: no card line can end it early.
    const fenced = lines.slice(3, 7);
    expect(fenced[0]).toStartWith("╭─ ◊ Permission  execute  #1 ");
    expect(fenced.some((line) => line.includes("```"))).toBe(false);
    expect(lines.filter((line) => line.startsWith("```"))).toHaveLength(2);
    expect(FENCED_CARD_IMITATION_TEXT).not.toContain("\u001b");
    expect(FENCED_CARD_IMITATION_TEXT).not.toMatch(CONTROL);

    const { raw, stored } = await runHostile();
    expect(raw.message).toContain(FENCED_CARD_IMITATION_TEXT);
    expect(raw.message.indexOf(FENCED_CARD_IMITATION_TEXT)).toBeGreaterThan(raw.message.indexOf(CARD_IMITATION_TEXT));
    // The model keeps it intact: nothing in it is stripped by the sanitiser.
    expect(stored.message).toContain(FENCED_CARD_IMITATION_TEXT);
  });
});
