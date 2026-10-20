// windows-support task 11.3: the pure parts of `bun run test:windows` (scripts/test-windows.ts):
// argument lists, the refusals and the choice of the run it started, with an injected runner. The
// real `gh` and `git` are never started.
import { describe, expect, test } from "bun:test";
import { ghArgs, gitArgs, parseRemoteHead, parseRuns, refusal, selectRun, startRun, type CommandResult, type Deps, type RunInfo } from "../../scripts/windows-check.ts";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

describe("argument lists", () => {
  test("gh and git get argument lists, with the branch as one element", () => {
    expect(ghArgs.dispatch("feat/x y")).toEqual(["workflow", "run", "windows.yml", "--ref", "feat/x y"]);
    expect(ghArgs.list("main")).toEqual(["run", "list", "--workflow", "windows.yml", "--branch", "main", "--limit", "10", "--json", "databaseId,createdAt,headSha"]);
    expect(ghArgs.watch(42)).toEqual(["run", "watch", "42", "--exit-status"]);
    expect(gitArgs.remoteHead("origin", "main")).toEqual(["ls-remote", "--heads", "origin", "refs/heads/main"]);
  });
});

describe("the branch must be pushed", () => {
  test("remote head parsing and the refusals", () => {
    expect(parseRemoteHead(`${SHA}\trefs/heads/main\n`)).toBe(SHA);
    expect(parseRemoteHead("")).toBeNull();
    expect(parseRemoteHead("not a sha\trefs/heads/main")).toBeNull();
    expect(refusal("main", SHA, SHA)).toBeNull();
    expect(refusal("HEAD", SHA, SHA)).toContain("detached");
    expect(refusal("topic", SHA, null)).toContain("not pushed");
    expect(refusal("topic", SHA, OTHER)).toContain("not the local head");
  });
});

describe("choosing the run", () => {
  const runs: RunInfo[] = [
    { databaseId: 1, createdAt: "2026-10-20T10:00:00Z", headSha: SHA },
    { databaseId: 2, createdAt: "2026-10-20T11:00:00Z", headSha: OTHER },
    { databaseId: 3, createdAt: "2026-10-20T11:05:00Z", headSha: SHA },
    { databaseId: 4, createdAt: "2026-10-20T11:06:00Z", headSha: SHA },
  ];
  test("a run that was not there before the dispatch and has this commit; the newest if several", () => {
    expect(selectRun(runs, new Set([1, 2]), SHA)?.databaseId).toBe(4);
    expect(selectRun(runs, new Set([1, 2, 3, 4]), SHA)).toBeNull();
    expect(selectRun(runs, new Set([1, 2, 3, 4]), OTHER)).toBeNull();
    expect(selectRun(runs, new Set([1, 3, 4]), SHA)).toBeNull();
    expect(selectRun([], new Set(), SHA)).toBeNull();
  });
  test("run list parsing rejects what is not a list of runs", () => {
    expect(parseRuns(JSON.stringify(runs))).toHaveLength(4);
    expect(() => parseRuns("{}")).toThrow();
    expect(() => parseRuns('[{"databaseId":"x"}]')).toThrow();
  });
});

/** A runner over a script of replies keyed by "command args"; records the calls. */
function fake(script: Record<string, CommandResult | CommandResult[]>): { deps: Deps; calls: string[]; logs: string[] } {
  const calls: string[] = [];
  const logs: string[] = [];
  const queues = new Map(Object.entries(script).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const deps: Deps = {
    run: async (command, args) => {
      const key = [command, ...args].join(" ");
      calls.push(key);
      const queue = queues.get(key);
      if (!queue) return { code: 1, stdout: "", stderr: `unscripted: ${key}` };
      return queue.length > 1 ? queue.shift()! : queue[0]!;
    },
    log: (line) => logs.push(line),
    sleep: async () => {},
    pollMs: 1,
    waitMs: 3,
  };
  return { deps, calls, logs };
}
const ok = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" });
const list = (...runs: RunInfo[]): CommandResult => ok(JSON.stringify(runs));
const base = {
  "git rev-parse --abbrev-ref HEAD": ok("topic\n"),
  "git rev-parse HEAD": ok(`${SHA}\n`),
  "git status --porcelain": ok(""),
};
const LIST = "gh run list --workflow windows.yml --branch topic --limit 10 --json databaseId,createdAt,headSha";

describe("startRun", () => {
  test("pushed branch: lists the runs, dispatches, waits until the new run for this commit appears", async () => {
    const old: RunInfo = { databaseId: 1, createdAt: "2026-10-20T10:00:00Z", headSha: SHA };
    const fresh: RunInfo = { databaseId: 9, createdAt: "2026-10-20T11:00:00Z", headSha: SHA };
    const { deps, calls } = fake({
      ...base,
      "git ls-remote --heads origin refs/heads/topic": ok(`${SHA}\trefs/heads/topic\n`),
      [LIST]: [list(old), list(old), list(fresh, old)],
      "gh workflow run windows.yml --ref topic": ok(""),
    });
    const result = await startRun(deps);
    expect(result).toEqual({ run: fresh, branch: "topic" });
    expect(calls.indexOf("gh workflow run windows.yml --ref topic")).toBeGreaterThan(calls.indexOf(LIST));
  });

  test("not pushed, or the remote differs: refused before anything is dispatched", async () => {
    for (const remote of ["", `${OTHER}\trefs/heads/topic\n`]) {
      const { deps, calls } = fake({ ...base, "git ls-remote --heads origin refs/heads/topic": ok(remote) });
      const result = await startRun(deps);
      expect("error" in result).toBe(true);
      expect(calls.some((c) => c.startsWith("gh "))).toBe(false);
    }
  });

  test("no new run in time: an error naming the commit; a failing gh: its message", async () => {
    const old: RunInfo = { databaseId: 1, createdAt: "2026-10-20T10:00:00Z", headSha: SHA };
    const never = fake({ ...base, "git ls-remote --heads origin refs/heads/topic": ok(`${SHA}\trefs/heads/topic\n`), [LIST]: list(old), "gh workflow run windows.yml --ref topic": ok("") });
    expect(await startRun(never.deps)).toEqual({ error: expect.stringContaining("no new run") });
    const failing = fake({ ...base, "git ls-remote --heads origin refs/heads/topic": ok(`${SHA}\trefs/heads/topic\n`), [LIST]: { code: 4, stdout: "", stderr: "gh auth login" } });
    expect(await startRun(failing.deps)).toEqual({ error: expect.stringContaining("gh auth login") });
  });
});
