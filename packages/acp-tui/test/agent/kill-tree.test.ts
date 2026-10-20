// windows-support D5 (spec tui-agent-session "Harness process tree ended on Windows"): the command
// that ends a harness is chosen per platform. Nothing here starts taskkill; the spawner and the
// resolver are injected, so the tests run the same on every platform.
import { describe, expect, test } from "bun:test";
import { killProcessTree, taskkillArgv, type KillableProcess } from "../../src/agent/kill-tree.ts";
import { ProgramNotFoundError } from "../../src/agent/which.ts";

function fakeProcess(pid = 4242, state: { exitCode?: number | null; signalCode?: string | null } = {}) {
  const kills: number[] = [];
  const proc: KillableProcess = {
    pid,
    ...state,
    kill() {
      kills.push(pid);
    },
  };
  return { proc, kills };
}

describe("taskkillArgv", () => {
  test("ends the process and its children by force, as an argument list", () => {
    expect(taskkillArgv(4242)).toEqual(["taskkill", "/PID", "4242", "/T", "/F"]);
  });
});

describe("killProcessTree", () => {
  test("on Windows runs taskkill /PID <pid> /T /F by the resolved path and does not call kill()", async () => {
    const { proc, kills } = fakeProcess();
    const spawned: string[][] = [];
    await killProcessTree(proc, {
      platform: "win32",
      resolve: (argv) => ["C:\\WINDOWS\\system32\\taskkill.exe", ...argv.slice(1)],
      spawn: (argv) => {
        spawned.push(argv);
        return { exited: Promise.resolve(0) };
      },
    });
    expect(spawned).toEqual([["C:\\WINDOWS\\system32\\taskkill.exe", "/PID", "4242", "/T", "/F"]]);
    expect(kills).toEqual([]);
  });

  test("on Windows the program is looked up on the PATH only, by the resolver", async () => {
    const { proc } = fakeProcess();
    const asked: string[][] = [];
    await killProcessTree(proc, {
      platform: "win32",
      resolve: (argv) => {
        asked.push([...argv]);
        return ["C:\\x\\taskkill.exe"];
      },
      spawn: () => ({ exited: Promise.resolve(0) }),
    });
    expect(asked).toEqual([["taskkill", "/PID", "4242", "/T", "/F"]]);
  });

  test("on Windows, taskkill not on the PATH falls back to kill() and starts nothing", async () => {
    const { proc, kills } = fakeProcess();
    let spawned = 0;
    await killProcessTree(proc, {
      platform: "win32",
      resolve: () => {
        throw new ProgramNotFoundError("taskkill");
      },
      spawn: () => {
        spawned++;
        return { exited: Promise.resolve(0) };
      },
    });
    expect(spawned).toBe(0);
    expect(kills).toEqual([4242]);
  });

  test("on Windows, a taskkill that cannot start falls back to kill()", async () => {
    const { proc, kills } = fakeProcess();
    await killProcessTree(proc, {
      platform: "win32",
      resolve: (argv) => [...argv],
      spawn: () => {
        throw new Error("spawn failed");
      },
    });
    expect(kills).toEqual([4242]);
  });

  test("on Windows, a taskkill that fails (non-zero exit) or rejects falls back to kill()", async () => {
    for (const exited of [Promise.resolve(128), Promise.resolve(null), Promise.reject(new Error("boom"))]) {
      const { proc, kills } = fakeProcess();
      await killProcessTree(proc, { platform: "win32", resolve: (argv) => [...argv], spawn: () => ({ exited }) });
      expect(kills).toEqual([4242]);
    }
  });

  test("on Windows, a process that has already exited is left alone (its PID may be reused)", async () => {
    for (const state of [{ exitCode: 0 }, { exitCode: 1 }, { signalCode: "SIGTERM" }]) {
      const { proc, kills } = fakeProcess(4242, state);
      let spawned = 0;
      await killProcessTree(proc, {
        platform: "win32",
        resolve: (argv) => [...argv],
        spawn: () => {
          spawned++;
          return { exited: Promise.resolve(0) };
        },
      });
      expect(spawned).toBe(0);
      expect(kills).toEqual([]);
    }
  });

  test("on Linux and macOS it is kill() only, and taskkill is never looked up", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      const { proc, kills } = fakeProcess();
      let looked = 0;
      await killProcessTree(proc, {
        platform,
        resolve: (argv) => {
          looked++;
          return [...argv];
        },
        spawn: () => {
          looked++;
          return { exited: Promise.resolve(0) };
        },
      });
      expect(looked).toBe(0);
      expect(kills).toEqual([4242]);
    }
  });

  test("on Linux an exited process still gets the same kill() as before, and a throwing kill() is swallowed", async () => {
    const proc: KillableProcess = {
      pid: 1,
      exitCode: 0,
      kill() {
        throw new Error("already dead");
      },
    };
    await killProcessTree(proc, { platform: "linux" });
  });

  test("the default on Linux ends a real child", async () => {
    if (process.platform === "win32") return;
    const child = Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    await killProcessTree(child);
    expect(await child.exited).not.toBe(0);
  });
});
