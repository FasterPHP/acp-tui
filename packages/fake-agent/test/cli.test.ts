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
