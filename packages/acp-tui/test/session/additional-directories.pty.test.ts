// harness-feedback task group 6, under a PTY against fake-agent (specs tui-sessions "Additional
// directories on the command line", "... sent to the harness", "... for harnesses without the
// capability" and "... kept with the session", tui-layout "Additional directories module",
// tui-config "Additional directories in a project file" and, since configured-harnesses D8, "Additional directories per harness"). Every run has its own configuration,
// session index and directories; fake-agent stands in for `auggie` (with the built-in template, which
// a configured entry of that name has to repeat), for `fake` with and without the capability, and
// logs every request and its `--add-workspace` arguments.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { READY, statusRow } from "../pty/regions.ts";
import { listBody, listRows, listWorld, type ListWorld } from "./list-world.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

/** Adds `additional_directory_args` to the configured entry `name`, as an Auggie entry would carry it. */
function withTemplate(w: ListWorld, name: string): void {
  const file = join(w.env["XDG_CONFIG_HOME"]!, "acp-tui", "config.jsonc");
  const config = JSON.parse(readFileSync(file, "utf8")) as { agent_servers: Record<string, Record<string, unknown>> };
  config.agent_servers[name]!["additional_directory_args"] = ["--add-workspace", "{dir}"];
  writeFileSync(file, JSON.stringify(config));
}

/** Sets the configured entry `name`'s own `additional_directories` (configured-harnesses D8). */
function withEntryDirectories(w: ListWorld, name: string, directories: readonly string[]): void {
  const file = join(w.env["XDG_CONFIG_HOME"]!, "acp-tui", "config.jsonc");
  const config = JSON.parse(readFileSync(file, "utf8")) as { agent_servers: Record<string, Record<string, unknown>> };
  config.agent_servers[name]!["additional_directories"] = [...directories];
  writeFileSync(file, JSON.stringify(config));
}

/** The `additionalDirectories` each request of `method` carried (undefined: no field). */
const sent = (w: ListWorld, agent: string, method: string) => w.received(agent).filter((e) => e.method === method).map((e) => e.params?.["additionalDirectories"]);
const workspaces = (w: ListWorld, agent: string) => w.received(agent).filter((e) => e.method === "argv/add-workspace").map((e) => e.params?.["directories"]);
const screen = (s: PtySession) => s.screenText().join("\n");

describe("Additional directories sent to the harness", () => {
  test("ACP: the harness advertises the capability, so session/new carries the list beside the cwd, and the status row shows +2 dirs after the session directory", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    const docs = w.dir("docs");
    w.configure({ fake: ["--scenario", "basic", "--additional-directories"] });
    const s = (session = w.start(["fake", "--add-dir", "../lib", "--add-dir", docs], { cwd: app, cols: 120 }));
    await s.waitFor(READY, 20000);
    expect(sent(w, "fake", "session/new")).toEqual([[lib, docs]]);
    expect(statusRow(s)).toContain("+2 dirs");
    expect(statusRow(s).indexOf("app")).toBeLessThan(statusRow(s).indexOf("+2 dirs"));
  }, 40000);

  test("No directories: session/new carries no field and the status row has no dirs module", async () => {
    const w = listWorld();
    const app = w.dir("app");
    w.configure({ fake: ["--scenario", "basic", "--additional-directories"] });
    const s = (session = w.start(["fake"], { cwd: app, cols: 120 }));
    await s.waitFor(READY, 20000);
    expect(sent(w, "fake", "session/new")).toEqual([undefined]);
    expect(statusRow(s)).not.toContain("dir");
  }, 40000);

  test("Auggie with two directories: --add-workspace per directory after its own arguments, and no request carries the ACP field even when the harness advertises it", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    const docs = w.dir("docs");
    w.configure({ auggie: ["--scenario", "basic", "--additional-directories"] });
    withTemplate(w, "auggie");
    const s = (session = w.start(["--add-dir", "../lib", "--add-dir", docs], { cwd: app, cols: 120 }));
    await s.waitFor(READY, 20000);
    expect(workspaces(w, "auggie")).toEqual([[lib, docs]]);
    expect(sent(w, "auggie", "session/new")).toEqual([undefined]);
    expect(statusRow(s)).toContain("+2 dirs");
  }, 40000);

  test("Harness that ignores them: the prompt box's border says so once, the session starts and no request carries the field", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    w.configure({ fake: ["--scenario", "basic"] });
    const s = (session = w.start(["fake", "--add-dir", lib], { cwd: app, cols: 200 }));
    await s.waitFor((p) => screen(p).includes("fake ignores additional directories (it does not support them)"), 20000);
    await s.waitFor(READY, 5000);
    expect(sent(w, "fake", "session/new")).toEqual([undefined]);
    expect(workspaces(w, "fake")).toEqual([]);
    // Nothing was delivered, so the status row does not claim a directory.
    expect(statusRow(s)).not.toContain("+1 dir");
  }, 40000);

  test("The harness entry's directories apply to every session of that harness: they reach session/new, a missing one left out", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const shared = w.dir("shared");
    w.configure({ fake: ["--scenario", "basic", "--additional-directories"] });
    withEntryDirectories(w, "fake", [shared, join(w.base, "nosuch")]);
    const s = (session = w.start(["fake"], { cwd: app, cols: 200 }));
    await s.waitFor(READY, 20000);
    expect(sent(w, "fake", "session/new")).toEqual([[shared]]);
    expect(statusRow(s)).toContain("+1 dir");
  }, 40000);

  test("Another harness's directories: a harness that cannot take directories starts with no notice and none sent", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const shared = w.dir("shared");
    w.configure({ fake: ["--scenario", "basic"], auggie: ["--scenario", "basic"] });
    withTemplate(w, "auggie");
    withEntryDirectories(w, "auggie", [shared]);
    const s = (session = w.start(["fake"], { cwd: app, cols: 200 }));
    await s.waitFor(READY, 20000);
    expect(sent(w, "fake", "session/new")).toEqual([undefined]);
    expect(workspaces(w, "fake")).toEqual([]);
    expect(screen(s)).not.toContain("ignores additional directories");
    expect(statusRow(s)).not.toContain("dir");
  }, 40000);

  test("A top-level additional_directories in the user's file is a configuration problem and is not sent", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const shared = w.dir("shared");
    w.configure({ fake: ["--scenario", "basic", "--additional-directories"] }, { additional_directories: [shared] });
    const s = (session = w.start(["fake"], { cwd: app, cols: 200 }));
    await s.waitFor(READY, 20000);
    expect(sent(w, "fake", "session/new")).toEqual([undefined]);
    expect(statusRow(s)).toContain("config 1");
  }, 40000);
});

describe("Additional directories in a project file", () => {
  test("Sibling repository: ../lib is added, and one notice names it and the project file", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    writeFileSync(join(app, ".acp-tui.jsonc"), JSON.stringify({ additional_directories: ["../lib"] }));
    w.configure({ fake: ["--scenario", "basic", "--additional-directories"] });
    const s = (session = w.start(["fake"], { cwd: app, cols: 220 }));
    await s.waitFor((p) => screen(p).includes(".acp-tui.jsonc adds an additional directory"), 20000);
    expect(screen(s)).toContain(lib);
    await s.waitFor(READY, 5000);
    expect(sent(w, "fake", "session/new")).toEqual([[lib]]);
  }, 40000);

  test("A project file naming a directory outside its limits: the entry is not added and a problem is reported", async () => {
    const w = listWorld();
    const app = w.dir("app");
    w.dir("lib");
    writeFileSync(join(app, ".acp-tui.jsonc"), JSON.stringify({ additional_directories: ["/"] }));
    w.configure({ fake: ["--scenario", "basic", "--additional-directories"] });
    const s = (session = w.start(["fake"], { cwd: app, cols: 200 }));
    await s.waitFor(READY, 20000);
    expect(sent(w, "fake", "session/new")).toEqual([undefined]);
    // The refusal is a configuration problem, counted in the status row.
    expect(statusRow(s)).toContain("config 1");
  }, 40000);
});

describe("Additional directories kept with the session", () => {
  test("Recorded on the first prompt: an --add-dir directory is in the index entry, the configuration's is not", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    const shared = w.dir("shared");
    w.configure({ fake: ["--scenario", "basic", "--additional-directories"] });
    withEntryDirectories(w, "fake", [shared]);
    const s = (session = w.start(["fake", "--add-dir", lib], { cwd: app, cols: 120 }));
    await s.waitFor(READY, 20000);
    s.sendKeys({ text: "hello" });
    s.sendKeys("Enter");
    await s.waitFor(() => w.index().listAll().length === 1, 15000);
    expect(w.index().listAll()[0]!.addedDirectories).toEqual([lib]);
  }, 40000);

  test("Resumed with its directory: acp-tui --resume <id> with no --add-dir sends the configuration's, then the recorded directory", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    const shared = w.dir("shared");
    const fixture = w.sessions("store", [{ sessionId: "s-1", cwd: app, title: "Earlier" }]);
    w.configure({ fake: ["--scenario", "copy-fixtures", "--additional-directories", "--load", "--sessions", fixture] });
    withEntryDirectories(w, "fake", [shared]);
    w.record({ agent: "fake", sessionId: "s-1", directory: app, title: "Earlier", addedDirectories: [lib] });
    const s = (session = w.start(["fake", "--resume", "s-1"], { cwd: w.base, cols: 120 }));
    await s.waitFor(READY, 20000);
    expect(sent(w, "fake", "session/load")).toEqual([[shared, lib]]);
    expect(statusRow(s)).toContain("+2 dirs");
  }, 40000);

  test("Directory gone: the session opens without it and a notice names it as no longer there", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    const fixture = w.sessions("store", [{ sessionId: "s-1", cwd: app, title: "Earlier" }]);
    w.configure({ fake: ["--scenario", "copy-fixtures", "--additional-directories", "--load", "--sessions", fixture] });
    w.record({ agent: "fake", sessionId: "s-1", directory: app, title: "Earlier", addedDirectories: [lib] });
    rmSync(lib, { recursive: true });
    const s = (session = w.start(["fake", "--resume", "s-1"], { cwd: w.base, cols: 200 }));
    await s.waitFor((p) => screen(p).includes("is no longer there"), 20000);
    expect(screen(s)).toContain(lib);
    await s.waitFor(READY, 10000);
    expect(sent(w, "fake", "session/load")).toEqual([undefined]);
  }, 40000);

  test("Different lists, different processes: opening from the list a session recorded with a directory launches auggie again with --add-workspace, the old process detached", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    const fixture = w.sessions("store", [{ sessionId: "s-1", cwd: app, title: "Needs lib" }]);
    w.configure({ auggie: ["--scenario", "copy-fixtures", "--load", "--sessions", fixture] });
    withTemplate(w, "auggie");
    w.record({ agent: "auggie", sessionId: "s-1", directory: app, title: "Needs lib", addedDirectories: [lib] });
    const s = (session = w.start(["--resume"], { cwd: app, cols: 120 }));
    await s.waitFor(() => listRows(s).length > 0 && listBody(s).some((r) => r.includes("Needs lib")), 20000);
    expect(w.events("agent_launched")).toHaveLength(1);
    expect(workspaces(w, "auggie")).toEqual([]);
    s.sendKeys({ text: "Needs lib" });
    await s.waitFor(() => (listBody(s)[1] ?? "").startsWith("Needs lib"), 5000);
    s.sendKeys("Enter");
    await s.waitFor(() => w.events("agent_launched").length === 2, 20000);
    await s.waitFor(() => listRows(s).length === 0 && statusRow(s).includes("+1 dir"), 20000);
    expect(workspaces(w, "auggie")).toEqual([[lib]]);
    expect(w.received("auggie").filter((e) => e.method === "session/load")).toHaveLength(1);
    // The first process is detached: its stdin was closed and it ended.
    const first = w.events("agent_launched")[0]!["pid"] as number;
    const running = () => {
      try {
        process.kill(first, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 100 && running(); i++) await Bun.sleep(50);
    expect(running()).toBe(false);
  }, 60000);
  test("--continue finds a recorded session whose directories change the command: auggie is launched again with them, the first process ended", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    const fixture = w.sessions("store", [{ sessionId: "s-1", cwd: app, title: "Needs lib" }]);
    w.configure({ auggie: ["--scenario", "copy-fixtures", "--load", "--sessions", fixture] });
    withTemplate(w, "auggie");
    w.record({ agent: "auggie", sessionId: "s-1", directory: app, title: "Needs lib", addedDirectories: [lib] });
    const s = (session = w.start(["--continue"], { cwd: app, cols: 120 }));
    await s.waitFor((p) => statusRow(p).includes("+1 dir"), 20000);
    expect(w.events("agent_launched")).toHaveLength(2);
    expect(workspaces(w, "auggie")).toEqual([[lib]]);
    expect(w.received("auggie").filter((e) => e.method === "session/load")).toHaveLength(1);
  }, 60000);
});
