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
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { startPty, type PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import {
  classify,
  CMD_MARKER,
  defaultDirectory,
  distConfigurationFile,
  distContent,
  DIST_FILE_NAME,
  main as installMain,
  MARKER,
  onPath,
  renderCmdStub,
  renderStub,
  shellQuote,
} from "../../scripts/install-cli.ts";
import { commentedDefault } from "../../src/config/default-file.ts";
import { WINDOWS } from "../windows.ts";
import { mergeEnvironment } from "../../src/agent/which.ts";

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
    // Merged as acp-tui merges a harness's environment: on Windows the test's PATH replaces the
    // inherited `Path` instead of standing beside it (which of the two a child reads is not fixed).
    env: mergeEnvironment(inherited, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", ...opts.env }),
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
  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Installed and used: through `bun run install-cli`, then from another directory with the user's own `--`", async () => {
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Pull without reinstall: a commit made after the install is run by the next `acp-tui`", async () => {
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
    symlinkSync(join(ROOT, "packages/acp-tui/src/platform"), join(pkg, "src/platform"));
    symlinkSync(join(ROOT, "packages/acp-tui/src/agent"), join(pkg, "src/agent"));
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("a stub whose checkout has moved says to rerun install-cli and exits 127; ACP_TUI_ROOT overrides the path", async () => {
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Foreign file kept: nothing changes and the message names --force; --force replaces it", async () => {
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Foreign file kept: a symlink in the way is foreign too, and --force replaces the link, not its destination", async () => {
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("the phase-1a launcher is replaced without --force; installing again over its own stub is fine", async () => {
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("--uninstall removes only its own stub", async () => {
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("defaults to ~/.local/bin of HOME, creating it", async () => {
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Configuration created on install: the commented default under ~/.config, owner-only, and the path printed", async () => {
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Configuration created on install: at $XDG_CONFIG_HOME when it is absolute, under ~/.config when it is not", async () => {
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Existing configuration kept: never overwritten, not with --force, and not written through a symlink", async () => {
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

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Uninstall keeps the configuration", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    expect((await install(["--dir", bin], home)).code).toBe(0);
    writeFileSync(configIn(home), '{ "mouse": "wheel" }\n');
    const removed = await install(["--uninstall", "--dir", bin], home);
    expect(removed.code).toBe(0);
    expect(existsSync(join(bin, "acp-tui"))).toBe(false);
    expect(readFileSync(configIn(home), "utf8")).toBe('{ "mouse": "wheel" }\n');
  }, 30000);

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("a configuration that cannot be created fails the install after the stub is written, saying so", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    writeFileSync(join(home, ".config"), "a file where the directory should be\n");
    const result = await install(["--dir", bin], home);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("the command is installed, but the configuration file was not created");
    expect(classify(readFileSync(join(bin, "acp-tui"), "utf8"))).toBe("stub");
  }, 30000);

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Dist file beside an existing configuration: config.jsonc unchanged, the header and the default written, owner-only, the path printed", async () => {
    const home = scratch();
    const file = configIn(home);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ "mouse": "off" }\n');
    const result = await install(["--dir", join(home, "bin")], home);
    expect(result.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe('{ "mouse": "off" }\n');
    const dist = join(dirname(file), DIST_FILE_NAME);
    const version = (JSON.parse(readFileSync(join(ROOT, "packages/acp-tui/package.json"), "utf8")) as { version: string }).version;
    expect(readFileSync(dist, "utf8")).toBe(
      `// The default configuration of acp-tui ${version}, written by install-cli on every install.\n` +
        "// It is never read. Compare it with config.jsonc to see new and changed settings\n" +
        "// (or run acp-tui config --diff-default).\n" +
        commentedDefault(),
    );
    expect(statSync(dist).mode & 0o777).toBe(0o600);
    expect(result.stdout).toContain(`install-cli: wrote ${dist}, the default configuration of this version, for comparison with your configuration\n`);
  }, 30000);

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Dist file on a first install: both files are written; the dist part after the default text is what --print-default prints", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    const result = await install(["--dir", bin], home);
    expect(result.code).toBe(0);
    const dist = readFileSync(join(home, ".config/acp-tui", DIST_FILE_NAME), "utf8");
    expect(readFileSync(configIn(home), "utf8")).toBe(commentedDefault());
    const printed = await run([join(bin, "acp-tui"), "config", "--print-default"], { env: { HOME: home } });
    expect(dist.split("\n").slice(3).join("\n")).toBe(printed.stdout);
    // The comparison it exists for: a fresh install differs from nothing.
    const diff = await run([join(bin, "acp-tui"), "config", "--diff-default"], { env: { HOME: home } });
    expect(diff.stdout).toBe("config.jsonc is the same as the default.\n");
    // The dist file is never read: acp-tui checks the configuration clean with it in place.
    expect((await run([join(bin, "acp-tui"), "config", "--check"], { cwd: home, env: { HOME: home } })).stdout).toBe("no configuration problems\n");
  }, 30000);

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Dist file replaced on the next install, with no temporary file left", async () => {
    const home = scratch();
    const dir = dirname(configIn(home));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, DIST_FILE_NAME), "// The default configuration of acp-tui 0.0.1, written by install-cli on every install.\n{}\n");
    const before = readdirSync(dir).sort();
    const result = await install(["--dir", join(home, "bin")], home);
    expect(result.code).toBe(0);
    const text = readFileSync(join(dir, DIST_FILE_NAME), "utf8");
    expect(text).not.toContain("0.0.1");
    expect(text.endsWith(commentedDefault())).toBe(true);
    expect(readdirSync(dir).sort()).toEqual([...before, "config.jsonc"].sort());
    // A second run changes nothing and leaves nothing behind either.
    expect((await install(["--dir", join(home, "bin")], home)).code).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(["config.dist.jsonc", "config.jsonc"]);
    expect(readFileSync(join(dir, DIST_FILE_NAME), "utf8")).toBe(text);
  }, 30000);

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Dist file that cannot be written: a directory at its path is left alone, a warning names it, the install exits 0", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    const dist = join(home, ".config/acp-tui", DIST_FILE_NAME);
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "keep"), "mine\n");
    const result = await install(["--dir", bin], home);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(`install-cli: warning: could not write ${dist}: `);
    expect(result.stdout).not.toContain("wrote");
    expect(lstatSync(dist).isDirectory()).toBe(true);
    expect(readFileSync(join(dist, "keep"), "utf8")).toBe("mine\n");
    expect(classify(readFileSync(join(bin, "acp-tui"), "utf8"))).toBe("stub");
    expect(readdirSync(dirname(dist)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  }, 30000);

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Dist file that is a symlink is left alone too, with a warning", async () => {
    const home = scratch();
    const dir = dirname(configIn(home));
    mkdirSync(dir, { recursive: true });
    const destination = join(home, "elsewhere.jsonc");
    writeFileSync(destination, "mine\n");
    symlinkSync(destination, join(dir, DIST_FILE_NAME));
    const result = await install(["--dir", join(home, "bin")], home);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("could not write");
    expect(lstatSync(join(dir, DIST_FILE_NAME)).isSymbolicLink()).toBe(true);
    expect(readFileSync(destination, "utf8")).toBe("mine\n");
  }, 30000);

  // Skipped on Windows: it installs or runs the POSIX sh stub, or checks real mode bits; the Windows .cmd stub is tested below with the platform injected.
  test.skipIf(WINDOWS)("Uninstall removes the dist file and keeps the configuration; a dist file of the user's own is kept", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    const dist = join(dirname(configIn(home)), DIST_FILE_NAME);
    expect((await install(["--dir", bin], home)).code).toBe(0);
    writeFileSync(configIn(home), '{ "mouse": "wheel" }\n');
    const removed = await install(["--uninstall", "--dir", bin], home);
    expect(removed.code).toBe(0);
    expect(existsSync(dist)).toBe(false);
    expect(readFileSync(configIn(home), "utf8")).toBe('{ "mouse": "wheel" }\n');

    expect((await install(["--dir", bin], home)).code).toBe(0);
    writeFileSync(dist, "// my own notes\n{}\n");
    expect((await install(["--uninstall", "--dir", bin], home)).code).toBe(0);
    expect(readFileSync(dist, "utf8")).toBe("// my own notes\n{}\n");
    expect(existsSync(join(bin, "acp-tui"))).toBe(false);
  }, 30000);

  test("the stub text: a regular sh script that quotes the root and keeps the marker on line 2", () => {
    const stub = renderStub("/a b/it's");
    expect(stub.split("\n").slice(0, 2)).toEqual(["#!/bin/sh", MARKER]);
    expect(stub).toContain(`'/a b/it'\\''s'`);
  });
});

// The Windows stub (design D1 of windows-support, spec tui-config "Installed command on Windows"),
// run here on any platform by injecting `win32` into the installer. The stub itself can only run on
// Windows; its end-to-end check is made there (windows-support task 4.2).
describe("install-cli on Windows (platform injected)", () => {
  const BUN = "C:\\Users\\Ann\\.bun\\bin\\bun.exe";
  const collect = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { stdout: (t: string) => void out.push(t), stderr: (t: string) => void err.push(t) } };
  };
  /** A HOME-less environment for the injected run: the configuration lands under a temporary XDG_CONFIG_HOME. */
  const winEnv = (home: string, extra: Record<string, string> = {}) => ({
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "config"),
    ...extra,
  });

  test("the stub text: CRLF, the rem marker on line 2, ACP_TUI_ROOT, the 127 check and Bun on cli.ts", () => {
    const stub = renderCmdStub("C:\\src\\acp-tui", BUN);
    expect(stub.includes("\n")).toBe(true);
    expect(stub.replaceAll("\r\n", "").includes("\n")).toBe(false);
    const lines = stub.split("\r\n");
    expect(lines.slice(0, 2)).toEqual(["@echo off", CMD_MARKER]);
    expect(CMD_MARKER).toBe(`rem ${MARKER.slice(2)}`);
    expect(lines).toContain('set "root=%ACP_TUI_ROOT%"');
    expect(lines).toContain('if not defined root set "root=C:\\src\\acp-tui"');
    expect(lines).toContain('if not exist "%root%\\packages\\acp-tui\\src\\cli.ts" goto :missing');
    expect(lines).toContain(`"${BUN}" "%root%\\packages\\acp-tui\\src\\cli.ts" -- %*`);
    const message = lines.find((line) => line.includes("was not found"))!;
    expect(message).toContain("(did the checkout move?)".replace("(", "^(").replace(")", "^)"));
    expect(message).toContain("rerun 'bun run install-cli' in the checkout");
    expect(lines).toContain("exit /b 127");
    expect(stub.endsWith("\r\n")).toBe(true);
  });

  test("the stub text: a root with % or parentheses is written so cmd reads it back unchanged", () => {
    const stub = renderCmdStub("C:\\Program Files (x86)\\100%\\acp-tui", BUN);
    expect(stub).toContain('set "root=C:\\Program Files (x86)\\100%%\\acp-tui"');
    // No parenthesised block that an expanded ")" could close early.
    expect(stub.split("\r\n").filter((line) => line.startsWith("if ") && line.endsWith("(")).length).toBe(0);
    // Delayed expansion is on only after :missing, never where the arguments are passed.
    expect(stub.indexOf("EnableDelayedExpansion")).toBeGreaterThan(stub.indexOf(":missing"));
    expect(stub.indexOf("EnableDelayedExpansion")).toBeGreaterThan(stub.indexOf("-- %*"));
  });

  test("classify reads both markers and either line ending", () => {
    const cmd = renderCmdStub("C:\\src\\acp-tui", BUN);
    expect(classify(cmd)).toBe("stub");
    expect(classify(cmd.replaceAll("\r\n", "\n"))).toBe("stub");
    expect(classify(renderStub("/a/b"))).toBe("stub");
    expect(classify("@echo off\r\nrem somebody else's\r\necho hi\r\n")).toBe("foreign");
    expect(classify("@echo off\r\n")).toBe("foreign");
    expect(classify("")).toBe("foreign");
  });

  test("defaultDirectory: Bun's bin directory in the profile on Windows, ~/.local/bin elsewhere", () => {
    expect(defaultDirectory({ USERPROFILE: "C:\\Users\\Ann", HOME: "/home/x" }, "win32")).toBe("C:\\Users\\Ann\\.bun\\bin");
    expect(defaultDirectory({ HOME: "/home/x", USERPROFILE: "C:\\Users\\Ann" }, "linux")).toBe("/home/x/.local/bin");
    expect(defaultDirectory({ HOME: "/Users/x" }, "darwin")).toBe("/Users/x/.local/bin");
  });

  test("the PATH check on Windows ignores case, separator style, a trailing separator and quotes", () => {
    const dir = "C:\\Users\\Ann\\.bun\\bin";
    expect(onPath(dir, "C:\\Windows;c:\\users\\ann\\.BUN\\bin", "win32")).toBe(true);
    expect(onPath(dir, "C:\\Windows;C:/Users/Ann/.bun/bin/;D:\\x", "win32")).toBe(true);
    expect(onPath(dir, 'C:\\Windows;"C:\\Users\\Ann\\.bun\\bin"', "win32")).toBe(true);
    expect(onPath(dir, "C:\\Windows;C:\\Users\\Ann\\.bun", "win32")).toBe(false);
    expect(onPath(dir, "C:\\Windows;C:\\Users\\Ann\\.bun\\bin\\sub", "win32")).toBe(false);
    expect(onPath(dir, undefined, "win32")).toBe(false);
    // Elsewhere the comparison stays exact.
    expect(onPath("/nowhere/Bin", "/nowhere/bin", "linux")).toBe(false);
    expect(onPath("/nowhere/bin", "/other:/nowhere/bin", "linux")).toBe(true);
  });

  test("installs acp-tui.cmd with no mode bits, the Windows stub text and the real Bun; the configuration is created", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    const { io, out, err } = collect();
    expect(await installMain(["--dir", bin], io, winEnv(home, { Path: bin }), "win32")).toBe(0);
    const target = join(bin, "acp-tui.cmd");
    expect(existsSync(join(bin, "acp-tui"))).toBe(false);
    expect(statSync(target).mode & 0o111).toBe(0);
    const text = readFileSync(target, "utf8");
    expect(text).toBe(renderCmdStub(ROOT, process.execPath));
    expect(classify(text)).toBe("stub");
    expect(out.join("")).toContain(`installed ${target}`);
    expect(out.join("")).toContain("created");
    expect(err.join("")).toBe("");
    expect(readFileSync(join(home, "config/acp-tui/config.jsonc"), "utf8")).toBe(commentedDefault());
    // Nothing is left beside it.
    expect(existsSync(join(bin, `.acp-tui.${process.pid}.tmp`))).toBe(false);
  });

  test("warns when the directory is not on the PATH, comparing case-insensitively and reading `Path`", async () => {
    const home = scratch();
    const bin = join(home, "Bin");
    const off = collect();
    expect(await installMain(["--dir", bin], off.io, winEnv(home, { Path: "C:\\Windows" }), "win32")).toBe(0);
    expect(off.err.join("")).toContain("is not on your PATH");

    const on = collect();
    expect(await installMain(["--dir", bin], on.io, winEnv(home, { Path: `C:\\Windows;${bin.toUpperCase()}` }), "win32")).toBe(0);
    expect(on.err.join("")).toBe("");
  });

  test("a foreign acp-tui.cmd is kept and --force replaces it", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    mkdirSync(bin);
    const target = join(bin, "acp-tui.cmd");
    writeFileSync(target, "@echo off\r\necho mine\r\n");

    const refused = collect();
    expect(await installMain(["--dir", bin], refused.io, winEnv(home, { Path: bin }), "win32")).toBe(1);
    expect(refused.err.join("")).toContain("--force");
    expect(readFileSync(target, "utf8")).toBe("@echo off\r\necho mine\r\n");

    const forced = collect();
    expect(await installMain(["--dir", bin, "--force"], forced.io, winEnv(home, { Path: bin }), "win32")).toBe(0);
    expect(classify(readFileSync(target, "utf8"))).toBe("stub");

    const again = collect();
    expect(await installMain(["--dir", bin], again.io, winEnv(home, { Path: bin }), "win32")).toBe(0);
  });

  test("--uninstall removes only acp-tui.cmd with the marker, and leaves an old sh stub alone", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    mkdirSync(bin);
    const oldStub = join(bin, "acp-tui");
    writeFileSync(oldStub, renderStub("/old/checkout"));

    const first = collect();
    expect(await installMain(["--dir", bin], first.io, winEnv(home, { Path: bin }), "win32")).toBe(0);
    expect(readFileSync(oldStub, "utf8")).toBe(renderStub("/old/checkout"));

    const removed = collect();
    expect(await installMain(["--uninstall", "--dir", bin], removed.io, winEnv(home), "win32")).toBe(0);
    expect(existsSync(join(bin, "acp-tui.cmd"))).toBe(false);
    expect(readFileSync(oldStub, "utf8")).toBe(renderStub("/old/checkout"));
    expect(readFileSync(join(home, "config/acp-tui/config.jsonc"), "utf8")).toBe(commentedDefault());

    const none = collect();
    expect(await installMain(["--uninstall", "--dir", bin], none.io, winEnv(home), "win32")).toBe(0);
    expect(none.out.join("")).toContain("nothing to remove");

    writeFileSync(join(bin, "acp-tui.cmd"), "@echo off\r\necho mine\r\n");
    const kept = collect();
    expect(await installMain(["--uninstall", "--dir", bin], kept.io, winEnv(home), "win32")).toBe(1);
    expect(kept.err.join("")).toContain("was not written by install-cli");
    expect(readFileSync(join(bin, "acp-tui.cmd"), "utf8")).toBe("@echo off\r\necho mine\r\n");
  });

  test("the dist file's path is config.dist.jsonc beside config.jsonc, under %APPDATA%\\acp-tui on win32", () => {
    expect(distConfigurationFile({ APPDATA: "C:\\Users\\Ann\\AppData\\Roaming", USERPROFILE: "C:\\Users\\Ann" }, "win32")).toBe(
      "C:\\Users\\Ann\\AppData\\Roaming\\acp-tui\\config.dist.jsonc",
    );
    expect(distConfigurationFile({ XDG_CONFIG_HOME: "/tmp/cfg" }, "linux")).toBe("/tmp/cfg/acp-tui/config.dist.jsonc");
    expect(distContent("1.2.3", "{}\n").split("\n").slice(0, 3)).toEqual([
      "// The default configuration of acp-tui 1.2.3, written by install-cli on every install.",
      "// It is never read. Compare it with config.jsonc to see new and changed settings",
      "// (or run acp-tui config --diff-default).",
    ]);
  });

  test("an install with win32 injected writes the dist file beside the configuration, and --uninstall removes it", async () => {
    const home = scratch();
    const bin = join(home, "bin");
    const env = winEnv(home, { Path: bin });
    const first = collect();
    expect(await installMain(["--dir", bin], first.io, env, "win32")).toBe(0);
    const dist = join(home, "config/acp-tui", DIST_FILE_NAME);
    expect(readFileSync(dist, "utf8").endsWith(commentedDefault())).toBe(true);
    expect(first.out.join("")).toContain(`install-cli: wrote ${dist}, the default configuration of this version`);
    const removed = collect();
    expect(await installMain(["--uninstall", "--dir", bin], removed.io, winEnv(home), "win32")).toBe(0);
    expect(existsSync(dist)).toBe(false);
    expect(readFileSync(join(home, "config/acp-tui/config.jsonc"), "utf8")).toBe(commentedDefault());
  });
});
