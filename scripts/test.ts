// `bun run test`: the workspace suite in two passes (parallel-tests D1, D2).
//
//   1. The parallel pass: every test file except the timing tests, in Bun's worker processes
//      (`bun test --parallel=<workers> --path-ignore-patterns='**/*.timing.test.ts'`).
//   2. The serial pass: the `*.timing.test.ts` files alone, one process, started only after the
//      first pass has exited, so their wall-clock and frame budgets run on a quiet machine. It runs
//      even if the first pass failed, so one run shows every failure.
//
//   bun run test [paths...] [-t <pattern>] [--parallel-only | --timing-only] [--retry-failed]
//                [other bun test flags]
//
// `--retry-failed` (for a slow, shared machine such as a hosted CI runner, where screen-reading PTY
// tests can lose a race they never lose elsewhere): when the parallel pass fails, the test files
// with a failing test (read from Bun's JUnit report) run once more, on their own and serially, and
// the pass counts as passed only if that retry passes. A failure that repeats still fails the run.
//
// Paths and every other argument go to both passes; for the serial pass the paths are narrowed to
// the timing files they select, and a pass with no files left is skipped with a line saying so.
// The worker count is ACP_TUI_TEST_WORKERS (default 12, the largest count with no failure on
// Marcus's 32-thread desktop; see docs/mvp-notes/parallel-tests.md). The exit status is non-zero
// if either pass failed. Plain `bun test` still runs everything serially, as before.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relative, resolve } from "node:path";

const DEFAULT_WORKERS = 12;
const TIMING_SUFFIX = ".timing.test.ts";
const TEST_FILE = /(\.test|_test|\.spec|_spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

type Pass = { name: string; args: string[] };
type Result = { name: string; code: number; seconds: number; summary: string[] };

function usage(): never {
  console.log(
    "usage: bun run test [paths...] [-t <pattern>] [--parallel-only | --timing-only] [--retry-failed] [bun test flags]\n" +
      "  ACP_TUI_TEST_WORKERS=<n> sets the parallel pass's workers (default 12)",
  );
  process.exit(0);
}

function workers(): number {
  const raw = process.env.ACP_TUI_TEST_WORKERS;
  if (raw === undefined || raw === "") return DEFAULT_WORKERS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`ACP_TUI_TEST_WORKERS must be a positive integer, not ${JSON.stringify(raw)}`);
    process.exit(2);
  }
  return n;
}

// Bun's options that take their value as the next argument (`-t foo`), so it is not taken for a
// path. The `--name=value` form needs no entry here.
const VALUE_FLAGS = new Set([
  "-t",
  "--test-name-pattern",
  "--timeout",
  "--rerun-each",
  "--preload",
  "--reporter",
  "--reporter-outfile",
  "--coverage-reporter",
  "--coverage-dir",
  "--seed",
  "--max-concurrency",
]);

function parseArgs(argv: string[]) {
  let parallelOnly = false;
  let timingOnly = false;
  let retryFailed = false;
  const paths: string[] = [];
  const flags: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--parallel-only") parallelOnly = true;
    else if (arg === "--timing-only") timingOnly = true;
    else if (arg === "--retry-failed") retryFailed = true;
    else if (arg === "-h" || arg === "--help") usage();
    else if (arg === "--parallel" || arg.startsWith("--parallel=")) {
      console.error("set the worker count with ACP_TUI_TEST_WORKERS, not --parallel");
      process.exit(2);
    } else if (arg.startsWith("-")) {
      flags.push(arg);
      if (VALUE_FLAGS.has(arg) && i + 1 < argv.length) flags.push(argv[++i]!);
    } else paths.push(arg);
  }
  if (parallelOnly && timingOnly) {
    console.error("--parallel-only and --timing-only exclude each other");
    process.exit(2);
  }
  return { parallelOnly, timingOnly, retryFailed, paths, flags };
}

// A path with `/` for its separator on every platform (Bun takes it on Windows), so a path
// argument written with `/` is found as a substring and a `./` prefix names the file.
const slashed = (path: string): string => path.replaceAll("\\", "/");

// The test files under a directory, relative to the working directory. Glob results use the
// platform's separator, so a path is split on both.
async function testFilesUnder(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob("**/*").scan({ cwd: dir, onlyFiles: true })) {
    if (file.split(/[\\/]/).some((part) => part === "node_modules" || part.startsWith("."))) continue;
    if (TEST_FILE.test(file)) files.push(slashed(relative(process.cwd(), resolve(dir, file))));
  }
  return files;
}

// The files the path arguments select, as Bun would: an existing file selects itself, an existing
// directory what is under it, and anything else is a filter Bun matches as a substring of the path
// of every test file under the working directory.
async function selected(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return (await testFilesUnder(".")).sort();
  const chosen = new Set<string>();
  let all: string[] | undefined;
  for (const arg of paths) {
    if (existsSync(arg) && statSync(arg).isDirectory()) for (const f of await testFilesUnder(arg)) chosen.add(f);
    else if (existsSync(arg)) chosen.add(slashed(relative(process.cwd(), resolve(arg))));
    else for (const f of (all ??= await testFilesUnder("."))) if (f.includes(slashed(arg))) chosen.add(f);
  }
  return [...chosen].sort();
}

// Bun prints its summary on stderr: "N pass", "N skip", "N fail", "Ran N tests across M files".
const SUMMARY = /^\s*(\d+ (pass|skip|fail|todo|snapshots?.*)|Ran \d+ tests? across \d+ files?.*)$/;
const ANSI = /\x1b\[[0-9;]*m/g;

async function run(pass: Pass): Promise<Result> {
  console.log(`\n=== ${pass.name}: bun ${pass.args.join(" ")}\n`);
  const started = performance.now();
  const colour = process.stdout.isTTY ? { FORCE_COLOR: "1" } : {};
  const proc = Bun.spawn(["bun", ...pass.args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...colour },
  });
  const summary: string[] = [];
  const pump = async (stream: ReadableStream<Uint8Array>, out: NodeJS.WriteStream) => {
    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of stream) {
      out.write(chunk);
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines) {
        const plain = line.replace(ANSI, "");
        if (SUMMARY.test(plain)) summary.push(plain.trim());
      }
    }
  };
  await Promise.all([pump(proc.stdout, process.stdout), pump(proc.stderr, process.stderr)]);
  const code = await proc.exited;
  return { name: pass.name, code, seconds: (performance.now() - started) / 1000, summary };
}

// The files of a JUnit report (Bun's `--reporter=junit`) with a failing test: the top-level
// `<testsuite>` of each file carries the file as both its name and its `file` attribute.
function failedFiles(xml: string): string[] {
  const files = new Set<string>();
  for (const m of xml.matchAll(/<testsuite name="([^"]+)" file="([^"]+)"[^>]*\bfailures="(\d+)"/g)) {
    if (m[1] === m[2] && Number(m[3]) > 0) files.add(m[2]!);
  }
  return [...files].sort();
}

const { parallelOnly, timingOnly, retryFailed, paths, flags } = parseArgs(process.argv.slice(2));
const chosen = await selected(paths);
const timing = chosen.filter((file) => file.endsWith(TIMING_SUFFIX));
const others = chosen.filter((file) => !file.endsWith(TIMING_SUFFIX));

const results: Result[] = [];
// The summary's lines in pass order: a result, or the line saying a pass was skipped.
const report: (Result | string)[] = [];

if (!timingOnly) {
  if (others.length === 0) report.push("parallel pass: no test files outside *.timing.test.ts, skipped");
  else {
    const junitDir = retryFailed ? mkdtempSync(join(tmpdir(), "acp-tui-junit-")) : null;
    const junit = junitDir === null ? [] : ["--reporter=junit", `--reporter-outfile=${join(junitDir, "parallel.xml")}`];
    const args = ["test", `--parallel=${workers()}`, `--path-ignore-patterns=**/*${TIMING_SUFFIX}`, ...junit, ...flags, ...paths];
    const result = await run({ name: "parallel pass", args });
    report.push(result);
    if (result.code !== 0 && junitDir !== null) {
      const xmlPath = join(junitDir, "parallel.xml");
      const failed = existsSync(xmlPath) ? failedFiles(readFileSync(xmlPath, "utf8")) : [];
      if (failed.length === 0) report.push("retry: no failing file named in the report, so nothing to retry");
      else {
        const files = failed.map((f) => (f.startsWith("..") ? f : `./${f}`));
        const retry = await run({ name: `retry of ${failed.length} failed file(s)`, args: ["test", ...flags, ...files] });
        report.push(retry);
        // The parallel pass stands or falls with its retry; the report keeps both lines.
        results.push({ ...result, code: retry.code });
      }
    }
    if (junitDir !== null) rmSync(junitDir, { recursive: true, force: true });
    if (results.length === 0) results.push(result);
  }
}
if (!parallelOnly) {
  if (timing.length === 0) report.push("serial pass: no *.timing.test.ts files, skipped");
  // Bun takes a bare path argument as a filter; "./" (or "../") makes it name exactly that file.
  else {
    const files = timing.map((f) => (f.startsWith("..") ? f : `./${f}`));
    const result = await run({ name: "serial pass", args: ["test", ...flags, ...files] });
    results.push(result);
    report.push(result);
  }
}

console.log("\n=== bun run test");
for (const r of report) {
  if (typeof r === "string") {
    console.log(r);
    continue;
  }
  const verdict = r.code === 0 ? "passed" : `FAILED (exit ${r.code})`;
  console.log(`${r.name}: ${verdict} in ${r.seconds.toFixed(1)} s; ${r.summary.join(", ") || "no summary"}`);
}
if (results.length === 0) console.log("no test files selected");
process.exit(results.some((r) => r.code !== 0) || results.length === 0 ? 1 : 0);
