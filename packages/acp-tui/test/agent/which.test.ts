// Programs resolved from the PATH only (spec tui-agent-session "Programs resolved from the PATH
// only"): the resolver's forms on both platforms (the platform and, for Windows, the lookup
// injected), the real lookup on this machine, the error a name on no PATH entry gives, and the
// harness environment merged case-insensitively on Windows.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { realCommandExists } from "../../src/cli.ts";
import { envValue, hasWindowsCommandExtension, isPathCommand, mergeEnvironment, ProgramNotFoundError, resolveArgv, resolveProgram, type WhichFunction } from "../../src/agent/which.ts";

function temp(): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-which-")));
}

/** A lookup that records its calls and finds `found` (by name) wherever it is asked. */
function recordingWhich(found: Record<string, string>): { which: WhichFunction; calls: { name: string; PATH: string; cwd: string }[] } {
  const calls: { name: string; PATH: string; cwd: string }[] = [];
  return { calls, which: (name, options) => (calls.push({ name, ...options }), found[name] ?? null) };
}

describe("a command written as a path is used as written", () => {
  test("on Linux and macOS: a word with a `/` is a path; a backslash or a drive letter is part of a name", () => {
    for (const path of ["/usr/bin/git", "./agent", "../bin/agent", "bin/agent"]) {
      expect(isPathCommand(path, "linux")).toBe(true);
      expect(isPathCommand(path, "darwin")).toBe(true);
    }
    for (const name of ["git", "auggie", "agent.cmd", "C:agent", "a\\b"]) expect(isPathCommand(name, "linux")).toBe(false);
  });

  test("on Windows: `/`, `\\`, a drive letter or a UNC prefix make a path; a bare name (with its extension or not) is looked up", () => {
    for (const path of ["C:\\tools\\agent.cmd", "C:/tools/agent.cmd", "c:agent.cmd", "\\\\server\\share\\agent.cmd", ".\\agent.cmd", "./agent", "\\tools\\agent.exe", "bin\\agent"]) {
      expect(isPathCommand(path, "win32")).toBe(true);
    }
    for (const name of ["git", "auggie", "auggie.cmd", "git.exe"]) expect(isPathCommand(name, "win32")).toBe(false);
  });

  test("a path is returned unchanged, without a lookup, on both platforms", () => {
    const { which, calls } = recordingWhich({});
    expect(resolveProgram("./agent", { platform: "linux", env: { PATH: "/usr/bin" }, which })).toBe("./agent");
    expect(resolveProgram("C:\\tools\\agent.cmd", { platform: "win32", env: { Path: "C:\\bin" }, which })).toBe("C:\\tools\\agent.cmd");
    expect(resolveProgram("\\\\server\\x\\agent.cmd", { platform: "win32", env: {}, which })).toBe("\\\\server\\x\\agent.cmd");
    expect(calls).toEqual([]);
  });
});

describe("a name is looked up on the PATH only, from the user's home", () => {
  test("on Windows the PATH is read case-insensitively (Windows keeps `Path`), and the lookup's cwd is the home, never the session directory", () => {
    const { which, calls } = recordingWhich({ git: "C:\\Program Files\\Git\\cmd\\git.exe" });
    expect(resolveProgram("git", { platform: "win32", env: { Path: "C:\\Program Files\\Git\\cmd;C:\\Windows" }, home: "C:\\Users\\u", which })).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
    expect(calls).toEqual([{ name: "git", PATH: "C:\\Program Files\\Git\\cmd;C:\\Windows", cwd: "C:\\Users\\u" }]);
  });

  test("on Linux the PATH is `PATH` only (a `Path` is another variable)", () => {
    const { which, calls } = recordingWhich({ git: "/usr/bin/git" });
    expect(resolveProgram("git", { platform: "linux", env: { Path: "/usr/bin" }, which })).toBeNull();
    expect(resolveProgram("git", { platform: "linux", env: { PATH: "/usr/bin" }, home: "/home/u", which })).toBe("/usr/bin/git");
    expect(calls).toEqual([{ name: "git", PATH: "/usr/bin", cwd: "/home/u" }]);
  });

  test("no PATH, or an empty command, resolves to nothing", () => {
    const { which, calls } = recordingWhich({ git: "/usr/bin/git" });
    expect(resolveProgram("git", { platform: "linux", env: {}, which })).toBeNull();
    expect(resolveProgram("git", { platform: "win32", env: { PATH: "" }, which })).toBeNull();
    expect(resolveProgram("", { platform: "linux", env: { PATH: "/usr/bin" }, which })).toBeNull();
    expect(calls).toEqual([]);
  });

  test("envValue: the last of several case variants wins on Windows; Linux reads the exact name", () => {
    expect(envValue({ Path: "a", PATH: "b" }, "PATH", "win32")).toBe("b");
    expect(envValue({ path: "a" }, "PATH", "win32")).toBe("a");
    expect(envValue({ Path: "a" }, "PATH", "linux")).toBeUndefined();
  });

  test.skipIf(process.platform === "win32")("for real: a program in the session directory is never found, even with `.` or an empty entry on the PATH", () => {
    const session = temp();
    const home = temp();
    const bin = join(temp(), "bin");
    mkdirSync(bin);
    for (const dir of [session, bin]) {
      writeFileSync(join(dir, "acp-tui-which-tool"), "#!/bin/sh\nexit 0\n");
      chmodSync(join(dir, "acp-tui-which-tool"), 0o755);
    }
    // Bun.which itself reads `.` against the cwd it is given: the session directory would win.
    expect(Bun.which("acp-tui-which-tool", { PATH: ".", cwd: session })).not.toBeNull();
    // The resolver reads it against the home, so only the PATH's program is found.
    expect(resolveProgram("acp-tui-which-tool", { env: { PATH: "." }, home })).toBeNull();
    expect(resolveProgram("acp-tui-which-tool", { env: { PATH: `.${delimiter}${delimiter}${bin}` }, home })).toBe(join(bin, "acp-tui-which-tool"));
    // The default home is the user's: an absolute path to the PATH's program.
    expect(resolveProgram("sh", { env: { PATH: "/usr/bin:/bin" } })).toMatch(/^\/.*\/sh$/);
  });
});

describe("resolveArgv", () => {
  test("the program resolved, the arguments untouched", () => {
    const { which } = recordingWhich({ git: "/usr/bin/git" });
    expect(resolveArgv(["git", "ls-files", "-z"], { platform: "linux", env: { PATH: "/usr/bin" }, which })).toEqual(["/usr/bin/git", "ls-files", "-z"]);
  });

  test("a name on no PATH entry throws ProgramNotFoundError, with the message Bun.spawn gives, before anything starts", () => {
    const { which } = recordingWhich({});
    let error: unknown = null;
    try {
      resolveArgv(["nosuch", "--acp"], { platform: "win32", env: { Path: "C:\\bin" }, which });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProgramNotFoundError);
    expect((error as ProgramNotFoundError).program).toBe("nosuch");
    expect((error as Error).message).toBe('Executable not found in $PATH: "nosuch"');
    expect((error as ProgramNotFoundError).code).toBe("ENOENT");
    // The same text Bun.spawn throws for a missing program, so what the user reads is unchanged.
    let bun = "";
    try {
      Bun.spawn(["acp-tui-no-such-program-xyz"]);
    } catch (e) {
      bun = (e as Error).message;
    }
    expect(bun).toBe(new ProgramNotFoundError("acp-tui-no-such-program-xyz").message);
  });
});

describe("the harness environment (Windows merges names case-insensitively)", () => {
  test("on Windows an entry's PATH replaces the base's Path instead of adding a second key", () => {
    const merged = mergeEnvironment({ Path: "C:\\Windows", SystemRoot: "C:\\Windows", Other: "x" }, { PATH: "C:\\tools", OTHER: "y" }, "win32");
    expect(merged).toEqual({ SystemRoot: "C:\\Windows", PATH: "C:\\tools", OTHER: "y" });
    expect(Object.keys(merged).filter((k) => k.toUpperCase() === "PATH")).toEqual(["PATH"]);
  });

  test("on Linux names stay case-sensitive, as before", () => {
    expect(mergeEnvironment({ Path: "/a", PATH: "/usr/bin", X: "1" }, { PATH: "/tools" }, "linux")).toEqual({ Path: "/a", PATH: "/tools", X: "1" });
  });
});

describe("the lone-word rule (cli.ts)", () => {
  test("on Windows a word with `\\` or a drive letter is a path, checked on disk, never looked up", () => {
    const { which, calls } = recordingWhich({ "C:\\tools\\agent.cmd": "found", ".\\agent.cmd": "found" });
    expect(realCommandExists("C:\\tools\\agent.cmd", "C:\\work", "win32", which)).toBe(false);
    expect(realCommandExists(".\\agent.cmd", "C:\\work", "win32", which)).toBe(false);
    expect(calls).toEqual([]);
  });

  test("a bare name is looked up on the PATH, on both platforms", () => {
    const { which, calls } = recordingWhich({ auggie: "C:\\Users\\u\\AppData\\Roaming\\npm\\auggie.cmd" });
    expect(realCommandExists("auggie", "C:\\work", "win32", which)).toBe(true);
    expect(realCommandExists("nosuch", "/work", "linux", which)).toBe(false);
    expect(calls.map((c) => c.name)).toEqual(["auggie", "nosuch"]);
    // On Linux a backslash is part of a name.
    expect(realCommandExists("a\\b", "/work", "linux", which)).toBe(false);
    expect(calls.map((c) => c.name)).toEqual(["auggie", "nosuch", "a\\b"]);
  });

  test("on Windows a path is a command only with an extension from PATHEXT (there is no execute bit)", () => {
    expect(hasWindowsCommandExtension("C:\\tools\\agent.cmd", {})).toBe(true);
    expect(hasWindowsCommandExtension("C:\\tools\\AGENT.Exe", {})).toBe(true);
    expect(hasWindowsCommandExtension(".\\notes.txt", {})).toBe(false);
    expect(hasWindowsCommandExtension("C:\\tools.d\\agent", {})).toBe(false);
    expect(hasWindowsCommandExtension("C:\\tools\\agent.ps1", { PathExt: ".COM;.EXE;.PS1" })).toBe(true);
    expect(hasWindowsCommandExtension("C:\\tools\\agent.cmd", { PATHEXT: ".EXE" })).toBe(false);
  });

  test.skipIf(process.platform === "win32")("for real: an executable path is a command, and a program only in the cwd is not", () => {
    const dir = temp();
    writeFileSync(join(dir, "acp-tui-lone-tool"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "acp-tui-lone-tool"), 0o755);
    expect(realCommandExists("./acp-tui-lone-tool", dir)).toBe(true);
    expect(realCommandExists("acp-tui-lone-tool", dir)).toBe(false);
  });
});
