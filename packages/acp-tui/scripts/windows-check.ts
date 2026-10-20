// The parts of `bun run test:windows` (scripts/test-windows.ts) that tests reach: the Windows check
// (.github/workflows/windows.yml) for the current branch.
//
// It refuses unless the branch is pushed and the remote's head is the local head (the workflow
// tests what GitHub has), starts the workflow with `gh workflow run`, finds the run it started
// (a new run, for this commit, on this branch), then follows it with `gh run watch --exit-status`
// and exits with the run's result. `gh` and `git` are started with argument lists, never a shell.
//
// The pure parts (argument lists, run selection) are exported and unit-tested with an injected
// runner (test/cli/test-windows.test.ts).
export const WORKFLOW = "windows.yml";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Runs `command` with `args` (no shell) and collects its output. */
export type Runner = (command: string, args: readonly string[]) => Promise<CommandResult>;

export interface RunInfo {
  databaseId: number;
  createdAt: string;
  headSha: string;
}

export const gitArgs = {
  branch: (): string[] => ["rev-parse", "--abbrev-ref", "HEAD"],
  head: (): string[] => ["rev-parse", "HEAD"],
  remoteHead: (remote: string, branch: string): string[] => ["ls-remote", "--heads", remote, `refs/heads/${branch}`],
  dirty: (): string[] => ["status", "--porcelain"],
};

export const ghArgs = {
  dispatch: (branch: string): string[] => ["workflow", "run", WORKFLOW, "--ref", branch],
  list: (branch: string): string[] => ["run", "list", "--workflow", WORKFLOW, "--branch", branch, "--limit", "10", "--json", "databaseId,createdAt,headSha"],
  watch: (id: number): string[] => ["run", "watch", String(id), "--exit-status"],
};

/** The sha `git ls-remote --heads` printed for the branch, or null when it prints none. */
export function parseRemoteHead(output: string): string | null {
  const first = output.split("\n").find((line) => line.trim() !== "");
  const sha = first?.split(/\s+/)[0];
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** Why the branch cannot be checked, or null when the remote has the local head. */
export function refusal(branch: string, local: string, remote: string | null): string | null {
  if (branch === "HEAD") return "HEAD is detached: check out the branch to test, push it, and run this again.";
  if (remote === null) return `branch '${branch}' is not pushed: push it first (git push -u origin ${branch}).`;
  if (remote !== local) return `the remote's '${branch}' (${remote.slice(0, 7)}) is not the local head (${local.slice(0, 7)}): push your commits, or pull, so GitHub tests what you have.`;
  return null;
}

/** Parses `gh run list --json` output; throws on anything that is not a list of runs. */
export function parseRuns(json: string): RunInfo[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error("gh run list did not print a list");
  return data.map((r) => {
    const run = r as Partial<RunInfo>;
    if (typeof run.databaseId !== "number" || typeof run.headSha !== "string" || typeof run.createdAt !== "string") throw new Error("gh run list printed a run without databaseId, createdAt or headSha");
    return { databaseId: run.databaseId, createdAt: run.createdAt, headSha: run.headSha };
  });
}

/**
 * The run this script started: the newest run for `headSha` that was not in the list taken before
 * the dispatch (`known`), so a clock that differs from GitHub's cannot confuse it. Null while the
 * run has not appeared.
 */
export function selectRun(runs: readonly RunInfo[], known: ReadonlySet<number>, headSha: string): RunInfo | null {
  const fresh = runs.filter((r) => !known.has(r.databaseId) && r.headSha === headSha);
  fresh.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return fresh[0] ?? null;
}

export interface Deps {
  run: Runner;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** Milliseconds between looks for the new run, and how long to look. */
  pollMs: number;
  waitMs: number;
}

export const spawnRunner: Runner = async (command, args) => {
  const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
};

/** Like `spawnRunner` but with the child's output shown as it comes, for `gh run watch`. */
export const inheritRunner = async (command: string, args: readonly string[]): Promise<number> => {
  const proc = Bun.spawn([command, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return await proc.exited;
};

async function must(deps: Deps, command: string, args: readonly string[]): Promise<string> {
  const r = await deps.run(command, args);
  if (r.code !== 0) throw new Error(`${command} ${args.join(" ")} failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout;
}

/** Everything but following the run: returns the run to watch, or an error message. */
export async function startRun(deps: Deps, remote = "origin"): Promise<{ run: RunInfo; branch: string } | { error: string }> {
  try {
    const branch = (await must(deps, "git", gitArgs.branch())).trim();
    const local = (await must(deps, "git", gitArgs.head())).trim();
    const remoteHead = parseRemoteHead(await must(deps, "git", gitArgs.remoteHead(remote, branch)));
    const no = refusal(branch, local, remoteHead);
    if (no) return { error: no };
    if ((await must(deps, "git", gitArgs.dirty())).trim() !== "") deps.log("note: the working tree has uncommitted changes; the run tests the pushed commit only.");

    const known = new Set(parseRuns(await must(deps, "gh", ghArgs.list(branch))).map((r) => r.databaseId));
    deps.log(`starting ${WORKFLOW} for ${branch} at ${local.slice(0, 7)}`);
    await must(deps, "gh", ghArgs.dispatch(branch));

    for (let waited = 0; waited <= deps.waitMs; waited += deps.pollMs) {
      const found = selectRun(parseRuns(await must(deps, "gh", ghArgs.list(branch))), known, local);
      if (found) return { run: found, branch };
      await deps.sleep(deps.pollMs);
    }
    return { error: `no new run of ${WORKFLOW} for ${local.slice(0, 7)} appeared within ${Math.round(deps.waitMs / 1000)} s.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
