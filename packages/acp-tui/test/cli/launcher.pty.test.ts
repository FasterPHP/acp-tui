// mvp-configuration task 10.1: the package's launcher (packages/acp-tui/bin/acp-tui, design D15).
// It resolves its own real path (also through a symlink), finds bun on the PATH or in
// ~/.bun/bin, and passes every argument on unchanged, including the user's own `--`: the PTY
// reaches the first frame with `-- bun fake-agent --scenario basic`, and `--mouse off` before
// the `--` reaches acp-tui's option parser (the `screen_options` log event). With no bun
// anywhere it says so on stderr and exits 127.
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startPty, type PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const LAUNCHER = join(ROOT, "packages/acp-tui/bin/acp-tui");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");

let session: PtySession | null = null;
const temporary: string[] = [];
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-launcher-")));
  temporary.push(dir);
  return dir;
}

function launch(args: string[], launcher = LAUNCHER): { s: PtySession; log: string } {
  const dir = scratch();
  const log = join(dir, "acp-tui.log");
  session = startPty([launcher, ...args], {
    cols: 100,
    rows: 30,
    cwd: dir,
    env: {
      ACP_TUI_LOG: log,
      XDG_CONFIG_HOME: join(dir, "config"),
      XDG_STATE_HOME: join(dir, "state"),
    },
  });
  return { s: session, log };
}

function screenOptions(log: string): Record<string, unknown> | undefined {
  if (!existsSync(log)) return undefined;
  return readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((e) => e["event"] === "screen_options");
}

/** A directory holding links to just the named programs, to use as a PATH. */
function pathWith(programs: string[]): string {
  const dir = join(scratch(), "bin");
  mkdirSync(dir);
  for (const program of programs) {
    const found = Bun.which(program);
    if (!found) throw new Error(`${program} is not installed`);
    symlinkSync(found, join(dir, program));
  }
  return dir;
}

async function runWithout(env: Record<string, string>): Promise<{ code: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn([LAUNCHER, "--help"], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

describe("the package launcher (packages/acp-tui/bin/acp-tui)", () => {
  test("is an executable POSIX sh script", () => {
    expect(statSync(LAUNCHER).mode & 0o111).toBe(0o111);
    expect(readFileSync(LAUNCHER, "utf8").split("\n")[0]).toBe("#!/bin/sh");
  });

  test("the user's own `--` reaches acp-tui: the agent command after it starts and the first frame appears", async () => {
    const { s, log } = launch(["--", "bun", FAKE_AGENT, "--scenario", "basic", "--delay-scale", "0"]);
    await s.waitFor(READY, 20000);
    expect(s.term.buffer.active.type).toBe("alternate");
    expect(screenOptions(log)).toBeDefined();
  }, 40000);

  test("--mouse off before the `--` reaches acp-tui's option parser", async () => {
    const { s, log } = launch(["--mouse", "off", "--", "bun", FAKE_AGENT, "--scenario", "basic", "--delay-scale", "0"]);
    await s.waitFor(READY, 20000);
    expect(screenOptions(log)?.["mouse"]).toBe("off");
  }, 40000);

  test("runs through a symlink to it", async () => {
    const link = join(scratch(), "acp-tui-link");
    symlinkSync(LAUNCHER, link);
    const { s } = launch(["--", "bun", FAKE_AGENT, "--scenario", "basic", "--delay-scale", "0"], link);
    await s.waitFor(READY, 20000);
    expect(s.term.buffer.active.type).toBe("alternate");
  }, 40000);

  test("finds bun in ~/.bun/bin when the PATH lacks it", async () => {
    const home = scratch();
    mkdirSync(join(home, ".bun/bin"), { recursive: true });
    symlinkSync(process.execPath, join(home, ".bun/bin/bun"));
    const result = await runWithout({ PATH: pathWith(["dirname", "readlink"]), HOME: home });
    expect(result.stderr).not.toContain("bun was not found");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage:");
  }, 40000);

  test("with no bun on the PATH or in ~/.bun/bin: a message on stderr and exit 127", async () => {
    const result = await runWithout({ PATH: pathWith(["dirname", "readlink"]), HOME: scratch() });
    expect(result.code).toBe(127);
    expect(result.stderr).toContain("acp-tui: bun was not found");
    expect(result.stdout).toBe("");
  }, 20000);
});
