// `bun run update`: `git pull --ff-only`, then `bun install` when the pull changed `bun.lock`. The
// logic is in packages/acp-tui/scripts/update.ts, where its tests reach it.
import { update } from "../packages/acp-tui/scripts/update.ts";

if (import.meta.main) {
  const outcome = update(`${import.meta.dir}/..`);
  for (const line of outcome.lines) (outcome.code === 0 ? console.log : console.error)(line);
  process.exit(outcome.code);
}
