// `bun run test:windows [--remote <name>]`: the Windows check (.github/workflows/windows.yml) for the
// current branch. It refuses unless the branch is pushed and the remote has the local head, starts the
// workflow with `gh workflow run`, finds the run it started, follows it with `gh run watch
// --exit-status` and exits with the run's result. The logic is in
// packages/acp-tui/scripts/windows-check.ts, where its tests reach it.
import { ghArgs, inheritRunner, spawnRunner, startRun, type Deps } from "../packages/acp-tui/scripts/windows-check.ts";

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--remote");
  const remote = at >= 0 ? (args[at + 1] ?? "origin") : "origin";
  const deps: Deps = { run: spawnRunner, log: (line) => console.log(line), sleep: (ms) => Bun.sleep(ms), pollMs: 3000, waitMs: 120_000 };
  const started = await startRun(deps, remote);
  if ("error" in started) {
    console.error(`test:windows: ${started.error}`);
    process.exit(1);
  }
  console.log(`watching run ${started.run.databaseId} (gh run view ${started.run.databaseId} --web for the page)`);
  process.exit(await inheritRunner("gh", ghArgs.watch(started.run.databaseId)));
}
