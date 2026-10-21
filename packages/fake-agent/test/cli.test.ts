// Argument parsing for the knobs added in phase-1a: --items.
import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli.ts";

describe("fake-agent CLI --items", () => {
  test("defaults to 200", () => {
    expect(parseArgs([], {}).items).toBe(200);
  });

  test("takes a positive integer", () => {
    expect(parseArgs(["--scenario", "long-session", "--items", "5000"], {}).items).toBe(5000);
  });

  test("rejects zero, negatives, fractions, words and a missing value", () => {
    for (const bad of ["0", "-3", "1.5", "many"]) {
      expect(() => parseArgs(["--items", bad], {})).toThrow("--items must be a positive integer");
    }
    expect(() => parseArgs(["--items"], {})).toThrow("--items requires a value");
  });
});

describe("fake-agent CLI --history", () => {
  test("is off by default and on with the flag", () => {
    expect(parseArgs([], {}).history).toBe(false);
    expect(parseArgs(["--scenario", "long-session", "--items", "5000", "--history"], {}).history).toBe(true);
  });
});

describe("fake-agent CLI --chunk", () => {
  test("is absent by default and takes a positive integer", () => {
    expect(parseArgs([], {}).chunk).toBeUndefined();
    expect(parseArgs(["--scenario", "markdown-gallery", "--chunk", "37"], {}).chunk).toBe(37);
  });

  test("rejects zero, negatives, fractions, non-numbers and a missing value", () => {
    for (const bad of ["0", "-3", "2.5", "many"]) {
      expect(() => parseArgs(["--chunk", bad], {})).toThrow("--chunk must be a positive integer");
    }
    expect(() => parseArgs(["--chunk"], {})).toThrow("--chunk requires a value");
  });
});

describe("fake-agent CLI --start-delay and --list-delay", () => {
  test("both default to no delay", () => {
    const options = parseArgs([], {});
    expect(options.startDelayMs).toBe(0);
    expect(options.listDelayMs).toBe(0);
  });

  test("take a positive integer number of milliseconds", () => {
    const options = parseArgs(["--start-delay", "3000", "--list-delay", "1500"], {});
    expect(options.startDelayMs).toBe(3000);
    expect(options.listDelayMs).toBe(1500);
  });

  test("are absolute: --delay-scale and its environment variable leave them alone", () => {
    const options = parseArgs(["--start-delay", "200", "--list-delay", "300", "--delay-scale", "0"], { FAKE_AGENT_DELAY_SCALE: "5" });
    expect(options.startDelayMs).toBe(200);
    expect(options.listDelayMs).toBe(300);
  });

  test("reject zero, negatives, fractions, words and a missing value", () => {
    for (const flag of ["--start-delay", "--list-delay"]) {
      for (const bad of ["0", "-3", "1.5", "soon"]) {
        expect(() => parseArgs([flag, bad], {})).toThrow(`${flag} must be a positive integer`);
      }
      expect(() => parseArgs([flag], {})).toThrow(`${flag} requires a value`);
    }
  });
});

describe("fake-agent CLI --tools", () => {
  test("defaults to 6 and takes a positive integer", () => {
    expect(parseArgs([], {}).tools).toBe(6);
    expect(parseArgs(["--scenario", "fast-tools", "--tools", "20"], {}).tools).toBe(20);
  });

  test("a bad value or a missing one is an error", () => {
    for (const bad of ["0", "-1", "1.5", "abc"]) {
      expect(() => parseArgs(["--tools", bad], {})).toThrow("--tools must be a positive integer");
    }
    expect(() => parseArgs(["--tools"], {})).toThrow("--tools requires a value");
  });
});

describe("fake-agent CLI --auth-required and --agent-info", () => {
  test("both are absent by default", () => {
    const options = parseArgs([], {});
    expect(options.authRequired).toBeUndefined();
    expect(options.agentInfo).toBeUndefined();
  });

  test("--auth-required has a full, a bare and a prompt form", () => {
    expect(parseArgs(["--auth-required"], {}).authRequired).toBe("full");
    expect(parseArgs(["--auth-required=bare"], {}).authRequired).toBe("bare");
    expect(parseArgs(["--auth-required=prompt"], {}).authRequired).toBe("prompt");
  });

  test("--agent-info splits at the last @", () => {
    expect(parseArgs(["--agent-info", "auggie@1.2.0"], {}).agentInfo).toEqual({ name: "auggie", version: "1.2.0" });
    expect(parseArgs(["--agent-info", "@scope/x@2"], {}).agentInfo).toEqual({ name: "@scope/x", version: "2" });
  });

  test("--agent-info refuses a malformed value", () => {
    for (const bad of ["auggie", "auggie@", "@1.0", ""]) {
      expect(() => parseArgs(["--agent-info", bad], {})).toThrow("--agent-info must be <name>@<version>");
    }
    expect(() => parseArgs(["--agent-info"], {})).toThrow("--agent-info requires a value");
  });
});

describe("fake-agent CLI options for harness-feedback", () => {
  test("all are off by default", () => {
    const options = parseArgs([], {});
    expect(options.additionalDirectories).toBe(false);
    expect(options.addWorkspace).toEqual([]);
    expect(options.noInitialize).toBe(false);
    expect(options.printTerminal).toBeUndefined();
    expect(options.sessionDelayMs).toBe(0);
    expect(options.sessionHeartbeatMs).toBeUndefined();
    expect(options.sessionPermission).toBe(false);
  });

  test("--additional-directories, --no-initialize and --session-permission are flags", () => {
    const options = parseArgs(["--additional-directories", "--no-initialize", "--session-permission"], {});
    expect(options.additionalDirectories).toBe(true);
    expect(options.noInitialize).toBe(true);
    expect(options.sessionPermission).toBe(true);
  });

  test("--add-workspace is repeatable and keeps the order", () => {
    expect(parseArgs(["--add-workspace", "/a", "--add-workspace", "/b"], {}).addWorkspace).toEqual(["/a", "/b"]);
    expect(() => parseArgs(["--add-workspace"], {})).toThrow("--add-workspace requires a value");
  });

  test("--print-terminal has an escape and a lines form", () => {
    expect(parseArgs(["--print-terminal"], {}).printTerminal).toBe("escape");
    expect(parseArgs(["--print-terminal=lines"], {}).printTerminal).toBe("lines");
  });

  test("--session-delay and --session-heartbeat take positive integers", () => {
    const options = parseArgs(["--session-delay", "3000", "--session-heartbeat", "500"], {});
    expect(options.sessionDelayMs).toBe(3000);
    expect(options.sessionHeartbeatMs).toBe(500);
    for (const flag of ["--session-delay", "--session-heartbeat"]) {
      for (const bad of ["0", "-3", "1.5", "soon"]) {
        expect(() => parseArgs([flag, bad], {})).toThrow(`${flag} must be a positive integer`);
      }
      expect(() => parseArgs([flag], {})).toThrow(`${flag} requires a value`);
    }
  });
});

describe("fake-agent CLI --config-delay and --config-never", () => {
  test("parsed, off by default", () => {
    expect(parseArgs([], {}).configDelayMs).toBe(0);
    expect(parseArgs([], {}).configNever).toBe(false);
    const options = parseArgs(["--config-delay", "250", "--config-never"], {});
    expect(options.configDelayMs).toBe(250);
    expect(options.configNever).toBe(true);
  });
});
