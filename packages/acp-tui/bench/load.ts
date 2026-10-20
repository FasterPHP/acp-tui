#!/usr/bin/env bun
// Load benchmark (mvp-sessions task 6.3, design decision 10): opens fake-agent's
// built-in session `long-session` with `--resume long-session` (so through
// `session/load`, whose replay acp-tui reduces in slices) under a PTY, 100x30
// by default (the windowed list is the only list), and reads the `frame`, `session_load_request`,
// `session_load_response` and `replay_drained` events of the ACP_TUI_LOG debug
// log. Never touches a live Paseo daemon or a real agent.
//
//   bun run bench:load                                    (from the repository root)
//   bun packages/acp-tui/bench/load.ts [options]
//
// Definitions:
// - longest frame gap: the longest interval without a `frame` event from the `session/load`
//   request to the moment the last item is on screen (bench/scale.ts `longestStall`), so a
//   reduce, a parse or a mount that blocks the event loop shows up even though it logs no frame.
// - response to last item: from the `session_load_response` event (the agent's answer, which
//   acp-tui reads after the last replayed update) to the first moment the screen shows the
//   history's last item among the conversation's last rows with no `loading N` in the status
//   row, polled every 2 ms through the PTY and the emulator.
// - total load: from the `session_load_request` event to that same moment.
//
// Targets (design decision 10, not to be tuned): longest gap <= 100 ms; response to last item
// <= 500 ms; total load no more than 25 per cent above the unbatched 1.4 to 1.6 s that S3
// measured (the populate stall, report S3): <= 1750 ms against 1.4 s (the verdict), 2000 ms
// against 1.6 s.
//
// `--baseline` also runs the same history unbatched, which reproduces S3 on this machine: the
// scenario's first prompt sends the identical updates (8303 at 5000 items), dispatched one store
// notification each and read without pacing (src/agent/connection.ts `pacedStream` paces only a
// load), and the rows give prompt-to-end-turn time and its longest frame gap, for information.
//
// Options (all optional):
//   --runs <n>          default 5
//   --items <n>         default 5000
//   --cols <n> --rows <n>  default 100x30
//   --baseline          also run the unbatched prompt path
//   --json <path>       also write the raw per-run figures as JSON
import { rmSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname } from "node:path";
import { generateLongSessionItems } from "fake-agent";
import { sendPrompt, startCli, type CliRun } from "../test/conversation/cli.ts";
import { statusRow } from "../test/pty/regions.ts";
import { LogTail, longestStall, median, screenHas, until, workTimes } from "./scale.ts";

/** S3's unbatched populate stall, report S3 (design decision 10). */
const S3_UNBATCHED_MS = { low: 1400, high: 1600 } as const;
const TOTAL_LIMIT_MS = Math.round(S3_UNBATCHED_MS.low * 1.25);

interface Options {
  runs: number;
  items: number;
  cols: number;
  rows: number;
  baseline: boolean;
  json: string | null;
}

function parseOptions(argv: string[]): Options {
  const o: Options = { runs: 5, items: 5000, cols: 100, rows: 30, baseline: false, json: null };
  const num = (name: string, value: string | undefined): number => {
    const n = Number(value);
    if (value === undefined || !Number.isFinite(n) || n <= 0) throw new Error(`${name} needs a positive number, got ${value}`);
    return Math.floor(n);
  };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]!;
    const value = argv[i + 1];
    switch (name) {
      case "--runs": o.runs = num(name, value); i++; break;
      case "--items": o.items = num(name, value); i++; break;
      case "--cols": o.cols = num(name, value); i++; break;
      case "--rows": o.rows = num(name, value); i++; break;
      case "--baseline": o.baseline = true; break;
      case "--json": o.json = String(value); i++; break;
      default: throw new Error(`unknown option ${name}`);
    }
  }
  return o;
}

/** Text of the history's last item that its line on screen starts with. */
function lastItemText(items: number): string {
  const last = [...generateLongSessionItems(items)].at(-1)!;
  const text = last.kind === "tool" ? last.title : last.text.split("\n")[0]!.replace(/[*`_#>[\]]/g, "");
  return text.slice(0, 30);
}

/** The conversation's rows above the prompt box, right-trimmed, without blank ones. */
function conversationRows(run: CliRun): string[] {
  const rows = run.session.screenText();
  let top = rows.length;
  for (let y = rows.length - 1; y >= 0; y--) {
    if (rows[y]!.startsWith("╭")) {
      top = y;
      break;
    }
  }
  return rows.slice(0, top).map((r) => r.trimEnd()).filter((r) => r !== "");
}

async function close(run: CliRun): Promise<void> {
  run.session.kill("SIGTERM");
  await run.session.wait(5000).catch(() => undefined);
  await run.session.dispose();
  rmSync(dirname(run.logPath), { recursive: true, force: true });
}

interface LoadRun {
  gapMs: number;
  responseToLastMs: number;
  totalMs: number;
  frames: number;
  worstFrameMs: number;
  slices: number;
  notifications: number;
  updates: number;
  load1: number;
}

async function loadRun(o: Options, needle: string): Promise<LoadRun> {
  const args = ["--resume", "long-session"];
  const run = startCli({ scenario: "long-session", delayScale: 0, cols: o.cols, rows: o.rows, args, agentArgs: ["--items", String(o.items), "--load"] });
  const tail = new LogTail(run.logPath);
  try {
    await until(() => (tail.poll(), tail.of("session_load_response").length > 0), 120000, "the load response", 2);
    const seen = await until(
      async () => {
        if (!(await screenHas(run.session, needle))) return false;
        return !/\bloading \d+/.test(statusRow(run.session)) && conversationRows(run).slice(-4).join("\n").includes(needle);
      },
      60000,
      "the last item on screen",
      2,
    );
    await Bun.sleep(200);
    tail.poll();
    const request = tail.of("session_load_request")[0]!.at;
    const response = tail.of("session_load_response")[0]!.at;
    const drained = tail.of("replay_drained")[0];
    const work = workTimes(tail, request, seen);
    return {
      gapMs: longestStall(tail, request, seen),
      responseToLastMs: seen - response,
      totalMs: seen - request,
      frames: tail.of("frame", request, seen).length,
      worstFrameMs: work.length ? Math.round(Math.max(...work) * 10) / 10 : NaN,
      slices: Number(drained?.["slices"] ?? NaN),
      notifications: Number(drained?.["notifications"] ?? NaN),
      updates: Number(drained?.["updates"] ?? NaN),
      load1: loadavg()[0]!,
    };
  } finally {
    await close(run);
  }
}

interface BaselineRun {
  totalMs: number;
  gapMs: number;
}

async function baselineRun(o: Options): Promise<BaselineRun> {
  const run = startCli({ scenario: "long-session", delayScale: 0, cols: o.cols, rows: o.rows, agentArgs: ["--items", String(o.items)] });
  const tail = new LogTail(run.logPath);
  try {
    await sendPrompt(run.session, "loadbench-baseline");
    const sent = Date.now();
    await until(() => (tail.poll(), tail.of("prompt_response").length > 0), 120000, "prompt_response", 5);
    const seen = await until(() => screenHas(run.session, /\bend turn\b/), 60000, "the end-turn line", 2);
    await Bun.sleep(200);
    tail.poll();
    return { totalMs: seen - sent, gapMs: longestStall(tail, sent, seen) };
  } finally {
    await close(run);
  }
}

function git(...args: string[]): string {
  return Bun.spawnSync(["git", ...args]).stdout.toString().trim();
}

async function main(): Promise<void> {
  const o = parseOptions(process.argv.slice(2));
  const needle = lastItemText(o.items);
  const loads: LoadRun[] = [];
  const baselines: BaselineRun[] = [];
  for (let i = 0; i < o.runs; i++) {
    if (o.baseline) baselines.push(await baselineRun(o));
    loads.push(await loadRun(o, needle));
    const l = loads.at(-1)!;
    const b = baselines.at(-1);
    console.error(
      `run ${i + 1}: gap ${l.gapMs} ms, response to last ${l.responseToLastMs} ms, total ${l.totalMs} ms` +
        `${b ? `, unbatched ${b.totalMs} ms (gap ${b.gapMs} ms)` : ""}, ${l.notifications} notifications, load ${l.load1.toFixed(2)}`,
    );
  }
  const rows: string[][] = [];
  const pass = (ok: boolean): string => (ok ? "pass" : "MISS");
  const per = (values: number[]): string => values.map((v) => String(Math.round(v))).join(", ");
  const row = (name: string, target: string, values: number[], ok?: boolean): void => {
    rows.push([name, target, String(Math.round(median(values))), String(Math.round(Math.max(...values))), ok === undefined ? "" : pass(ok), per(values)]);
  };
  const gaps = loads.map((l) => l.gapMs);
  const resp = loads.map((l) => l.responseToLastMs);
  const totals = loads.map((l) => l.totalMs);
  row("Longest frame gap during the load (ms)", "<= 100", gaps, Math.max(...gaps) <= 100);
  row("Response to last item on screen (ms)", "<= 500", resp, Math.max(...resp) <= 500);
  row(
    "Total load (ms)",
    `<= ${TOTAL_LIMIT_MS} (1.25 x ${S3_UNBATCHED_MS.low}; ${Math.round(S3_UNBATCHED_MS.high * 1.25)} against ${S3_UNBATCHED_MS.high})`,
    totals,
    Math.max(...totals) <= TOTAL_LIMIT_MS,
  );
  if (baselines.length) {
    row("Unbatched (prompt path): prompt to end turn (ms)", "information", baselines.map((b) => b.totalMs));
    row("Unbatched (prompt path): longest frame gap (ms)", "information", baselines.map((b) => b.gapMs));
  }
  row("Frames during the load", "", loads.map((l) => l.frames));
  row("Worst frame's own time (ms)", "", loads.map((l) => l.worstFrameMs));
  row("Store notifications during the replay", "< 500", loads.map((l) => l.notifications), Math.max(...loads.map((l) => l.notifications)) < 500);
  row("Drain slices", "", loads.map((l) => l.slices));

  const head = ["Metric", "Target", "Median", "Worst", "Result", "Per run"];
  const dirty = git("status", "--porcelain").length > 0;
  console.log(`Load benchmark: long-session --items ${o.items} (${loads[0]?.updates ?? "?"} updates) via session/load, ${o.cols}x${o.rows} PTY, ${o.runs} runs`);
  console.log(`Load average (1 min) per run: ${loads.map((l) => l.load1.toFixed(2)).join(", ")}`);
  console.log(`Environment: ${process.platform} ${process.arch}, ${cpus()[0]?.model ?? "unknown CPU"} (${cpus().length} logical CPUs), Bun ${Bun.version}, commit ${git("rev-parse", "--short", "HEAD")}${dirty ? " plus working-tree changes" : ""}`);
  console.log("");
  console.log(`| ${head.join(" | ")} |`);
  console.log(`| ${head.map(() => "---").join(" | ")} |`);
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
  if (o.json) await Bun.write(o.json, JSON.stringify({ options: o, loads, baselines }, null, 2));
}

if (import.meta.main) await main();
