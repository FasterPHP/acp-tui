// mvp-configuration task 10.2: `bun run install-cli` (packages/acp-tui/scripts/install-cli.ts,
// design D15, spec tui-config "Installed command"). Every test installs into a temporary
// directory under a temporary HOME: nothing here touches the real ~/.local/bin. The install also
// creates the configuration file (Marcus, 13 October 2026), so every run here drops an inherited
// XDG_CONFIG_HOME: the file lands under the temporary HOME, or under a temporary XDG_CONFIG_HOME
// a test sets, never in the real ~/.config.
import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { startPty, type PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { classify, MARKER, renderStub, shellQuote } from "../../scripts/install-cli.ts";
import { commentedDefault } from "../../src/config/default-file.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const SCRIPT = join(ROOT, "packages/acp-tui/scripts/install-cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");

/** The phase-1a launcher as Marcus copied it into ~/.local/bin (its first lines are the header
 *  the installer recognises). */
const PHASE_1A_LAUNCHER = `#!/usr/bin/env bash
# Launcher for acp-tui: the \`acp-tui\` command on the PATH and the PhpStorm "AI Agents" menu
# entry (spike S8), which runs the binary named "acp-tui" with no arguments in the project
# directory. Install by copying this file (a copy, not a symlink) to ~/.local/bin/acp-tui.
set -euo pipefail
exec bun "\${ACP_TUI_ROOT:-/nowhere}/packages/acp-tui/src/cli.ts" -- "$@"
`;

const temporary: string[] = [];
let session: PtySession | null = null;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = null;
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(name = "acp-tui-install-"): string {
  const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), name)));
  temporary.push(dir);
  return dir;
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<Result> {
  const { XDG_CONFIG_HOME: _inherited, ...inherited } = process.env;
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: { ...inherited, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

/** Runs the installer script with a temporary HOME and a PATH that includes `dir` unless told otherwise. */
function install(
  args: string[],
  home: string,
  opts: { script?: string; pathDirs?: string[]; cwd?: string; env?: Record<string, string> } = {},
): Promise<Result> {
  const path = [...(opts.pathDirs ?? []), process.env["PATH"] ?? ""].join(delimiter);
  return run(["bun", opts.script ?? SCRIPT, ...args], { cwd: opts.cwd, env: { HOME: home, PATH: path, ...opts.env } });
}

/** The configuration file acp-tui reads under a HOME with no XDG_CONFIG_HOME. */
const configIn = (home: string): string => join(home, ".config/acp-tui/config.jsonc");

describe("install-cli", () => {
  test("Installed and used: through `bun run install-cli`, then from another directory with the user's own `--`", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    const result = await run(["bun", "run", "install-cli", "--dir", bin], { cwd: ROOT, env: { HOME: home } });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`installed ${join(bin, "acp-tui")}`);

    const stub = join(bin, "acp-tui");
    expect(lstatSync(stub).isFile()).toBe(true);
    expect(statSync(stub).mode & 0o777).toBe(0o755);
    const text = readFileSync(stub, "utf8");
    expect(text).toContain(MARKER);
    expect(text).toContain(ROOT);
    expect(classify(text)).toBe("stub");

    const elsewhere = scratch("acp-tui-elsewhere-");
    session = startPty([stub, "--", "bun", FAKE_AGENT, "--scenario", "basic", "--delay-scale", "0"], {
      cols: 100,
      rows: 30,
      cwd: elsewhere,
      env: {
        HOME: home,
        ACP_TUI_LOG: join(elsewhere, "acp-tui.log"),
        XDG_CONFIG_HOME: join(elsewhere, "config"),
        XDG_STATE_HOME: join(elsewhere, "state"),
      },
    });
    await session.waitFor(READY, 20000);
    expect(session.term.buffer.active.type).toBe("alternate");
  }, 60000);

  test("Pull without reinstall: a commit made after the install is run by the next `acp-tui`", async () => {
    // A real launcher and installer in a throw-away git checkout (its directory name has a space
    // and a quote, to test the stub's quoting), with a one-line stand-in for cli.ts.
    const checkout = join(scratch(), "it's a checkout");
    const pkg = join(checkout, "packages/acp-tui");
    for (const dir of ["bin", "scripts", "src"]) mkdirSync(join(pkg, dir), { recursive: true });
    copyFileSync(join(ROOT, "packages/acp-tui/bin/acp-tui"), join(pkg, "bin/acp-tui"));
    chmodSync(join(pkg, "bin/acp-tui"), 0o755);
    copyFileSync(SCRIPT, join(pkg, "scripts/install-cli.ts"));
    // The configuration modules the installer imports, from this checkout (their own imports
    // resolve from the link's target).
    symlinkSync(join(ROOT, "packages/acp-tui/src/config"), join(pkg, "src/config"));
    writeFileSync(join(pkg, "src/cli.ts"), 'console.log("code one:", process.argv.slice(2).join(" "));\n');
    const git = (...args: string[]) => run(["git", ...args], { cwd: checkout });
    expect((await git("init", "-q")).code).toBe(0);
    await git("add", ".");
    const commit = (message: string) => git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", message);
    expect((await commit("one")).code).toBe(0);

    const home = scratch();
    const bin = join(home, "bin");
    const installed = await install(["--dir", bin], home, { script: join(pkg, "scripts/install-cli.ts") });
    expect(installed.code).toBe(0);
    expect(readFileSync(configIn(home), "utf8")).toBe(commentedDefault());
    expect(readFileSync(join(bin, "acp-tui"), "utf8")).toContain(shellQuote(checkout));

    const first = await run([join(bin, "acp-tui"), "a", "--", "b"], { env: { HOME: home } });
    expect(first.stdout).toBe("code one: a -- b\n");

    writeFileSync(join(pkg, "src/cli.ts"), 'console.log("code two:", process.argv.slice(2).join(" "));\n');
    await git("add", ".");
    expect((await commit("two")).code).toBe(0);

    const second = await run([join(bin, "acp-tui"), "a", "--", "b"], { env: { HOME: home } });
    expect(second.stdout).toBe("code two: a -- b\n");
  }, 60000);

  test("a stub whose checkout has moved says to rerun install-cli and exits 127; ACP_TUI_ROOT overrides the path", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    expect((await install(["--dir", bin], home)).code).toBe(0);
    const gone = await run([join(bin, "acp-tui")], { env: { HOME: home, ACP_TUI_ROOT: join(home, "moved") } });
    expect(gone.code).toBe(127);
    expect(gone.stderr).toContain("bun run install-cli");
    expect(gone.stderr).toContain(join(home, "moved/packages/acp-tui/bin/acp-tui"));

    const help = await run([join(bin, "acp-tui"), "--help"], { env: { HOME: home, ACP_TUI_ROOT: ROOT } });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage:");
  }, 30000);

  test("Foreign file kept: nothing changes and the message names --force; --force replaces it", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    mkdirSync(bin);
    const target = join(bin, "acp-tui");
    writeFileSync(target, "#!/bin/sh\necho mine\n");
    chmodSync(target, 0o755);

    const refused = await install(["--dir", bin], home);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("--force");
    expect(readFileSync(target, "utf8")).toBe("#!/bin/sh\necho mine\n");

    const forced = await install(["--dir", bin, "--force"], home);
    expect(forced.code).toBe(0);
    expect(classify(readFileSync(target, "utf8"))).toBe("stub");
  }, 30000);

  test("Foreign file kept: a symlink in the way is foreign too, and --force replaces the link, not its destination", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    mkdirSync(bin);
    const destination = join(home, "elsewhere.sh");
    writeFileSync(destination, "#!/bin/sh\necho elsewhere\n");
    symlinkSync(destination, join(bin, "acp-tui"));

    expect((await install(["--dir", bin], home)).code).toBe(1);
    expect(lstatSync(join(bin, "acp-tui")).isSymbolicLink()).toBe(true);

    expect((await install(["--dir", bin, "--force"], home)).code).toBe(0);
    expect(lstatSync(join(bin, "acp-tui")).isFile()).toBe(true);
    expect(readFileSync(destination, "utf8")).toBe("#!/bin/sh\necho elsewhere\n");
  }, 30000);

  test("the phase-1a launcher is replaced without --force; installing again over its own stub is fine", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    mkdirSync(bin);
    const target = join(bin, "acp-tui");
    writeFileSync(target, PHASE_1A_LAUNCHER);
    chmodSync(target, 0o755);

    const replaced = await install(["--dir", bin], home);
    expect(replaced.code).toBe(0);
    expect(replaced.stdout).toContain("replacing the phase-1a launcher");
    expect(classify(readFileSync(target, "utf8"))).toBe("stub");

    const again = await install(["--dir", bin], home);
    expect(again.code).toBe(0);
    expect(classify(readFileSync(target, "utf8"))).toBe("stub");
  }, 30000);

  test("--uninstall removes only its own stub", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    expect((await install(["--dir", bin], home)).code).toBe(0);
    const removed = await install(["--uninstall", "--dir", bin], home);
    expect(removed.code).toBe(0);
    expect(existsSync(join(bin, "acp-tui"))).toBe(false);

    const again = await install(["--uninstall", "--dir", bin], home);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("nothing to remove");

    for (const content of ["#!/bin/sh\necho mine\n", PHASE_1A_LAUNCHER]) {
      writeFileSync(join(bin, "acp-tui"), content);
      const kept = await install(["--uninstall", "--dir", bin], home);
      expect(kept.code).toBe(1);
      expect(kept.stderr).toContain("was not written by install-cli");
      expect(readFileSync(join(bin, "acp-tui"), "utf8")).toBe(content);
    }
  }, 30000);

  test("warns when the directory is not on the PATH, and not when it is", async () => {
    const home = scratch();
    const off = join(home, "off-path");
    const on = join(home, "on-path");
    mkdirSync(on);

    const warned = await run(["bun", SCRIPT, "--dir", off], { env: { HOME: home, PATH: process.env["PATH"] ?? "" } });
    expect(warned.code).toBe(0);
    expect(warned.stderr).toContain("is not on your PATH");

    const quiet = await install(["--dir", on], home, { pathDirs: [on] });
    expect(quiet.code).toBe(0);
    expect(quiet.stderr).toBe("");
  }, 30000);

  test("defaults to ~/.local/bin of HOME, creating it", async () => {
    const home = scratch();
    const result = await install([], home);
    expect(result.code).toBe(0);
    expect(classify(readFileSync(join(home, ".local/bin/acp-tui"), "utf8"))).toBe("stub");
  }, 30000);

  test("bad arguments exit 2 and write nothing", async () => {
    const home = scratch();
    const result = await install(["--dir"], home);
    expect(result.code).toBe(2);
    expect((await install(["--nope"], home)).code).toBe(2);
    expect(existsSync(join(home, ".local"))).toBe(false);
  }, 30000);

  test("Configuration created on install: the commented default under ~/.config, owner-only, and the path printed", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    const result = await install(["--dir", bin], home);
    expect(result.code).toBe(0);
    const file = configIn(home);
    expect(readFileSync(file, "utf8")).toBe(commentedDefault());
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, ".config/acp-tui")).mode & 0o777).toBe(0o700);
    expect(result.stdout).toContain(`created ${file}`);

    // What it wrote is what `acp-tui config --print-default` prints, and it checks clean.
    const printed = await run([join(bin, "acp-tui"), "config", "--print-default"], { env: { HOME: home } });
    expect(printed.stdout).toBe(readFileSync(file, "utf8"));
    const checked = await run([join(bin, "acp-tui"), "config", "--check"], { cwd: home, env: { HOME: home } });
    expect(checked.code).toBe(0);
  }, 30000);

  test("Configuration created on install: at $XDG_CONFIG_HOME when it is absolute, under ~/.config when it is not", async () => {
    const home = scratch();
    const xdg = join(scratch("acp-tui-xdg-"), "nested/config");
    const absolute = await install(["--dir", join(home, "bin")], home, { env: { XDG_CONFIG_HOME: xdg } });
    expect(absolute.code).toBe(0);
    expect(readFileSync(join(xdg, "acp-tui/config.jsonc"), "utf8")).toBe(commentedDefault());
    expect(absolute.stdout).toContain(`created ${join(xdg, "acp-tui/config.jsonc")}`);
    expect(existsSync(join(home, ".config"))).toBe(false);

    const relative = await install(["--dir", join(home, "bin")], home, { env: { XDG_CONFIG_HOME: "relative/config" } });
    expect(relative.code).toBe(0);
    expect(readFileSync(configIn(home), "utf8")).toBe(commentedDefault());
  }, 30000);

  test("Existing configuration kept: never overwritten, not with --force, and not written through a symlink", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    const file = configIn(home);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ "mouse": "off" }\n');

    for (const args of [["--dir", bin], ["--dir", bin, "--force"]]) {
      const result = await install(args, home);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`kept the existing configuration ${file}`);
      expect(readFileSync(file, "utf8")).toBe('{ "mouse": "off" }\n');
    }

    // A dangling symlink at the path is the user's too: its destination is not created.
    const other = scratch();
    const destination = join(other, "elsewhere.jsonc");
    mkdirSync(dirname(configIn(other)), { recursive: true });
    symlinkSync(destination, configIn(other));
    const linked = await install(["--dir", join(other, "bin")], other);
    expect(linked.code).toBe(0);
    expect(linked.stdout).toContain("kept the existing configuration");
    expect(existsSync(destination)).toBe(false);
  }, 30000);

  test("Uninstall keeps the configuration", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    expect((await install(["--dir", bin], home)).code).toBe(0);
    writeFileSync(configIn(home), '{ "mouse": "wheel" }\n');
    const removed = await install(["--uninstall", "--dir", bin], home);
    expect(removed.code).toBe(0);
    expect(existsSync(join(bin, "acp-tui"))).toBe(false);
    expect(readFileSync(configIn(home), "utf8")).toBe('{ "mouse": "wheel" }\n');
  }, 30000);

  test("a configuration that cannot be created fails the install after the stub is written, saying so", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    writeFileSync(join(home, ".config"), "a file where the directory should be\n");
    const result = await install(["--dir", bin], home);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("the command is installed, but the configuration file was not created");
    expect(classify(readFileSync(join(bin, "acp-tui"), "utf8"))).toBe("stub");
  }, 30000);

  test("the stub text: a regular sh script that quotes the root and keeps the marker on line 2", () => {
    const stub = renderStub("/a b/it's");
    expect(stub.split("\n").slice(0, 2)).toEqual(["#!/bin/sh", MARKER]);
    expect(stub).toContain(`'/a b/it'\\''s'`);
  });
});
