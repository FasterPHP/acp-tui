// Who may define harnesses on Windows (spec tui-config "Harness file writers on Windows",
// scenarios "Own file in the profile" and "File owned by another account"): the owner and the
// location of the user's file and its directory, with the Win32 owner lookup injected. The real
// lookup (platform/windows-owner.ts) runs only on Windows; on Linux its library cannot open, which
// is the "lookup failed" path.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DebugLogEntry } from "../../src/log.ts";
import { parseConfigText } from "../../src/config/load.ts";
import { readConfigFile } from "../../src/config/sources.ts";
import { ADMINISTRATORS_SID, SYSTEM_SID, writersProblem, type WindowsOwnerLookup } from "../../src/config/writers.ts";

const USER = "S-1-5-21-1111111111-2222222222-3333333333-1001";
const OTHER = "S-1-5-21-1111111111-2222222222-3333333333-1002";
const PROFILE = "C:\\Users\\u";
const FILE = "C:\\Users\\u\\AppData\\Roaming\\acp-tui\\config.jsonc";
const DIR = "C:\\Users\\u\\AppData\\Roaming\\acp-tui";

/** A lookup where `owners` maps a path to its owner's SID (the user's by default). */
function lookup(owners: Record<string, string> = {}, names: Record<string, string> = {}): () => WindowsOwnerLookup {
  return () => ({
    currentUserSid: () => USER,
    ownerSid: (path) => owners[path] ?? USER,
    accountName: (sid) => names[sid] ?? null,
  });
}

function check(file: string, options: { env?: Record<string, string>; owners?: Record<string, string>; names?: Record<string, string>; ownerLookup?: () => WindowsOwnerLookup } = {}) {
  const logged: DebugLogEntry[] = [];
  const problem = writersProblem(file, {
    platform: "win32",
    env: options.env ?? { USERPROFILE: PROFILE },
    ownerLookup: options.ownerLookup ?? lookup(options.owners, options.names),
    log: (entry) => logged.push(entry),
  });
  return { problem, logged };
}

describe("Harness file writers on Windows", () => {
  test("Own file in the profile: no problem", () => {
    expect(check(FILE)).toEqual({ problem: null, logged: [] });
  });

  test("a file or directory owned by Administrators (an elevated user's) or SYSTEM is accepted", () => {
    expect(check(FILE, { owners: { [FILE]: ADMINISTRATORS_SID, [DIR]: SYSTEM_SID } }).problem).toBeNull();
  });

  test("File owned by another account: the problem names the owner's account and SID", () => {
    const { problem } = check(FILE, { owners: { [FILE]: OTHER }, names: { [OTHER]: "WORK\\mallory" } });
    expect(problem).toBe(`the file ${FILE} is owned by WORK\\mallory (${OTHER}), not by you, Administrators or SYSTEM`);
  });

  test("an owner whose name cannot be found is named by its SID; a foreign directory is refused too", () => {
    expect(check(FILE, { owners: { [DIR]: OTHER } }).problem).toBe(`the directory ${DIR} is owned by ${OTHER}, not by you, Administrators or SYSTEM`);
  });

  test("a file outside the profile (a share, C:\\ProgramData) is refused, naming the location", () => {
    const shared = "\\\\server\\share\\acp-tui\\config.jsonc";
    expect(check(shared, { env: { USERPROFILE: PROFILE, APPDATA: "\\\\server\\share" } }).problem).toBe(`the file ${shared} is outside your profile ${PROFILE}`);
    const programData = "C:\\ProgramData\\acp-tui\\config.jsonc";
    expect(check(programData).problem).toBe(`the file ${programData} is outside your profile ${PROFILE}`);
  });

  test("a file in XDG_CONFIG_HOME outside the profile is accepted when its owner is", () => {
    const file = "D:\\cfg\\acp-tui\\config.jsonc";
    expect(check(file, { env: { USERPROFILE: PROFILE, XDG_CONFIG_HOME: "D:\\cfg" } }).problem).toBeNull();
    expect(check(file, { env: { USERPROFILE: PROFILE, XDG_CONFIG_HOME: "D:\\other" } }).problem).toBe(
      `the file ${file} is outside your profile ${PROFILE} and XDG_CONFIG_HOME D:\\other`,
    );
  });

  test("the profile is compared without regard to case or separator", () => {
    expect(check("c:/users/U/AppData/Roaming/acp-tui/config.jsonc").problem).toBeNull();
  });

  test("lookup failure: the file counts as the user's own and a config_owner_unknown event is logged", () => {
    const failing = () => ({
      currentUserSid: () => {
        throw new Error("OpenProcessToken failed (error 5)");
      },
      ownerSid: () => USER,
      accountName: () => null,
    });
    expect(check(FILE, { ownerLookup: failing })).toEqual({
      problem: null,
      logged: [{ event: "config_owner_unknown", path: FILE, step: "user", error: "OpenProcessToken failed (error 5)" }],
    });
    const ownerFails = () => ({
      currentUserSid: () => USER,
      ownerSid: (path: string) => {
        if (path === FILE) throw new Error("GetNamedSecurityInfoW failed (error 2)");
        return USER;
      },
      accountName: () => null,
    });
    expect(check(FILE, { ownerLookup: ownerFails })).toEqual({
      problem: null,
      logged: [{ event: "config_owner_unknown", path: FILE, step: "owner", error: "GetNamedSecurityInfoW failed (error 2)" }],
    });
  });

  test("the real lookup, required only for Windows, fails to open its library elsewhere: the file counts as the user's own", () => {
    if (process.platform === "win32") return;
    const logged: DebugLogEntry[] = [];
    expect(writersProblem(FILE, { platform: "win32", env: { USERPROFILE: PROFILE }, log: (entry) => logged.push(entry) })).toBeNull();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ event: "config_owner_unknown", path: FILE, step: "user" });
  });

  test("the mode bits are not consulted on Windows: a 0666 file the user owns keeps its harnesses", () => {
    const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-writers-")));
    mkdirSync(join(home, "acp-tui"));
    const file = join(home, "acp-tui", "config.jsonc");
    writeFileSync(file, `{ "agent_servers": { "fake": { "command": "bun" } } }`);
    chmodSync(file, 0o666);
    const read = readConfigFile(file, { checkWriters: true, platform: "win32", env: { USERPROFILE: home }, ownerLookup: lookup() });
    expect(read.unsafe).toBeNull();
    // ... and a foreign owner refuses agent_servers with a problem naming the owner.
    const foreign = readConfigFile(file, { checkWriters: true, platform: "win32", env: { USERPROFILE: home }, ownerLookup: lookup({ [file]: OTHER }, { [OTHER]: "WORK\\mallory" }) });
    const parsed = parseConfigText(foreign.text, file, { agentsRefused: foreign.unsafe });
    expect(parsed.problems.map((p) => [p.path, p.message])).toEqual([
      ["agent_servers", `is refused: harness commands are not read from a file other users can write (the file ${file} is owned by WORK\\mallory (${OTHER}), not by you, Administrators or SYSTEM)`],
    ]);
    // On Linux the same file is refused by its mode.
    expect(readConfigFile(file, { checkWriters: true, platform: "linux" }).unsafe).toContain("has mode 0666");
  });
});
