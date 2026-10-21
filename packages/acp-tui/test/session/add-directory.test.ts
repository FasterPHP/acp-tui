// The switcher's `addDirectory` (harness-feedback task group 7; spec tui-palette "Adding a
// directory during a session") against fake-agent, without a renderer: the ACP route (resume on the
// same connection, load as the fallback and for a harness without resume), the template route
// (a restart after the confirmation), and every refusal. fake-agent's `--log` records what it
// received, so the requests are read from there.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCatalogue, AgentEntry } from "../../src/agent/catalogue.ts";
import type { LaunchDescription } from "../../src/agent/resolve.ts";
import { shortenHome } from "../../src/layout/segments.ts";
import { userHome } from "../../src/platform/paths.ts";
import { openSessionIndex } from "../../src/session/session-index.ts";
import { ADD_DIRECTORY_REFUSED_PERMISSION, ADD_DIRECTORY_REFUSED_RUNNING, createSessionSwitcher, type SessionSwitcher } from "../../src/session/switch.ts";
import { fakeAgentCommand } from "../agent/fake-agent-command.ts";

let switcher: SessionSwitcher | null = null;
afterEach(async () => {
  await switcher?.detach();
  switcher = null;
});

interface Received {
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

function setup(options: { readonly args: readonly string[]; readonly template?: boolean; readonly scenario?: string; readonly persist?: boolean }) {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-adddir-")));
  const app = join(dir, "app");
  const lib = join(dir, "lib");
  const docs = join(dir, "docs");
  for (const d of [app, lib, docs]) mkdirSync(d);
  const logPath = join(dir, "agent.log");
  const [command, ...base] = fakeAgentCommand({ scenario: options.scenario ?? "basic", logPath });
  // A restarted harness is a new process: a persisted store lets it find the session, as a real harness's disk does.
  const args = [...base, ...options.args, ...(options.persist ? ["--sessions", join(dir, "store.json"), "--persist"] : [])];
  const fake: AgentEntry = { name: "fake", command: command!, args, env: {}, ...(options.template ? { additionalDirectoryArgs: ["--add-workspace", "{dir}"] } : {}) };
  const catalogue: AgentCatalogue = { path: join(dir, "config.jsonc"), agents: new Map([["fake", fake]]), invalid: new Map(), defaultAgent: "fake", problems: [] };
  const launch: LaunchDescription = {
    agentName: "fake",
    agentSource: "option",
    command: fake.command,
    args,
    env: {},
    directory: app,
    directorySource: "launch",
    launchDirectory: app,
    session: { kind: "new" },
    indexed: null,
    indexMatches: 0,
    problems: [],
    ...(options.template ? { additionalDirectoryArgs: ["--add-workspace", "{dir}"] } : {}),
  };
  const replaced: unknown[] = [];
  const index = openSessionIndex({ stateHome: join(dir, "state") });
  const using = createSessionSwitcher({
    launch,
    index,
    store: { attach: () => {}, replace: (source) => void replaced.push(source) },
    catalogue: () => catalogue,
    configDirectories: () => [],
  });
  switcher = using;
  const received = (): Received[] =>
    readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Received);
  const never = async (): Promise<boolean> => {
    throw new Error("no confirmation expected");
  };
  return { dir, app, lib, docs, switcher: using, received, replaced, index, never };
}

const ACP = ["--additional-directories", "--resume", "--load"];

describe("the ACP route", () => {
  test("a harness with resume: session/resume carries the complete list, nothing is replayed, no prompt is sent and the model records the list", async () => {
    const w = setup({ args: ACP });
    await w.switcher.start();
    const controller = w.switcher.current()!.controller;
    const result = await w.switcher.addDirectory("../lib", w.never);
    expect(result).toEqual({ ok: true, directory: w.lib, how: "resume" });
    const resumes = w.received().filter((e) => e.method === "session/resume");
    expect(resumes).toHaveLength(1);
    expect(resumes[0]!.params).toMatchObject({ sessionId: controller.getSession().id, cwd: w.app, additionalDirectories: [w.lib] });
    expect(w.received().some((e) => e.method === "session/load" || e.method === "session/prompt")).toBe(false);
    // The same controller and process: the conversation was not replaced.
    expect(w.switcher.current()!.controller).toBe(controller);
    expect(w.replaced).toEqual([]);
    expect(controller.getSession().additionalDirectories).toEqual([w.lib]);
    expect(controller.getSession().order.some((id) => controller.getSession().items.get(id)?.kind === "marker")).toBe(false);
    expect(w.switcher.current()!.launch.addedDirectories).toEqual([w.lib]);
    // A second directory sends both.
    expect((await w.switcher.addDirectory(w.docs, w.never)).ok).toBe(true);
    expect(w.received().filter((e) => e.method === "session/resume").at(-1)!.params?.["additionalDirectories"]).toEqual([w.lib, w.docs]);
  }, 30000);

  test("an error from session/resume falls back to session/load, and the list is the same", async () => {
    const w = setup({ args: ACP });
    await w.switcher.start();
    const first = w.switcher.current()!.controller;
    (first as { resumeWithDirectories: unknown }).resumeWithDirectories = async () => {
      throw new Error("resume refused");
    };
    const result = await w.switcher.addDirectory("../lib", w.never);
    expect(result).toEqual({ ok: true, directory: w.lib, how: "load" });
    const loads = w.received().filter((e) => e.method === "session/load");
    expect(loads).toHaveLength(1);
    expect(loads[0]!.params).toMatchObject({ cwd: w.app, additionalDirectories: [w.lib] });
    expect(w.switcher.current()!.controller).not.toBe(first);
    expect(w.switcher.current()!.controller.getSession().additionalDirectories).toEqual([w.lib]);
    expect(w.replaced).toHaveLength(1);
  }, 30000);

  test("a harness with load only: session/load carries the list on the same process and the conversation is replaced by its replay", async () => {
    const w = setup({ args: ["--additional-directories", "--load"] });
    await w.switcher.start();
    const result = await w.switcher.addDirectory("../lib", w.never);
    expect(result).toEqual({ ok: true, directory: w.lib, how: "load" });
    expect(w.received().some((e) => e.method === "session/resume")).toBe(false);
    expect(w.received().filter((e) => e.method === "session/load")[0]!.params).toMatchObject({ additionalDirectories: [w.lib] });
    expect(w.received().filter((e) => e.method === "initialize")).toHaveLength(1);
    expect(w.switcher.current()!.controller.getSession().additionalDirectories).toEqual([w.lib]);
  }, 30000);

  test("the recorder writes the list with the session's entry once it is recorded, and again when a directory is added", async () => {
    const w = setup({ args: ACP, scenario: "copy-fixtures" });
    await w.switcher.start();
    const using = w.switcher.current()!;
    using.controller.prompt("hello");
    for (let i = 0; i < 400 && (w.index.listAll().length === 0 || using.controller.getSession().state !== "idle"); i++) await Bun.sleep(25);
    expect(w.index.listAll()[0]!.addedDirectories).toBeUndefined();
    expect((await w.switcher.addDirectory("../lib", w.never)).ok).toBe(true);
    expect(w.index.listAll()[0]!.addedDirectories).toEqual([w.lib]);
    // A resume after it carries the directory: the index entry reads back for a reopened session.
    expect(w.switcher.records()[0]!.addedDirectories).toEqual([w.lib]);
  }, 30000);
});

describe("refusals", () => {
  test("a path that is missing, a file, or listed already; nothing is sent", async () => {
    const w = setup({ args: ACP });
    await w.switcher.start();
    const before = w.received().length;
    expect(await w.switcher.addDirectory("../nowhere", w.never)).toMatchObject({ ok: false, message: expect.stringContaining("is not a directory") });
    expect(await w.switcher.addDirectory(".", w.never)).toMatchObject({ ok: false, message: expect.stringContaining("is already in the session") });
    expect(await w.switcher.addDirectory("   ", w.never)).toMatchObject({ ok: false, message: "usage: /add-dir <path>" });
    expect((await w.switcher.addDirectory("../lib", w.never)).ok).toBe(true);
    expect(await w.switcher.addDirectory(w.lib, w.never)).toMatchObject({ ok: false, message: expect.stringContaining("is already in the session") });
    expect(w.received().slice(before).map((e) => e.method).filter((m) => !m.endsWith("/response"))).toEqual(["session/resume"]);
  }, 30000);

  test("a harness that takes no directories: the notice for a harness that ignores them, nothing sent", async () => {
    const w = setup({ args: ["--resume", "--load"] });
    await w.switcher.start();
    const result = await w.switcher.addDirectory("../lib", w.never);
    expect(result).toMatchObject({ ok: false, message: "fake ignores additional directories (it does not support them); see additional_directories in docs/configuration.md" });
    expect(w.received().some((e) => e.method === "session/resume")).toBe(false);
  }, 30000);

  test("a harness that can neither load nor resume: refused, nothing sent", async () => {
    const w = setup({ args: ["--additional-directories"] });
    await w.switcher.start();
    const result = await w.switcher.addDirectory("../lib", w.never);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("cannot reopen sessions") });
  }, 30000);

  test("while a turn runs: a notice that it can be added once the turn has ended, and nothing is sent", async () => {
    const w = setup({ args: [...ACP, "--long-gap", "--delay-scale", "1"], scenario: "slow-turn" });
    await w.switcher.start();
    w.switcher.current()!.controller.prompt("go");
    for (let i = 0; i < 200 && w.switcher.current()!.controller.getSession().state === "idle"; i++) await Bun.sleep(25);
    expect(await w.switcher.addDirectory("../lib", w.never)).toEqual({ ok: false, message: ADD_DIRECTORY_REFUSED_RUNNING });
    w.switcher.current()!.controller.cancel();
    expect(w.received().some((e) => e.method === "session/resume")).toBe(false);
  }, 30000);

  test("while a permission request is open: refused with its own notice", async () => {
    const w = setup({ args: ACP, scenario: "permission-diff" });
    await w.switcher.start();
    const controller = w.switcher.current()!.controller;
    controller.prompt("edit");
    for (let i = 0; i < 400 && !controller.getSession().turn?.openPermissionToolCallId; i++) await Bun.sleep(25);
    expect(await w.switcher.addDirectory("../lib", w.never)).toEqual({ ok: false, message: ADD_DIRECTORY_REFUSED_PERMISSION });
    controller.cancel();
  }, 30000);
});

describe("the template route", () => {
  test("declined: nothing restarts; confirmed: the old process is detached, a new one is launched with --add-workspace and the session is loaded on it", async () => {
    const w = setup({ args: ["--load", "--additional-directories"], template: true, persist: true });
    await w.switcher.start();
    const before = w.switcher.current()!;
    const asked: string[] = [];
    const declined = await w.switcher.addDirectory("../lib", async (text) => {
      asked.push(text);
      return false;
    });
    expect(declined).toMatchObject({ ok: false, cancelled: true });
    expect(asked).toEqual([`Restart fake with ${shortenHome(w.lib, userHome())} and reopen this session`]);
    expect(w.switcher.current()).toBe(before);
    expect(w.received().filter((e) => e.method === "initialize")).toHaveLength(1);

    const accepted = await w.switcher.addDirectory("../lib", async () => true);
    expect(accepted).toEqual({ ok: true, directory: w.lib, how: "restart" });
    expect(w.received().filter((e) => e.method === "initialize")).toHaveLength(2);
    const workspaces = w.received().filter((e) => e.method === "argv/add-workspace");
    expect(workspaces.at(-1)!.params).toEqual({ directories: [w.lib] });
    // The ACP field is not sent beside the arguments.
    expect(w.received().filter((e) => e.method === "session/load")[0]!.params?.["additionalDirectories"]).toBeUndefined();
    expect(w.switcher.current()!.controller).not.toBe(before.controller);
    expect(w.switcher.current()!.controller.getSession().id).toBe(before.controller.getSession().id);
    expect(w.switcher.current()!.launch.addedDirectories).toEqual([w.lib]);
    expect(w.switcher.current()!.controller.getSession().additionalDirectories).toEqual([w.lib]);
  }, 40000);
});
