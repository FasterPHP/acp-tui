// windows-support D5: a command script whose path holds a space is started through cmd.exe with
// the line cmd.exe expects (Bun's own `cmd.exe /c "<path>" "<arg>"` loses the quotes).
import { describe, expect, test } from "bun:test";
import { isCommandScript, scriptSpawn } from "../../src/agent/command-script.ts";

const env = { SystemRoot: "C:\\WINDOWS" };
const SCRIPT = "C:\\Users\\First Last\\AppData\\Roaming\\npm\\auggie.cmd";

describe("command scripts on Windows", () => {
  test("a script whose path holds a space goes through cmd.exe /d /v:off /s /c with the whole line quoted, verbatim", () => {
    expect(scriptSpawn([SCRIPT, "--acp", "two words", "C:\\Program Files\\x\\", ""], { platform: "win32", env })).toEqual({
      cmd: ["C:\\WINDOWS\\System32\\cmd.exe", "/d", "/v:off", "/s", "/c", `""${SCRIPT}" --acp "two words" "C:\\Program Files\\x\\\\" """`],
      windowsVerbatimArguments: true,
    });
  });

  test("a script without a space, any other program and every other platform are started as resolved", () => {
    const plain = ["C:\\Users\\u\\AppData\\Roaming\\npm\\auggie.cmd", "two words"];
    expect(scriptSpawn(plain, { platform: "win32", env })).toEqual({ cmd: plain });
    const exe = ["C:\\Program Files\\Git\\cmd\\git.exe", "ls-files"];
    expect(scriptSpawn(exe, { platform: "win32", env })).toEqual({ cmd: exe });
    const posix = ["/home/u/my tools/agent.cmd", "two words"];
    expect(scriptSpawn(posix, { platform: "linux", env })).toEqual({ cmd: posix });
  });

  test("the characters Bun refuses for a script are refused with Bun's error", () => {
    for (const bad of ['say "hi"', "a&b", "100%", "a|b", "a<b", "a>b", "a^b", "a\nb", "a\rb"]) {
      expect(() => scriptSpawn([SCRIPT, "ok", bad], { platform: "win32", env })).toThrow("The argument 'args[2]' contains a cmd.exe special character");
    }
    expect(() => scriptSpawn(["C:\\R&D tools\\x.cmd"], { platform: "win32", env })).toThrow("The command name contains a cmd.exe special character");
  });

  test("the extension is read as Bun reads it: any case, trailing spaces and dots ignored", () => {
    for (const name of ["x.cmd", "X.CMD", "x.bat", "x.Bat", "x.cmd. .", "x.cmd "]) expect(isCommandScript(name)).toBe(true);
    for (const name of ["x.exe", "x.cmd.exe", "xcmd", "x.cmdx"]) expect(isCommandScript(name)).toBe(false);
  });
});
