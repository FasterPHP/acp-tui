// mvp-sessions task 4.2 (design decision 1, spec tui-sessions "Session index"
// and "Session titles"): the recorder writes a session to the index on its
// first prompt (never at session/new) and at once when it is opened by load or
// resume; it keeps the title (the agent's, else the first line of the first
// prompt cut to 80 columns, sanitised, one line) and the last-activity time.
// Sessions are built with acp-model's own reducer, as the controller does.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import { HOSTILE_SESSION_TITLE } from "fake-agent";
import { createSessionRecorder, promptTitle, type SessionRecorder } from "../../src/session/recorder.ts";
import { openSessionIndex, type SessionIndex } from "../../src/session/session-index.ts";

function index(now: () => number): SessionIndex {
  return openSessionIndex({ stateHome: mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-recorder-")), now });
}

/** A session driven through the reducer, with every snapshot fed to the recorder. */
function drive(recorder: SessionRecorder) {
  let session: Session = createSession();
  let at = 1_000;
  const step = (event: Omit<ModelEvent, "at">): Session => {
    at += 1;
    session = reduce(session, { ...event, at } as ModelEvent);
    recorder.observe(session);
    return session;
  };
  return {
    step,
    newSession: (id: string, cwd: string) => step({ type: "session_created", response: { sessionId: id }, cwd } as Omit<ModelEvent, "at">),
    prompt: (text: string) => {
      step({ type: "prompt_sent", text } as Omit<ModelEvent, "at">);
      return step({ type: "prompt_response", stopReason: "end_turn" } as Omit<ModelEvent, "at">);
    },
    title: (title: string | null) =>
      step({ type: "session_update", update: { sessionUpdate: "session_info_update", title } } as Omit<ModelEvent, "at">),
  };
}

const T0 = Date.parse("2026-10-04T09:00:00.000Z");

describe("Session index wiring (task 4.2)", () => {
  test("Recorded on the first prompt: nothing at session/new, then the agent, directory, title and times", () => {
    let now = T0;
    const idx = index(() => now);
    const recorder = createSessionRecorder(idx, { agent: "fake" }, { now: () => now });
    const s = drive(recorder);
    s.newSession("s-1", "/work/repo-b");
    expect(idx.listAll()).toEqual([]);
    expect(recorder.recorded).toBe(false);

    s.prompt("hello there");
    expect(idx.find("s-1").record).toEqual({
      sessionId: "s-1",
      agent: "fake",
      directory: "/work/repo-b",
      title: "hello there",
      createdAt: new Date(T0).toISOString(),
      updatedAt: new Date(T0).toISOString(),
    });

    // Each later prompt is activity; the creation time stays.
    now = T0 + 60_000;
    s.prompt("and again");
    expect(idx.find("s-1").record).toMatchObject({ createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0 + 60_000).toISOString(), title: "hello there" });
    expect(recorder.prompted).toBe(true);
  });

  test("Agent title replaces the prompt title", () => {
    const idx = index(() => T0);
    const recorder = createSessionRecorder(idx, { agent: "fake" }, { now: () => T0 });
    const s = drive(recorder);
    s.newSession("s-2", "/work/repo-b");
    s.prompt("Why does renderTemplate return early?");
    expect(idx.find("s-2").record?.title).toBe("Why does renderTemplate return early?");
    s.title("Early return in renderTemplate");
    expect(idx.find("s-2").record?.title).toBe("Early return in renderTemplate");
    expect(recorder.title).toBe("Early return in renderTemplate");
  });

  test("No agent title: the first line of the first prompt, cut to 80 columns", () => {
    const idx = index(() => T0);
    const recorder = createSessionRecorder(idx, { agent: "fake" }, { now: () => T0 });
    const s = drive(recorder);
    s.newSession("s-3", "/work/repo-b");
    s.prompt("fix the failing test\nthen run the suite");
    expect(idx.find("s-3").record?.title).toBe("fix the failing test");
    // A later prompt does not change it.
    s.prompt("something else");
    expect(idx.find("s-3").record?.title).toBe("fix the failing test");

    expect(promptTitle(`${"x".repeat(100)}\nsecond`)).toBe("x".repeat(80));
    // Wide characters count two columns.
    expect(promptTitle("界".repeat(50))).toBe("界".repeat(40));
    expect(promptTitle("\n\n  \nfirst real line")).toBe("first real line");
  });

  test("an agent title reported before the first prompt is the recorded title", () => {
    const idx = index(() => T0);
    const recorder = createSessionRecorder(idx, { agent: "fake" }, { now: () => T0 });
    const s = drive(recorder);
    s.newSession("s-4", "/work");
    s.title("Named early");
    expect(idx.listAll()).toEqual([]);
    s.prompt("the prompt");
    expect(idx.find("s-4").record?.title).toBe("Named early");
  });

  test("a cleared agent title falls back to the prompt's", () => {
    const idx = index(() => T0);
    const recorder = createSessionRecorder(idx, { agent: "fake" }, { now: () => T0 });
    const s = drive(recorder);
    s.newSession("s-5", "/work");
    s.prompt("the prompt title");
    s.title("Agent title");
    s.title(null);
    expect(idx.find("s-5").record?.title).toBe("the prompt title");
  });

  test("Hostile title: an OSC 8 hyperlink, a bidi override and a newline are stored as printable text on one line", () => {
    const idx = index(() => T0);
    const recorder = createSessionRecorder(idx, { agent: "fake" }, { now: () => T0 });
    const s = drive(recorder);
    s.newSession("s-6", "/work");
    s.prompt("plain prompt");
    // Raw on the wire; acp-model sanitises it, and the index again.
    expect(HOSTILE_SESSION_TITLE).toMatch(/\x1b|‮/);
    s.title(HOSTILE_SESSION_TITLE);
    const stored = idx.find("s-6").record?.title ?? "";
    expect(stored).not.toBe("");
    expect(stored).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(stored).not.toMatch(/[‎‏‪-‮⁦-⁩]/);
    expect(stored).not.toContain("\n");
    // A hostile first prompt is cleaned the same way.
    expect(promptTitle(`a‮b\x1b]8;;http://x\x07link\x1b]8;;\x07 c`)).not.toMatch(/[\x1b‮\x07]/);
  });

  test("an ad hoc agent's command is recorded with the session", () => {
    const idx = index(() => T0);
    const recorder = createSessionRecorder(idx, { agent: "ad hoc", command: ["bun", "agent.ts", "--flag"] }, { now: () => T0 });
    const s = drive(recorder);
    s.newSession("s-7", "/work");
    s.prompt("go");
    expect(idx.find("s-7").record).toMatchObject({ agent: "ad hoc", command: ["bun", "agent.ts", "--flag"] });
  });

  test("opened by load: recorded at once, with the replayed first prompt as the title when the agent reports none", () => {
    const idx = index(() => T0);
    const recorder = createSessionRecorder(idx, { agent: "fake" }, { now: () => T0 });
    const s = drive(recorder);
    s.step({ type: "session_opening", mode: "load", sessionId: "sess-alpha", cwd: "/work/alpha" } as Omit<ModelEvent, "at">);
    s.step({ type: "session_update", update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Why does the router drop the query string?\nmore" } } } as Omit<ModelEvent, "at">);
    const opened = s.step({ type: "session_opened", response: {} } as Omit<ModelEvent, "at">);
    expect(idx.listAll()).toEqual([]);
    recorder.opened(opened);
    expect(idx.find("sess-alpha").record).toMatchObject({ agent: "fake", directory: "/work/alpha", title: "Why does the router drop the query string?" });
    // A known title (the agent's list, the index) wins over the replayed prompt.
    const again = createSessionRecorder(idx, { agent: "fake" }, { now: () => T0 });
    again.opened(opened, { title: "Fix the router" });
    expect(idx.find("sess-alpha").record?.title).toBe("Fix the router");
  });
});
