// Spec tui-config "Version information": the lines, the short form, and a run without git.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "../src/cli.ts";
import { versionLines, type VersionInfo } from "../src/version.ts";
import pkg from "../package.json" with { type: "json" };

/** The package's version as a pattern, so a release needs no test change. */
const VERSION = pkg.version.replaceAll(".", "\\.");

const INFO: VersionInfo = { version: "0.1.0", commit: "4fea8f9", modified: false, bun: "1.4.0", platform: "linux", arch: "x64", terminal: "jetbrains" };
const CLI = resolve(import.meta.dir, "../src/cli.ts");

describe("versionLines", () => {
  test("a clean checkout", () => {
    expect(versionLines(INFO)).toEqual(["acp-tui 0.1.0 (4fea8f9)", "bun 1.4.0", "linux x64", "terminal jetbrains"]);
  });
  test("modified tracked files", () => {
    expect(versionLines({ ...INFO, modified: true })[0]).toBe("acp-tui 0.1.0 (4fea8f9, modified)");
  });
  test("without a commit", () => {
    expect(versionLines({ ...INFO, commit: null, modified: true })[0]).toBe("acp-tui 0.1.0");
  });
});

describe("--version", () => {
  test("Short form: -v is --version, before a --", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
    expect(parseArgs(["-v", "--", "my-agent"])).toMatchObject({ version: true, agentCommand: ["my-agent"] });
    expect(parseArgs([]).version).toBe(false);
  });

  function run(args: string[], env: Record<string, string>) {
    const result = Bun.spawnSync([process.execPath, CLI, "--", ...args], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
  }

  test("prints the four lines with the commit, and exits 0", () => {
    const { code, out } = run(["--version"], { ...(process.env as Record<string, string>), TERM_PROGRAM: "zed" });
    expect(code).toBe(0);
    const lines = out.trimEnd().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(new RegExp(`^acp-tui ${VERSION}( \\([0-9a-f]{7,}(, modified)?\\))?$`));
    expect(lines[1]).toBe(`bun ${Bun.version}`);
    expect(lines[2]).toBe(`${process.platform} ${process.arch}`);
    expect(lines[3]).toMatch(/^terminal \S+$/);
    expect(run(["-v"], process.env as Record<string, string>).out).toBe(run(["--version"], process.env as Record<string, string>).out);
  });

  test("Without git: the first line has no commit and the others are printed", () => {
    const empty = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-nogit-"));
    const { code, out } = run(["--version"], { PATH: empty, HOME: empty });
    expect(code).toBe(0);
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe(`acp-tui ${pkg.version}`);
    expect(lines).toHaveLength(4);
  });
});
