// harness-feedback task group 7 under a PTY against fake-agent (spec tui-palette "Adding a
// directory during a session", "Directory typed"): `/add-dir <path>` typed in the prompt box, the
// palette entry, the ACP route (resume without replay, load for a harness without resume), the
// restart a template harness asks for, and the refusals. fake-agent logs every request, and
// acp-tui's debug log names each process it launches.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PtySession } from "../pty/harness.ts";
import { promptText, READY, RUNNING, statusRow } from "../pty/regions.ts";
import { listWorld, type ListWorld } from "./list-world.ts";

let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
});

const screen = (s: PtySession) => s.screenText().join("\n");
const methods = (w: ListWorld, agent: string, method: string) => w.received(agent).filter((e) => e.method === method);

/** Adds `additional_directory_args` to the configured entry `name`, as an Auggie entry would carry it. */
function withTemplate(w: ListWorld, name: string): void {
  const file = join(w.env["XDG_CONFIG_HOME"]!, "acp-tui", "config.jsonc");
  const config = JSON.parse(readFileSync(file, "utf8")) as { agent_servers: Record<string, Record<string, unknown>> };
  config.agent_servers[name]!["additional_directory_args"] = ["--add-workspace", "{dir}"];
  writeFileSync(file, JSON.stringify(config));
}

/** Sends a first prompt and waits for the whole reply, so the session is recorded and idle. */
async function firstTurn(s: PtySession): Promise<void> {
  await s.waitFor(READY, 20000);
  await typeCommand(s, "hello");
  await s.waitFor((p) => screen(p).includes("third item"), 20000);
  await s.waitFor(READY, 10000);
}

/** Types a draft and sends it. A draft starting with `/` is typed as the menu allows: `/` opens the
 *  slash menu, Esc leaves it as text, and the rest follows. */
async function typeCommand(s: PtySession, text: string): Promise<void> {
  if (text.startsWith("/")) {
    s.sendKeys({ text: "/" });
    await s.waitFor((p) => screen(p).includes("Slash commands"), 5000);
    s.sendKeys("Esc");
    await s.waitFor((p) => !screen(p).includes("Slash commands") && promptText(p).join("").trim() === "/", 5000);
    s.sendKeys({ text: text.slice(1) });
  } else s.sendKeys({ text });
  s.sendKeys("Enter");
}

describe("Adding a directory during a session", () => {
  test("Harness with the capability: session/resume carries the list, no prompt is sent, the conversation stays, the dirs module reads +1 dir and the index records it", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--additional-directories", "--resume", "--load"] });
    const s = (session = w.start(["fake"], { cwd: app, cols: 200 }));
    await firstTurn(s);
    expect(statusRow(s)).not.toContain("dir");
    await typeCommand(s, "/add-dir ../lib");
    await s.waitFor((p) => statusRow(p).includes("+1 dir"), 20000);
    const resumes = methods(w, "fake", "session/resume");
    expect(resumes).toHaveLength(1);
    expect(resumes[0]!.params).toMatchObject({ cwd: app, additionalDirectories: [lib] });
    expect(methods(w, "fake", "session/prompt")).toHaveLength(1);
    expect(methods(w, "fake", "session/load")).toHaveLength(0);
    expect(w.events("agent_launched")).toHaveLength(1);
    // Nothing replayed: the earlier turn is still drawn, once.
    expect(screen(s).split("third item").length - 1).toBe(1);
    await s.waitFor((p) => screen(p).includes("added") && screen(p).includes("to the session"), 5000);
    // The command was not sent as a prompt, and the draft is gone.
    expect(promptText(s).join("")).not.toContain("/add-dir");
    await s.waitFor(() => w.index().listAll()[0]?.addedDirectories?.[0] === lib, 5000);
  }, 60000);

  test("Load-only harness: session/load carries the list on the same process, and the replay rebuilds the conversation", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--additional-directories", "--load"] });
    const s = (session = w.start(["fake"], { cwd: app, cols: 200 }));
    await firstTurn(s);
    await typeCommand(s, "/add-dir ../lib");
    await s.waitFor((p) => statusRow(p).includes("+1 dir"), 20000);
    expect(methods(w, "fake", "session/resume")).toHaveLength(0);
    const loads = methods(w, "fake", "session/load");
    expect(loads).toHaveLength(1);
    expect(loads[0]!.params).toMatchObject({ cwd: app, additionalDirectories: [lib] });
    expect(w.events("agent_launched")).toHaveLength(1);
    await s.waitFor((p) => screen(p).includes("third item") && READY.test(statusRow(p)), 20000);
    expect(screen(s).split("third item").length - 1).toBe(1);
    expect(methods(w, "fake", "session/prompt")).toHaveLength(1);
  }, 60000);

  test("Resume after /add-dir carries the directory: --resume <id> with no --add-dir sends the recorded one", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    const store = join(w.base, "store.json");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--additional-directories", "--resume", "--load", "--sessions", store, "--persist"] });
    const first = (session = w.start(["fake"], { cwd: app, cols: 200 }));
    await firstTurn(first);
    await typeCommand(first, "/add-dir ../lib");
    await first.waitFor(() => w.index().listAll()[0]?.addedDirectories?.[0] === lib, 20000);
    const id = w.index().listAll()[0]!.sessionId;
    first.kill("SIGTERM");
    await first.dispose();
    const second = (session = w.start(["fake", "--resume", id], { cwd: w.base, cols: 200 }));
    await second.waitFor((p) => statusRow(p).includes("+1 dir"), 20000);
    const loads = methods(w, "fake", "session/load");
    expect(loads.at(-1)!.params).toMatchObject({ sessionId: id, additionalDirectories: [lib] });
  }, 90000);

  test("Harness that must restart: a list offers the restart or cancelling; confirmed, a new process gets --add-workspace, the session is loaded on it and the old process ends", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    const store = join(w.base, "store.json");
    w.configure({ auggie: ["--scenario", "copy-fixtures", "--load", "--sessions", store, "--persist"] });
    withTemplate(w, "auggie");
    const s = (session = w.start([], { cwd: app, cols: 200 }));
    await firstTurn(s);
    expect(w.events("agent_launched")).toHaveLength(1);
    await typeCommand(s, "/add-dir ../lib");
    await s.waitFor((p) => screen(p).includes("Restart auggie with") && screen(p).includes("and reopen this session") && screen(p).includes("Cancel"), 10000);
    expect(screen(s)).toContain(lib);
    // Nothing is launched until the choice is made.
    expect(w.events("agent_launched")).toHaveLength(1);
    s.sendKeys("Enter");
    await s.waitFor(() => w.events("agent_launched").length === 2, 20000);
    await s.waitFor((p) => statusRow(p).includes("+1 dir"), 20000);
    expect(methods(w, "auggie", "argv/add-workspace").map((e) => e.params?.["directories"])).toEqual([[lib]]);
    expect(methods(w, "auggie", "session/load")).toHaveLength(1);
    expect(methods(w, "auggie", "session/load")[0]!.params?.["additionalDirectories"]).toBeUndefined();
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
    await s.waitFor((p) => screen(p).includes("third item") && READY.test(statusRow(p)), 20000);
  }, 90000);

  test("Cancelling the restart: the list closes, nothing is launched and the session goes on", async () => {
    const w = listWorld();
    const app = w.dir("app");
    w.dir("lib");
    const store = join(w.base, "store.json");
    w.configure({ auggie: ["--scenario", "copy-fixtures", "--load", "--sessions", store, "--persist"] });
    withTemplate(w, "auggie");
    const s = (session = w.start([], { cwd: app, cols: 200 }));
    await firstTurn(s);
    await typeCommand(s, "/add-dir ../lib");
    await s.waitFor((p) => screen(p).includes("Restart auggie with"), 10000);
    s.sendKeys("Down", "Enter");
    await s.waitFor((p) => !screen(p).includes("Restart auggie with"), 5000);
    await Bun.sleep(300);
    expect(w.events("agent_launched")).toHaveLength(1);
    expect(statusRow(s)).not.toContain("dir");
    expect(methods(w, "auggie", "session/load")).toHaveLength(0);
  }, 60000);

  test("Esc closes the restart list as Cancel does", async () => {
    const w = listWorld();
    const app = w.dir("app");
    w.dir("lib");
    const store = join(w.base, "store.json");
    w.configure({ auggie: ["--scenario", "copy-fixtures", "--load", "--sessions", store, "--persist"] });
    withTemplate(w, "auggie");
    const s = (session = w.start([], { cwd: app, cols: 200 }));
    await firstTurn(s);
    await typeCommand(s, "/add-dir ../lib");
    await s.waitFor((p) => screen(p).includes("Restart auggie with"), 10000);
    s.sendKeys("Esc");
    await s.waitFor((p) => !screen(p).includes("Restart auggie with"), 5000);
    await Bun.sleep(300);
    expect(w.events("agent_launched")).toHaveLength(1);
  }, 60000);

  test("During a turn: nothing is reopened and a notice says a directory can be added once the turn has ended", async () => {
    const w = listWorld();
    const app = w.dir("app");
    w.dir("lib");
    w.configure({ fake: ["--scenario", "slow-turn", "--long-gap", "--delay-scale", "1", "--additional-directories", "--resume", "--load"] });
    const s = (session = w.start(["fake"], { cwd: app, cols: 200 }));
    await s.waitFor(READY, 20000);
    await typeCommand(s, "go");
    await s.waitFor(RUNNING, 10000);
    await typeCommand(s, "/add-dir ../lib");
    await s.waitFor((p) => screen(p).includes("a directory can be added once the turn has ended"), 10000);
    expect(methods(w, "fake", "session/resume")).toHaveLength(0);
    expect(methods(w, "fake", "session/load")).toHaveLength(0);
    expect(statusRow(s)).not.toContain("dir");
  }, 60000);

  test("A path that is missing, one that is listed already, and a harness that takes no directories: each a notice, nothing sent", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--additional-directories", "--resume", "--load"], plain: ["--scenario", "copy-fixtures", "--resume", "--load"] });
    const s = (session = w.start(["fake", "--add-dir", lib], { cwd: app, cols: 200 }));
    await s.waitFor(READY, 20000);
    await typeCommand(s, "/add-dir ../nowhere");
    await s.waitFor((p) => screen(p).includes("is not a directory"), 10000);
    await typeCommand(s, "/add-dir ../lib");
    await s.waitFor((p) => screen(p).includes("is already in the session"), 10000);
    await typeCommand(s, "/add-dir .");
    await s.waitFor((p) => screen(p).split("is already in the session").length > 1, 10000);
    expect(methods(w, "fake", "session/resume")).toHaveLength(0);
    session.kill("SIGTERM");
    await session.dispose();
    const plain = (session = w.start(["plain"], { cwd: app, cols: 200 }));
    await plain.waitFor(READY, 20000);
    await typeCommand(plain, "/add-dir ../lib");
    await plain.waitFor((p) => screen(p).includes("plain ignores additional directories (it does not support them)"), 10000);
    expect(methods(w, "plain", "session/resume")).toHaveLength(0);
    expect(methods(w, "plain", "session/load")).toHaveLength(0);
  }, 90000);

  test("The palette's Add a directory… puts /add-dir in the prompt box for the path; the slash menu lists it", async () => {
    const w = listWorld();
    const app = w.dir("app");
    const lib = w.dir("lib");
    w.configure({ fake: ["--scenario", "copy-fixtures", "--additional-directories", "--resume", "--load"] });
    const s = (session = w.start(["fake"], { cwd: app, cols: 200 }));
    await s.waitFor(READY, 20000);
    s.sendKeys("Ctrl+P");
    await s.waitFor((p) => screen(p).includes("Add a directory…"), 10000);
    s.sendKeys({ text: "Add a dir" });
    await s.waitFor((p) => screen(p).includes("Add a directory…") && !screen(p).includes("Choose the model"), 5000);
    s.sendKeys("Enter");
    await s.waitFor((p) => promptText(p).join("").includes("/add-dir"), 10000);
    s.sendKeys({ text: lib });
    s.sendKeys("Enter");
    await s.waitFor((p) => statusRow(p).includes("+1 dir"), 20000);
    expect(methods(w, "fake", "session/resume")[0]!.params).toMatchObject({ additionalDirectories: [lib] });
    // The slash menu lists the command, and the palette now shows the count as its value.
    s.sendKeys({ text: "/" });
    await s.waitFor((p) => screen(p).includes("/add-dir"), 10000);
  }, 60000);
});
