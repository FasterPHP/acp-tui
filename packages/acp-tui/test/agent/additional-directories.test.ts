// harness-feedback task group 6 (specs tui-sessions "Additional directories on the command line",
// "... sent to the harness", "... for harnesses without the capability" and "... kept with the
// session"): the effective list of a launch (configuration, then recorded, then `--add-dir`, never
// the session directory, no repeats), the argument template, the ACP field on the three session
// requests, and the index field. Directories are temporary; the configuration and the index are
// injected.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SESSIONS_FIXTURE_PATH } from "fake-agent";
import { buildAgentCatalogue } from "../../src/agent/catalogue.ts";
import { deriveDirectories, launchArgv, projectDirectoriesNotice, resolveLaunch, withDirectories, type ConfigDirectories, type ResolveContext } from "../../src/agent/resolve.ts";
import { connectAgent, type ConnectedController } from "../../src/session/controller.ts";
import { openSessionIndex } from "../../src/session/session-index.ts";
import { fakeAgentCommand } from "./fake-agent-command.ts";

const made: string[] = [];
function temp(prefix = "acp-tui-adddirs-"): string {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const controllers: ConnectedController[] = [];
afterEach(async () => {
  while (controllers.length > 0) await controllers.pop()?.detach();
});

/** /root/app (the session directory), /root/lib, /root/docs, /root/api. */
function tree() {
  const root = temp();
  for (const name of ["app", "lib", "docs", "api"]) mkdirSync(join(root, name));
  return { root, app: join(root, "app"), lib: join(root, "lib"), docs: join(root, "docs"), api: join(root, "api") };
}

const none = { agentName: null, agentCommand: null, directory: null, session: { kind: "new" as const } };
const CATALOGUE = () => buildAgentCatalogue(JSON.stringify({ agent_servers: { fake: { command: "bun", args: ["fake.ts"] } } }), "/cfg/acp-tui/config.jsonc");
function context(cwd: string, configured: Partial<ConfigDirectories> = {}): ResolveContext {
  return { cwd, catalogue: CATALOGUE, index: () => openSessionIndex({ stateHome: temp("acp-tui-adddirs-state-") }), configDirectories: () => ({ directories: [], projectDirectories: [], projectFile: null, ...configured }) };
}

describe("The effective list of a launch", () => {
  test("Order: the configuration's, the recorded ones, then --add-dir; no repeats; never the session directory", () => {
    const t = tree();
    const index = openSessionIndex({ stateHome: temp("acp-tui-adddirs-state-") });
    index.record({ agent: "fake", sessionId: "s-1", directory: t.app, addedDirectories: [t.docs, t.lib] });
    const launch = resolveLaunch({ ...none, agentName: "fake", session: { kind: "resume", id: "s-1" }, addDirs: [t.api, t.docs, t.app] }, { ...context(t.app, { directories: [t.lib, t.app] }), index: () => index });
    expect(launch.additionalDirectories).toEqual([t.lib, t.docs, t.api]);
    // Recorded with the session: the recorded ones, then --add-dir, not the configuration's alone.
    expect(launch.addedDirectories).toEqual([t.docs, t.lib, t.api]);
  });

  test("Two directories from --add-dir alone", () => {
    const t = tree();
    expect(resolveLaunch({ ...none, addDirs: [t.lib, t.docs] }, context(t.app)).additionalDirectories).toEqual([t.lib, t.docs]);
  });

  test("None: an empty list, and the command is unchanged", () => {
    const t = tree();
    const launch = resolveLaunch({ ...none, agentName: "auggie" }, context(t.app));
    expect(launch.additionalDirectories).toEqual([]);
    expect(launchArgv(launch)).toEqual(["auggie", "--acp"]);
  });

  test("A recorded directory that has gone is left out with a notice naming it", () => {
    const t = tree();
    rmSync(t.docs, { recursive: true });
    const derived = deriveDirectories({ config: [], recorded: [t.docs, t.lib], addDirs: [], directory: t.app, home: "/nowhere" });
    expect(derived.additionalDirectories).toEqual([t.lib]);
    expect(derived.addedDirectories).toEqual([t.lib]);
    expect(derived.directoryNotices).toHaveLength(1);
    expect(derived.directoryNotices[0]).toContain(t.docs);
    expect(derived.directoryNotices[0]).toContain("no longer there");
  });

  test("withDirectories derives the list again for another session directory and recorded set", () => {
    const t = tree();
    const launch = resolveLaunch({ ...none, addDirs: [t.lib] }, context(t.app, { directories: [t.docs] }));
    const other = withDirectories(launch, { directory: t.lib, recorded: [t.api] });
    expect(other.additionalDirectories).toEqual([t.docs, t.api]);
    expect(other.addedDirectories).toEqual([t.api]);
  });

  test("The project file's directories are named in one notice", () => {
    expect(projectDirectoriesNotice("/work/app/.acp-tui.jsonc", ["/work/lib", "/work/docs"], "/home/u")).toBe("/work/app/.acp-tui.jsonc adds 2 additional directories: /work/lib, /work/docs");
    expect(projectDirectoriesNotice("/home/u/app/.acp-tui.jsonc", ["/home/u/lib"], "/home/u")).toBe("~/app/.acp-tui.jsonc adds an additional directory: ~/lib");
  });
});

describe("Delivery by the harness's argument template", () => {
  test("Auggie with two directories: --add-workspace once per directory, after its own arguments", () => {
    const t = tree();
    const launch = resolveLaunch({ ...none, agentName: "auggie", addDirs: [t.lib, t.docs] }, context(t.app));
    expect(launchArgv(launch)).toEqual(["auggie", "--acp", "--add-workspace", t.lib, "--add-workspace", t.docs]);
  });

  test("A configured template is used as written, {dir} replaced wherever it stands", () => {
    const t = tree();
    const catalogue = () => buildAgentCatalogue(JSON.stringify({ agent_servers: { mine: { command: "mine", args: ["serve"], additional_directory_args: ["--include={dir}/src", "-v"] } } }), "/cfg/acp-tui/config.jsonc");
    const launch = resolveLaunch({ ...none, agentName: "mine", addDirs: [t.lib] }, { ...context(t.app), catalogue });
    expect(launchArgv(launch)).toEqual(["mine", "serve", `--include=${t.lib}/src`, "-v"]);
  });

  test("A harness without a template keeps its command whatever the list", () => {
    const t = tree();
    const launch = resolveLaunch({ ...none, agentName: "fake", addDirs: [t.lib] }, context(t.app));
    expect(launchArgv(launch)).toEqual(["bun", "fake.ts"]);
    expect(launch.additionalDirectories).toEqual([t.lib]);
  });

  test("Different lists, different commands (the process is told apart by the command)", () => {
    const t = tree();
    const a = resolveLaunch({ ...none, agentName: "auggie" }, context(t.app));
    const b = withDirectories(a, { recorded: [t.lib] });
    expect(launchArgv(a)).not.toEqual(launchArgv(b));
  });
});

describe("The ACP field on the three session requests", () => {
  const log = () => join(temp(), "agent.log");
  const received = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { method: string; params?: Record<string, unknown> }) : []);
  async function connect(args: readonly string[], path: string): Promise<ConnectedController> {
    const controller = await connectAgent({ command: [...fakeAgentCommand({ scenario: "copy-fixtures", logPath: path }), ...args], cwd: temp() });
    controllers.push(controller);
    return controller;
  }

  test("session/new carries additionalDirectories beside the cwd, and the model records the list", async () => {
    const path = log();
    const controller = await connect(["--additional-directories"], path);
    expect(controller.support.additionalDirectories).toBe(true);
    await controller.newSession("/work/app", { additionalDirectories: ["/work/lib"], send: true });
    expect(received(path).find((e) => e.method === "session/new")?.params).toEqual({ cwd: "/work/app", mcpServers: [], additionalDirectories: ["/work/lib"] });
    expect(controller.getSession().additionalDirectories).toEqual(["/work/lib"]);
  });

  test("No directories: the field is absent", async () => {
    const path = log();
    const controller = await connect(["--additional-directories"], path);
    await controller.newSession("/work/app", { additionalDirectories: [], send: true });
    expect(received(path).find((e) => e.method === "session/new")?.params).toEqual({ cwd: "/work/app", mcpServers: [] });
  });

  test("Not sent (an argument template, or the capability not advertised): the field is absent", async () => {
    const path = log();
    const controller = await connect([], path);
    expect(controller.support.additionalDirectories).toBe(false);
    await controller.newSession("/work/app", { additionalDirectories: ["/work/lib"], send: false });
    expect(received(path).find((e) => e.method === "session/new")?.params).toEqual({ cwd: "/work/app", mcpServers: [] });
  });

  test("session/load and session/resume carry the complete list", async () => {
    const loadPath = log();
    const loader = await connect(["--additional-directories", "--load", "--sessions", SESSIONS_FIXTURE_PATH], loadPath);
    await loader.openSession("sess-alpha", "/work/alpha", { additionalDirectories: ["/work/lib", "/work/docs"], send: true });
    expect(received(loadPath).find((e) => e.method === "session/load")?.params).toMatchObject({ sessionId: "sess-alpha", additionalDirectories: ["/work/lib", "/work/docs"] });
    expect(loader.getSession().additionalDirectories).toEqual(["/work/lib", "/work/docs"]);

    const resumePath = log();
    const resumer = await connect(["--additional-directories", "--resume", "--sessions", SESSIONS_FIXTURE_PATH], resumePath);
    await resumer.openSession("sess-alpha", "/work/alpha", { additionalDirectories: ["/work/lib"], send: true });
    expect(received(resumePath).find((e) => e.method === "session/resume")?.params).toMatchObject({ additionalDirectories: ["/work/lib"] });
  });
});
