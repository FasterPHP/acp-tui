#!/usr/bin/env bun
// Find benchmark (tui-find "Search cost", mvp-rendering): the real acp-tui under a PTY, 100x30,
// against fake-agent's `long-session` (tool output fenced, as claude-agent-acp sends it) and
// `long-session-plain` (the same items with tool output unfenced, which acp-tui renders and
// projects as Markdown), at 5000 items. Each run sends the first prompt, waits for the turn's
// end, opens the find bar and types `needle-500-back`, and reads the `find` events of the
// ACP_TUI_LOG debug log. Never touches a live Paseo daemon or a real agent.
//
//   bun run bench:find                                    (from the repository root)
//   bun packages/acp-tui/bench/find.ts [options]
//
// Definitions:
// - first: the `search` event's `ms` for the first keystroke (every item's projection is needed;
//   src/find/warm.ts computes them in idle time as items arrive, so the search finds them ready).
// - later: the largest `ms` of the other 14 keystrokes (projections reused).
// - warm-up: the sum of the `warm` events' `ms` (time spent projecting, in idle slices), and the
//   wall time from the turn's end on screen until the projections had caught up (a `warm` event
//   after the last `session_update`).
// - `--now` types at once when the turn ends instead of waiting for the warm-up: the worst case
//   for a user who opens find the moment the agent stops.
//
// Targets (tui-find): first < 100 ms, later < 16 ms.
//
// Options (all optional):
//   --runs <n>          default 5
//   --items <n>         default 5000
//   --scenarios a,b     default long-session,long-session-plain
//   --now               type as soon as the turn ends (see above)
import { cpus, loadavg } from "node:os";
import { sendPrompt, settle, startCli, type CliRun } from "../test/conversation/cli.ts";
import { median } from "./scale.ts";

const NEEDLE = "needle-500-back";
const CTRL_F = { text: "\x06" };

interface Options {
  runs: number;
  items: number;
  scenarios: string[];
  now: boolean;
}

function parse(argv: readonly string[]): Options {
  const o: Options = { runs: 5, items: 5000, scenarios: ["long-session", "long-session-plain"], now: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--runs":
        o.runs = Number(value());
        break;
      case "--items":
        o.items = Number(value());
        break;
      case "--scenarios":
        o.scenarios = value().split(",");
        break;
      case "--now":
        o.now = true;
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }
  return o;
}

interface RunResult {
  first: number;
  later: number;
  warmMs: number;
  warmWait: number;
  hits: number;
}

function findEvents(r: CliRun, action: string): Record<string, unknown>[] {
  return r.events("find").filter((e) => e["action"] === action);
}

async function once(scenario: string, o: Options): Promise<RunResult> {
  const run = startCli({ scenario, cols: 100, rows: 30, agentArgs: ["--items", String(o.items)] });
  const s = run.session;
  try {
    await sendPrompt(s, "scalebench-first-item");
    await s.waitFor(/end turn/, 120000);
    const t0 = Date.now();
    let warmWait = Number.NaN;
    if (!o.now) {
      await s.waitFor(() => {
        // A `warm` event after the last `session_update`.
        const events = run.events();
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i]!["event"] === "session_update") return false;
          if (events[i]!["event"] === "find" && events[i]!["action"] === "warm") return true;
        }
        return false;
      }, 30000);
      warmWait = Date.now() - t0;
      await settle(s);
    }
    s.sendKeys(CTRL_F);
    await s.waitFor((p) => (p.screenText().at(-2) ?? "").startsWith("find: "), 5000);
    s.sendKeys({ text: NEEDLE });
    await s.waitFor(() => findEvents(run, "search").length === NEEDLE.length, 10000);
    const searches = findEvents(run, "search").map((e) => Number(e["ms"]));
    const hits = Number(findEvents(run, "search").at(-1)!["hits"]);
    const warmMs = findEvents(run, "warm").reduce((sum, e) => sum + Number(e["ms"]), 0);
    return { first: searches[0]!, later: Math.max(...searches.slice(1)), warmMs, warmWait, hits };
  } finally {
    s.kill("SIGTERM");
    await s.dispose();
  }
}

const o = parse(process.argv.slice(2));
console.log(`find benchmark: ${o.items} items, ${o.runs} runs per scenario${o.now ? ", typing as the turn ends" : ""}; ${cpus().length} CPUs, load ${loadavg().map((l) => l.toFixed(2)).join(" ")}`);
console.log("scenario              run  first ms  later ms  warm-up ms  waited ms  hits");
for (const scenario of o.scenarios) {
  const results: RunResult[] = [];
  for (let k = 0; k < o.runs; k++) {
    const r = await once(scenario, o);
    results.push(r);
    console.log(
      `${scenario.padEnd(20)} ${String(k + 1).padStart(4)} ${r.first.toFixed(1).padStart(9)} ${r.later.toFixed(1).padStart(9)} ${r.warmMs.toFixed(1).padStart(11)} ${String(Number.isNaN(r.warmWait) ? "-" : r.warmWait).padStart(10)} ${String(r.hits).padStart(5)}`,
    );
  }
  const firsts = results.map((r) => r.first);
  const laters = results.map((r) => r.later);
  console.log(
    `${scenario.padEnd(20)} median first ${median(firsts).toFixed(1)} ms (max ${Math.max(...firsts).toFixed(1)}), later max ${Math.max(...laters).toFixed(1)} ms; ` +
      `${firsts.every((f) => f < 100) && laters.every((l) => l < 16) ? "within" : "OVER"} the targets (100 ms, 16 ms)`,
  );
}
