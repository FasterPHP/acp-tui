// The session switcher (src/session/switch.ts) against fake-agent, without a
// renderer: an error thrown while the store attaches the new session (a
// component of the conversation that throws, as in IDE check 10.2) is
// acp-tui's own fault, not a failure to open the session. It is not reported
// as `cannot start a new session with agent ...`, the agents are not rolled
// back (the new session exists on its agent), and `choose` rejects with it so
// it reaches the app's uncaught-error path. A real failure to open still
// resolves with the message and puts everything back. Also the session
// directory marker (IDE check 10.4, decision B; task 12.3): `opened in <dir>
// (launched from <dir>)`, `~` for the home directory, the last item after a
// switch and at start-up.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCatalogue, AgentEntry } from "../../src/agent/catalogue.ts";
import type { LaunchDescription } from "../../src/agent/resolve.ts";
import { openSessionIndex } from "../../src/session/session-index.ts";
import type { SessionSource } from "../../src/session/store.ts";
import { createSessionSwitcher, type SessionSwitcher } from "../../src/session/switch.ts";
import { fakeAgentCommand, rejectionOf } from "../agent/fake-agent-command.ts";

let switcher: SessionSwitcher | null = null;
afterEach(async () => {
  await switcher?.detach();
  switcher = null;
});

function temp(): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-switch-")));
}

function entry(name: string, scenario: string): AgentEntry {
  const [command, ...args] = fakeAgentCommand({ scenario });
  return { name, command: command!, args, env: {}, source: "config" };
}

/** A store that records what it attaches, and throws from `replace` while `failing` is set. */
function fakeStore() {
  const attached: (SessionSource | null)[] = [];
  const store = {
    failing: null as Error | null,
    attached,
    attach(source: SessionSource) {
      attached.push(source);
    },
    replace(source: SessionSource | null) {
      if (store.failing && source !== null) throw store.failing;
      attached.push(source);
    },
  };
  return store;
}

function setup(otherScenario = "basic") {
  const dir = temp();
  const agents = new Map([
    ["fake", entry("fake", "basic")],
    ["other", entry("other", otherScenario)],
  ]);
  const catalogue: AgentCatalogue = { path: join(dir, "config.jsonc"), agents, invalid: new Map(), defaultAgent: "fake", problems: [] };
  const fake = agents.get("fake")!;
  const launch: LaunchDescription = {
    agentName: "fake",
    agentSource: "option",
    command: fake.command,
    args: fake.args,
    env: {},
    directory: dir,
    directorySource: "launch",
    launchDirectory: dir,
    session: { kind: "new" },
    indexed: null,
    indexMatches: 0,
    problems: [],
  };
  const store = fakeStore();
  switcher = createSessionSwitcher({ launch, index: openSessionIndex({ stateHome: join(dir, "state") }), store, catalogue: () => catalogue });
  return { switcher, store };
}

describe("an error while the store attaches the new session (IDE check 10.2)", () => {
  for (const [name, choice] of [
    ["a new session with another agent", { kind: "new", agent: "other", current: false }],
    ["a new session with the same agent", { kind: "new", agent: "fake", current: true }],
  ] as const) {
    test(`${name}: choose rejects with the error, and the new session stays the session in use`, async () => {
      const { switcher, store } = setup();
      await switcher.start();
      const before = switcher.current()!;
      const failure = new Error("undefined is not an object (evaluating 'tool().status')");
      store.failing = failure;
      expect(await rejectionOf(switcher.choose(choice))).toBe(failure);
      const after = switcher.current()!;
      // Not rolled back: the new session (opened on its agent) is the one in use, so the exit text
      // names it and exit detaches both agents.
      expect(after.controller).not.toBe(before.controller);
      expect(after.launch.agentName).toBe(choice.agent);
      expect(after.controller.getSession().id).not.toBeNull();
      expect(after.controller.getSession().connection).not.toBe("disconnected");
      // Nothing put back into the store either.
      expect(store.attached).toEqual([before.controller]);
    }, 20000);
  }

  test("a real failure to open (the agent cannot start) still resolves with the message and leaves everything as it was", async () => {
    const { switcher, store } = setup("no-such-scenario");
    await switcher.start();
    const before = switcher.current()!;
    const problem = await switcher.choose({ kind: "new", agent: "other", current: false });
    expect(problem).toMatch(/^cannot start /);
    expect(switcher.current()).toBe(before);
    expect(store.attached).toEqual([before.controller]);
  }, 20000);
});

/** A fake agent that can load `s-b` in `<dir>/repo-b`, and a launch of it from `dir`. */
function repoWorld(session: LaunchDescription["session"] = { kind: "new" }, indexMatches = 0) {
  const dir = temp();
  const repoB = join(dir, "repo-b");
  mkdirSync(repoB);
  const fixture = join(dir, "sessions.json");
  writeFileSync(fixture, JSON.stringify({ sessions: [{ sessionId: "s-b", cwd: repoB, title: "Fix the router", turns: [] }] }));
  const [command, ...args] = fakeAgentCommand({ scenario: "copy-fixtures" });
  const fake: AgentEntry = { name: "fake", command: command!, args: [...args, "--load", "--sessions", fixture], env: {}, source: "config" };
  const catalogue: AgentCatalogue = { path: join(dir, "config.jsonc"), agents: new Map([["fake", fake]]), invalid: new Map(), defaultAgent: "fake", problems: [] };
  const launch: LaunchDescription = {
    agentName: "fake",
    agentSource: "option",
    command: fake.command,
    args: fake.args,
    env: {},
    directory: session.kind === "resume" ? repoB : dir,
    directorySource: session.kind === "resume" ? "index" : "launch",
    launchDirectory: dir,
    session,
    indexed: null,
    indexMatches,
    problems: [],
  };
  const notices: string[] = [];
  switcher = createSessionSwitcher({
    launch,
    index: openSessionIndex({ stateHome: join(dir, "state") }),
    store: fakeStore(),
    catalogue: () => catalogue,
    notify: (text) => notices.push(text),
  });
  return { dir, repoB, notices, switcher };
}

/** Runs `body` with HOME set to `home`. */
async function withHome<T>(home: string, body: () => Promise<T>): Promise<T> {
  const saved = process.env.HOME;
  process.env.HOME = home;
  try {
    return await body();
  } finally {
    process.env.HOME = saved;
  }
}

/** The last item of the session in use, as text when it is a notice marker. */
function lastNotice(using: SessionSwitcher): string | null {
  const session = using.current()!.controller.getSession();
  const last = session.items.get(session.order.at(-1) ?? "");
  return last?.kind === "marker" && last.markerKind === "notice" ? last.text : null;
}

describe("the session directory marker (IDE check 10.4, decision B)", () => {
  test("opening a session of another directory from the list ends its conversation with a marker naming both directories, `~` for home", async () => {
    const { dir, repoB, notices, switcher } = repoWorld();
    await switcher.start();
    expect(notices).toEqual([]);
    const problem = await withHome(dir, () =>
      switcher.choose({ kind: "session", sessionId: "s-b", agent: "fake", command: null, directory: repoB, title: "Fix the router", updatedAt: null, current: true }),
    );
    expect(problem).toBeNull();
    expect(notices).toEqual([]);
    expect(lastNotice(switcher)).toBe("opened in ~/repo-b (launched from ~)");
    const session = switcher.current()!.controller.getSession();
    expect(session.items.get(session.order.at(-1)!)!.origin).toBe("replay");
  }, 20000);

  test("--resume <id> with the ID recorded for several agents: the marker, and the agent chosen still a notice", async () => {
    const { dir, notices, switcher } = repoWorld({ kind: "resume", id: "s-b" }, 2);
    await withHome(dir, () => switcher.start());
    expect(notices).toEqual(["2 harnesses have this session: opened with fake (latest)"]);
    expect(lastNotice(switcher)).toBe("opened in ~/repo-b (launched from ~)");
  }, 20000);

  test("Same directory: no marker", async () => {
    const { dir, notices, switcher } = repoWorld();
    await switcher.start();
    const problem = await switcher.choose({ kind: "session", sessionId: "s-b", agent: "fake", command: null, directory: dir, title: null, updatedAt: null, current: true });
    expect(problem).toBeNull();
    expect(notices).toEqual([]);
    expect(lastNotice(switcher)).toBeNull();
  }, 20000);
});

describe("the start-up connection (day-two-feedback D2)", () => {
  test("`starting` is true while `connect` runs and `ready` resolves once the agent is up; nothing connecting resolves at once", async () => {
    const { switcher } = repoWorld({ kind: "list" });
    expect(switcher.starting()).toBe(false);
    await switcher.ready();
    const connected = switcher.connect();
    expect(switcher.starting()).toBe(true);
    expect(switcher.current()).toBeNull();
    await switcher.ready();
    await connected;
    expect(switcher.starting()).toBe(false);
    expect(switcher.current()).not.toBeNull();
  }, 20000);

  test("a start-up failure: `ready` and `connect` reject with it, `starting` ends, and Esc's new session fails with the same error", async () => {
    const dir = temp();
    const launch: LaunchDescription = {
      agentName: "ghost",
      agentSource: "option",
      command: join(dir, "no-such-harness"),
      args: [],
      env: {},
      directory: dir,
      directorySource: "launch",
      launchDirectory: dir,
      session: { kind: "list" },
      indexed: null,
      indexMatches: 0,
      problems: [],
    };
    switcher = createSessionSwitcher({ launch, index: openSessionIndex({ stateHome: join(dir, "state") }), store: fakeStore() });
    const connected = switcher.connect();
    const ready = switcher.ready();
    await expect(connected).rejects.toThrow();
    await expect(ready).rejects.toThrow();
    expect(switcher.starting()).toBe(false);
    expect(switcher.current()).toBeNull();
    await expect(switcher.startNew()).rejects.toThrow();
  }, 20000);

  test("startNew called before the agent is up waits for it, then starts the session", async () => {
    const { switcher, dir } = repoWorld({ kind: "list" });
    void switcher.connect();
    await switcher.startNew();
    expect(switcher.current()?.recorder).not.toBeNull();
    expect(switcher.directory()).toBe(dir);
  }, 20000);
});
