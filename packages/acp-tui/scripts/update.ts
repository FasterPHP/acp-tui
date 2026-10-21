// The logic of `bun run update` (scripts/update.ts at the root), here where its tests reach it:
// `git pull --ff-only`, then `bun install` when the pull changed `bun.lock` (a pull that changes
// dependencies without an install fails later with "Cannot find module"). Written in TypeScript
// rather than sh so it also runs in PowerShell. A dirty work tree or a pull that cannot fast-forward
// is refused with git's own message.

export interface StepResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (cmd: string[], cwd: string) => StepResult;

export const spawnRunner: Runner = (cmd, cwd) => {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  return { code: proc.exitCode ?? 1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
};

export interface UpdateOutcome {
  code: number;
  lines: string[];
}

function failure(step: string, result: StepResult): UpdateOutcome {
  const text = (result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`).split("\n");
  return { code: result.code === 0 ? 1 : result.code, lines: [`update: ${step} failed:`, ...text.map((line) => `  ${line}`)] };
}

export function update(cwd: string, run: Runner = spawnRunner): UpdateOutcome {
  const lines: string[] = [];
  const status = run(["git", "status", "--porcelain", "--untracked-files=no"], cwd);
  if (status.code !== 0) return failure("git status", status);
  if (status.stdout.trim() !== "") {
    return { code: 1, lines: ["update: the checkout has local changes; commit or stash them first:", ...status.stdout.trimEnd().split("\n").map((line) => `  ${line}`)] };
  }
  const before = run(["git", "rev-parse", "HEAD"], cwd);
  if (before.code !== 0) return failure("git rev-parse", before);
  const pull = run(["git", "pull", "--ff-only"], cwd);
  if (pull.code !== 0) return failure("git pull --ff-only", pull);
  const after = run(["git", "rev-parse", "HEAD"], cwd);
  if (after.code !== 0) return failure("git rev-parse", after);
  const from = before.stdout.trim();
  const to = after.stdout.trim();
  if (from === to) {
    lines.push(`already up to date at ${to.slice(0, 7)}`);
    return { code: 0, lines };
  }
  lines.push(`updated ${from.slice(0, 7)} to ${to.slice(0, 7)}`);
  const changed = run(["git", "diff", "--name-only", from, to, "--", "bun.lock"], cwd);
  if (changed.code !== 0) return failure("git diff", changed);
  if (changed.stdout.trim() === "") {
    lines.push("bun.lock unchanged: no install needed");
    return { code: 0, lines };
  }
  const install = run([process.execPath, "install"], cwd);
  if (install.code !== 0) return { code: install.code, lines: [...lines, ...failure("bun install", install).lines] };
  lines.push("bun.lock changed: ran bun install");
  return { code: 0, lines };
}
