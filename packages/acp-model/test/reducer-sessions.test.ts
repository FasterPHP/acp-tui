// Spec model-session (mvp-sessions): "Sessions opened by load or resume", "Replayed history is
// marked and final" and "Session title and activity time".

import { describe, expect, test } from "bun:test";
import type {
  LoadSessionResponse,
  ResumeSessionResponse,
  SessionConfigOption,
  SessionModeState,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import { reduce } from "../src/reducer.ts";
import { createSession } from "../src/types.ts";
import type { Item, ModelDebugInfo, ModelEvent, Session } from "../src/types.ts";

const ESC = "\x1b";
const BEL = "\x07";

const items = (session: Session): Item[] => session.order.map((id) => session.items.get(id)!);

function apply(session: Session, ...events: ModelEvent[]): Session {
  return events.reduce((acc, event) => reduce(acc, event), session);
}

let clock = 0;
const update = (u: SessionUpdate): ModelEvent => ({ type: "session_update", update: u, at: ++clock });
const text = (value: string) => ({ type: "text" as const, text: value });
const user = (value: string, messageId?: string): ModelEvent =>
  update({ sessionUpdate: "user_message_chunk", content: text(value), ...(messageId ? { messageId } : {}) });
const agent = (value: string, messageId?: string): ModelEvent =>
  update({ sessionUpdate: "agent_message_chunk", content: text(value), ...(messageId ? { messageId } : {}) });
const tool = (toolCallId: string, status: "pending" | "in_progress" | "completed" = "completed"): ModelEvent =>
  update({ sessionUpdate: "tool_call", toolCallId, title: `Tool ${toolCallId}`, status });

const opening = (mode: "load" | "resume", sessionId = "s-1", cwd = "/work/repo-b"): ModelEvent => ({
  type: "session_opening",
  mode,
  sessionId,
  cwd,
  agentInfo: { name: "fake-agent", version: "1" },
  at: ++clock,
});
const opened = (response: LoadSessionResponse | ResumeSessionResponse = {}): ModelEvent => ({
  type: "session_opened",
  response,
  at: ++clock,
});

const modelOption: SessionConfigOption = {
  id: "model",
  type: "select",
  category: "model",
  name: "Model",
  currentValue: "sonnet",
  options: [
    { value: "opus", name: "Opus" },
    { value: "sonnet", name: "Sonnet" },
  ],
};
const effortOption: SessionConfigOption = {
  id: "effort",
  type: "select",
  category: "thought_level",
  name: "Effort",
  currentValue: "high",
  options: [{ value: "high", name: "High" }],
};
const modes: SessionModeState = {
  currentModeId: "default",
  availableModes: [
    { id: "default", name: "Default" },
    { id: "plan", name: "Plan" },
  ],
};

describe("sessions opened by load or resume", () => {
  test("Load response recorded: id, cwd, config options and modes", () => {
    let session = reduce(createSession(), opening("load", "s-1", "/work/repo-b"));
    expect(session.id).toBe("s-1");
    expect(session.cwd).toBe("/work/repo-b");
    expect(session.agent?.name).toBe("fake-agent");
    session = reduce(session, opened({ configOptions: [modelOption, effortOption], modes }));
    expect(session.id).toBe("s-1");
    expect(session.cwd).toBe("/work/repo-b");
    expect(session.configOptions.map((option) => option.id)).toEqual(["model", "effort"]);
    expect(session.modes?.currentModeId).toBe("default");
    expect(session.replaying).toBe(false);
    expect(session.opening).toBeNull();
    expect(items(session)).toHaveLength(0);
  });

  test("a response without options keeps what is there and sanitises what it carries", () => {
    const hostile: SessionConfigOption = { ...modelOption, name: `Mod${ESC}]0;x${BEL}el` };
    const session = apply(createSession(), opening("load"), opened({ configOptions: [hostile] }));
    expect(session.configOptions[0]?.name).toBe("Model");
    expect(session.modes).toBeNull();
  });

  test("Resume marker: the first item says the history is not available", () => {
    const session = apply(createSession(), opening("resume", "s-2"), opened({ modes }));
    expect(session.id).toBe("s-2");
    const first = items(session)[0];
    expect(first?.kind).toBe("marker");
    if (first?.kind !== "marker" || first.markerKind !== "notice") throw new Error("expected a notice marker");
    expect(first.text).toContain("history is not available from this agent");
    expect(first.status).toBe("final");
    expect(session.modes?.currentModeId).toBe("default");
    expect(items(session)).toHaveLength(1);
  });

  test("Load response with a legacy model state", () => {
    const models = {
      currentModelId: "sonnet",
      availableModels: [
        { modelId: "opus", name: "Opus" },
        { modelId: "sonnet", name: "Sonnet", description: "Balanced" },
        { modelId: "haiku", name: "Haiku" },
      ],
    };
    const session = apply(createSession(), opening("load", "s-3"), opened({ modes, models } as LoadSessionResponse));
    expect(session.modes?.currentModeId).toBe("default");
    expect(session.models?.currentModelId).toBe("sonnet");
    expect(session.models?.availableModels.map((model) => model.modelId)).toEqual(["opus", "sonnet", "haiku"]);
    expect(session.models?.availableModels[1]?.description).toBe("Balanced");
    expect(session.configOptions).toEqual([]);
  });

  test("a resume response carries models too", () => {
    const models = { currentModelId: "a", availableModels: [{ modelId: "a", name: "A" }] };
    const session = apply(createSession(), opening("resume", "s-4"), opened({ models } as ResumeSessionResponse));
    expect(session.models?.currentModelId).toBe("a");
  });

  test("an absent or null models field keeps the previous legacy model state on open", () => {
    const models = { currentModelId: "a", availableModels: [{ modelId: "a", name: "A" }] };
    const first = apply(createSession(), opening("load"), opened({ models } as LoadSessionResponse));
    const absent = apply(first, opening("load"), opened({}));
    expect(absent.models).toBe(first.models);
    const nulled = apply(first, opening("load"), opened({ models: null } as LoadSessionResponse));
    expect(nulled.models).toBe(first.models);
  });

  test("a malformed models field on open is ignored and reported", () => {
    const seen: ModelDebugInfo[] = [];
    const session = reduce(reduce(createSession(), opening("load")), opened({ models: { currentModelId: 1 } } as unknown as LoadSessionResponse), (info) => seen.push(info));
    expect(session.models).toBeNull();
    expect(seen).toEqual([{ kind: "invalid_models" }]);
  });

  test("a load adds no marker", () => {
    const session = apply(createSession(), opening("load"), opened());
    expect(items(session)).toHaveLength(0);
  });

  test("resume is not a replay: the flag stays off between the two events", () => {
    const session = apply(createSession(), opening("resume"));
    expect(session.opening).toBe("resume");
    expect(session.replaying).toBe(false);
  });
});

describe("replayed history is marked and final", () => {
  test("Replay origin: user, agent and tool call, each replay and final, state idle", () => {
    let session = apply(createSession(), opening("load"), user("hello", "u1"), agent("hi there", "a1"), tool("t1", "in_progress"));
    expect(session.replaying).toBe(true);
    expect(session.state).toBe("idle");
    expect(session.turn).toBeNull();
    session = reduce(session, opened());

    expect(items(session).map((item) => item.kind)).toEqual(["user_message", "agent_message", "tool_call"]);
    for (const item of items(session)) {
      expect(item.origin).toBe("replay");
      expect(item.status).toBe("final");
    }
    expect(session.state).toBe("idle");
    expect(session.turn).toBeNull();
    expect(session.replaying).toBe(false);
  });

  test("replayed user chunks become user items in order, and chunks accumulate", () => {
    const session = apply(createSession(), opening("load"), user("first ", "u1"), user("part", "u1"), agent("ok", "a1"), user("second", "u2"), opened());
    const kinds = items(session).map((item) => [item.kind, "text" in item ? item.text : null]);
    expect(kinds).toEqual([
      ["user_message", "first part"],
      ["agent_message", "ok"],
      ["user_message", "second"],
    ]);
  });

  test("a text run is finalised as soon as a different item starts, before the load ends", () => {
    const session = apply(createSession(), opening("load"), agent("thinking aloud"), tool("t1"), agent("done"));
    const [first, , last] = items(session);
    expect(first?.status).toBe("final");
    expect(last?.status).toBe("live");
  });

  test("a live tool call is final once the load ends", () => {
    const during = apply(createSession(), opening("load"), tool("t1", "in_progress"));
    expect(items(during)[0]?.status).toBe("live");
    const after = reduce(during, opened());
    const item = items(after)[0];
    expect(item?.status).toBe("final");
    expect(item?.kind === "tool_call" && item.toolStatus).toBe("in_progress");
  });

  test("tool indexes follow first sighting, updates keep theirs", () => {
    const session = apply(
      createSession(),
      opening("load"),
      tool("b", "in_progress"),
      tool("a"),
      update({ sessionUpdate: "tool_call_update", toolCallId: "b", status: "completed" }),
      tool("c"),
      opened(),
    );
    const indexes = items(session).flatMap((item) => (item.kind === "tool_call" ? [[item.toolCallId, item.index]] : []));
    expect(indexes).toEqual([["b", 1], ["a", 2], ["c", 3]]);
  });

  test("a three-turn replay without messageId keeps every turn's messages distinct", () => {
    const session = apply(
      createSession(),
      opening("load"),
      user("one"),
      agent("answer "),
      agent("one"),
      user("two"),
      agent("answer two"),
      user("three"),
      agent("answer three"),
      opened(),
    );
    expect(items(session).map((item) => [item.kind, "text" in item ? item.text : null])).toEqual([
      ["user_message", "one"],
      ["agent_message", "answer one"],
      ["user_message", "two"],
      ["agent_message", "answer two"],
      ["user_message", "three"],
      ["agent_message", "answer three"],
    ]);
    expect(new Set(session.order).size).toBe(6);
    for (const item of items(session)) expect(item.origin).toBe("replay");
  });

  test("a replay never starts a turn or adds turn markers", () => {
    const session = apply(createSession(), opening("load"), user("q"), agent("a"), tool("t"), opened());
    expect(items(session).some((item) => item.kind === "marker")).toBe(false);
    expect(session.stopReason).toBeNull();
  });

  test("Updates after the load: origin other while idle, as before", () => {
    const session = apply(createSession(), opening("load"), agent("old"), opened(), agent("new"));
    const [replayed, fresh] = items(session);
    expect(replayed?.origin).toBe("replay");
    expect(fresh?.origin).toBe("other");
    expect(fresh?.status).toBe("live");
    expect(session.order).toHaveLength(2);
  });

  test("a prompt after the load is an ordinary turn", () => {
    const session = apply(createSession(), opening("load"), agent("old"), opened(), { type: "prompt_sent", text: "next", at: ++clock }, agent("reply"));
    const last = items(session).at(-1);
    expect(last?.origin).toBe("self");
    expect(session.state).toBe("running");
  });
});

describe("session title and activity time", () => {
  const info = (fields: { title?: string | null; updatedAt?: string | null }): ModelEvent =>
    update({ sessionUpdate: "session_info_update", ...fields });

  test("a new session has neither", () => {
    const session = createSession();
    expect(session.title).toBeNull();
    expect(session.updatedAt).toBeNull();
  });

  test("Title set and cleared", () => {
    let session = reduce(createSession(), info({ title: "Early return" }));
    expect(session.title).toBe("Early return");
    session = reduce(session, info({ title: null }));
    expect(session.title).toBeNull();
  });

  test("Title only: updatedAt is unchanged", () => {
    let session = reduce(createSession(), info({ title: "First", updatedAt: "2026-10-04T09:00:00Z" }));
    session = reduce(session, info({ title: "Second" }));
    expect(session.title).toBe("Second");
    expect(session.updatedAt).toBe("2026-10-04T09:00:00Z");
  });

  test("updatedAt alone leaves the title, and null clears it", () => {
    let session = reduce(createSession(), info({ title: "Keep", updatedAt: "2026-10-04T09:00:00Z" }));
    session = reduce(session, info({ updatedAt: "2026-10-04T10:30:00Z" }));
    expect(session.title).toBe("Keep");
    expect(session.updatedAt).toBe("2026-10-04T10:30:00Z");
    session = reduce(session, info({ updatedAt: null }));
    expect(session.updatedAt).toBeNull();
    expect(session.title).toBe("Keep");
  });

  test("an empty update changes nothing", () => {
    const before = reduce(createSession(), info({ title: "Same", updatedAt: "2026-10-04T09:00:00Z" }));
    const after = reduce(before, info({}));
    expect(after.title).toBe("Same");
    expect(after.updatedAt).toBe("2026-10-04T09:00:00Z");
  });

  test("a title update adds no item and is not reported as unknown", () => {
    const seen: string[] = [];
    const session = reduce(createSession(), info({ title: "Quiet" }), (debug) => seen.push(debug.sessionUpdate));
    expect(session.order).toHaveLength(0);
    expect(seen).toEqual([]);
  });

  test("a title that is only whitespace or controls reads as cleared", () => {
    const session = reduce(reduce(createSession(), info({ title: "Was set" })), info({ title: ` \n\t${ESC}[0m ` }));
    expect(session.title).toBeNull();
  });

  test("Hostile title: no ESC, no bidi control, one line", () => {
    const osc8 = `${ESC}]8;;https://evil.example${ESC}\\click me${ESC}]8;;${ESC}\\`;
    const hostile = `Fix ${osc8} \u202egnp.exe\u202c\nsecond line\r\nthird\u2028fourth`;
    const session = reduce(createSession(), update({ sessionUpdate: "session_info_update", title: hostile }));
    const title = session.title ?? "";
    expect(title).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
    expect(title).not.toContain(ESC);
    expect(title).not.toMatch(/[\u202a-\u202e\u2066-\u2069\u200e\u200f]/);
    expect(title).not.toMatch(/[\n\r\t\u2028\u2029]/);
    expect(title).toContain("click me");
    expect(title).toContain("second line");
    expect(title).not.toContain("evil.example");
  });

  test("a title replayed during a load is recorded like any other", () => {
    const session = apply(createSession(), opening("load"), info({ title: "From history", updatedAt: "2026-10-03T08:00:00Z" }), agent("x"), opened());
    expect(session.title).toBe("From history");
    expect(session.updatedAt).toBe("2026-10-03T08:00:00Z");
  });
});

// Spec model-session "Client notice markers" (mvp-sessions task 12.1): the session directory
// marker that acp-tui appends after the loaded history.
describe("client notice markers", () => {
  const notice = (value: string): ModelEvent => ({ type: "client_notice", text: value, at: ++clock });

  test("Notice after a load: the last item, final, origin replay, state idle", () => {
    const session = apply(createSession(), opening("load"), user("first"), agent("answer"), opened(), notice("opened in ~/repo-b (launched from ~)"));
    const all = items(session);
    expect(all.map((i) => i.kind)).toEqual(["user_message", "agent_message", "marker"]);
    const last = all.at(-1)!;
    expect(last).toMatchObject({ kind: "marker", markerKind: "notice", status: "final", origin: "replay", text: "opened in ~/repo-b (launched from ~)" });
    expect(session.state).toBe("idle");
    expect(session.turn).toBeNull();
  });

  test("after the resume marker", () => {
    const session = apply(createSession(), opening("resume"), opened(), notice("opened in /work"));
    const all = items(session);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ kind: "marker", text: "Session resumed: the history is not available from this agent" });
    expect(all[1]).toMatchObject({ kind: "marker", markerKind: "notice", text: "opened in /work" });
  });

  test("ids stay unique next to other markers", () => {
    const session = apply(createSession(), opening("resume"), opened(), notice("a"), notice("b"));
    expect(new Set(session.order).size).toBe(3);
  });

  test("Hostile notice text: printable characters, no ESC", () => {
    const session = apply(createSession(), notice(`opened in ${ESC}]8;;https://evil.example${BEL}~/repo${ESC}]8;;${BEL}`));
    const marker = items(session)[0]!;
    expect(marker.kind).toBe("marker");
    const textOf = marker.kind === "marker" && marker.markerKind === "notice" ? marker.text : "";
    expect(textOf).toBe("opened in ~/repo");
    expect(textOf).not.toContain(ESC);
  });
});

// Spec model-session "Additional directories are recorded".
describe("Additional directories", () => {
  const created = (additionalDirectories?: readonly string[]): ModelEvent => ({
    type: "session_created",
    response: { sessionId: "s-1" },
    cwd: "/work/app",
    ...(additionalDirectories ? { additionalDirectories } : {}),
    at: 1,
  });

  test("Started with directories", () => {
    const session = reduce(createSession(), created(["/work/lib", "/work/docs"]));
    expect(session.additionalDirectories).toEqual(["/work/lib", "/work/docs"]);
  });

  test("Reopened with a longer list", () => {
    const before = apply(createSession(), created(["/work/lib"]), agent("hello"));
    const after = reduce(before, { type: "additional_directories_replaced", additionalDirectories: ["/work/lib", "/work/docs", "/work/api"], at: 9 });
    expect(after.additionalDirectories).toEqual(["/work/lib", "/work/docs", "/work/api"]);
    expect(after.order).toEqual(before.order);
    expect(after.items).toBe(before.items);
  });

  test("None", () => {
    expect(reduce(createSession(), created()).additionalDirectories).toEqual([]);
    expect(createSession().additionalDirectories).toEqual([]);
  });

  test("Opening records the list sent with the request", () => {
    const session = reduce(createSession(), { ...opening("load"), additionalDirectories: ["/work/lib"] } as ModelEvent);
    expect(session.additionalDirectories).toEqual(["/work/lib"]);
  });
});
