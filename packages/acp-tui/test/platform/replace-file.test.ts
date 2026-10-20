// Renaming over a file another process holds open (spec tui-sessions "Session index writes survive
// a busy file"): the retry rule on its own, with the rename and the wait injected.
import { describe, expect, test } from "bun:test";
import { renameOver, retryWhileBusy } from "../../src/platform/replace-file.ts";

function failing(codes: readonly (string | null)[]) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const rename = (from: string, to: string) => {
    calls.push(`${from}>${to}`);
    const code = codes[calls.length - 1];
    if (code) throw Object.assign(new Error(code), { code });
  };
  return { calls, sleeps, options: { rename, sleep: (ms: number) => sleeps.push(ms), platform: "win32" as const } };
}

describe("renameOver", () => {
  test("Windows: EPERM, EBUSY and EACCES are retried, 50 ms apart, until the rename goes through", () => {
    const run = failing(["EPERM", "EBUSY", "EACCES", null]);
    renameOver("a", "b", run.options);
    expect(run.calls).toEqual(["a>b", "a>b", "a>b", "a>b"]);
    expect(run.sleeps).toEqual([50, 50, 50]);
  });

  test("Windows: five retries over 250 ms, then the last error", () => {
    const run = failing(Array(10).fill("EPERM"));
    expect(() => renameOver("a", "b", run.options)).toThrow("EPERM");
    expect(run.calls).toHaveLength(6);
    expect(run.sleeps.reduce((a, b) => a + b, 0)).toBe(250);
  });

  test("any other error is thrown at once", () => {
    const run = failing(["ENOENT"]);
    expect(() => renameOver("a", "b", run.options)).toThrow("ENOENT");
    expect(run.calls).toHaveLength(1);
    expect(run.sleeps).toEqual([]);
  });

  test("Linux and macOS: one attempt, as before", () => {
    const run = failing(["EPERM"]);
    expect(() => renameOver("a", "b", { ...run.options, platform: "linux" })).toThrow("EPERM");
    expect(run.calls).toHaveLength(1);
  });
});

describe("retryWhileBusy", () => {
  test("Windows: any step (opening to append) is retried while busy and its result returned", () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = retryWhileBusy(
      () => {
        calls++;
        if (calls <= 2) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
        return 7;
      },
      { sleep: (ms) => sleeps.push(ms), platform: "win32" },
    );
    expect(result).toBe(7);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([50, 50]);
  });

  test("Linux: one attempt", () => {
    let calls = 0;
    const step = () => {
      calls++;
      throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    };
    expect(() => retryWhileBusy(step, { sleep: () => expect.unreachable(), platform: "linux" })).toThrow("EBUSY");
    expect(calls).toBe(1);
  });
});
