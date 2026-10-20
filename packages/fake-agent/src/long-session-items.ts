// Content generator for the "long-session" scenario (design D11): a long,
// mixed conversation for scale, find and hand-back work (spikes S1, S3, S5).
//
// Everything here is a pure function of the item count, driven by a seeded
// generator, so two runs (or two machines) produce byte-identical sessions.
// Item `i` does not depend on the total, except for the needle slot and the
// failure slots, which are derived from the count.
import { between, createRng, pick } from "./prng.ts";

export const LONG_SESSION_DEFAULT_ITEMS = 200;

/** The phrase S5 searches for; it appears exactly once, inside a long tool output. */
export const LONG_SESSION_NEEDLE = "needle-500-back";

/** How many items from the end (counting the needle itself) the needle sits. */
export const LONG_SESSION_NEEDLE_DISTANCE = 500;

/** One failed tool call per this many items. */
export const LONG_SESSION_FAILURE_WINDOW = 50;

/** A plan update after every this many items. */
export const LONG_SESSION_PLAN_EVERY = 25;

/** Bounds on an execute call's output, in lines. */
export const LONG_SESSION_EXECUTE_MIN_LINES = 20;
export const LONG_SESSION_EXECUTE_MAX_LINES = 400;

const SEED = 0x5eed_1a01;

/**
 * A tool's output as `claude-agent-acp` sends it: fenced (files with their language, command
 * output as `console`), so acp-tui renders it as one code block (mvp-rendering task 9.2). The
 * lines inside are the generated ones, unchanged.
 */
export function fenceOutput(lang: string, text: string): string {
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

export interface LongSessionOptions {
  /**
   * Fence tool output as `claude-agent-acp` does (the default). False sends it plain, as agents
   * that do not fence it would (`long-session-plain`), for the find's first-search cost over
   * Markdown-rendered tool text (acp-tui's tui-find "Search cost"). The items are otherwise
   * identical.
   */
  readonly fenced?: boolean;
}

/** Wraps a tool's output: `fenceOutput`, or the text unchanged when the session is plain. */
type Fence = (lang: string, text: string) => string;

const plainOutput: Fence = (_lang, text) => text;

/** A file's fence language by its extension. */
function fileLang(path: string): string {
  if (path.endsWith(".php")) return "php";
  if (path.endsWith(".ts")) return "ts";
  return "";
}
const FAILURE_SEED = 0x5eed_fa11;

/**
 * Zero-based index of the item holding the needle, or null when the session
 * has fewer than 500 items. Item `count - 500` is the 500th from the end, the
 * needle's own item included, so for n = 5000 it is item 4500 and the last
 * item is 4999. Sessions shorter than 500 items have no needle: there is no
 * item that far back, and clamping it to the first item would put the
 * "500 back" phrase 20 back in a 520-item session.
 */
export function longSessionNeedleIndex(count: number): number | null {
  return count >= LONG_SESSION_NEEDLE_DISTANCE ? count - LONG_SESSION_NEEDLE_DISTANCE : null;
}

export type LongSessionToolKind = "read" | "search" | "edit" | "execute";

export type LongSessionItem =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "answer"; readonly text: string }
  | { readonly kind: "thought"; readonly text: string }
  | {
      readonly kind: "tool";
      readonly toolKind: LongSessionToolKind;
      readonly title: string;
      readonly path: string;
      readonly failed: boolean;
      /** Text output for read, search and execute calls; null for edits. */
      readonly output: string | null;
      /** The diff of an edit call; null for the others. */
      readonly diff: { readonly oldText: string; readonly newText: string } | null;
    };

const FILES = [
  "src/Kernel.php",
  "src/Http/Router.php",
  "src/Http/Request.php",
  "src/Db/Connection.php",
  "src/Db/QueryBuilder.php",
  "src/Model/Patient.php",
  "src/Model/Appointment.php",
  "src/View/Renderer.php",
  "src/Config/Loader.php",
  "tests/Unit/RouterTest.php",
  "tests/Unit/QueryBuilderTest.php",
  "web/assets/app.ts",
  "web/assets/forms.ts",
  "docs/architecture.md",
  "composer.json",
] as const;

const SYMBOLS = [
  "resolveRoute",
  "buildQuery",
  "hydrateModel",
  "renderTemplate",
  "loadConfig",
  "handleRequest",
  "bindParameters",
  "normalisePath",
] as const;

const COMMANDS = [
  "composer test",
  "vendor/bin/phpunit --testdox",
  "vendor/bin/phpstan analyse src",
  "bun test",
  "bun run typecheck",
  "git diff --stat",
] as const;

const THOUGHT_TITLES = [
  "Planning the change",
  "Checking the callers",
  "Weighing two approaches",
  "Reading the failing test",
  "Deciding what to leave alone",
  "Working out the edge cases",
] as const;

const THOUGHT_SENTENCES = [
  "The router already normalises paths, so the fix belongs one layer down.",
  "Two callers pass a nullable value here, which the current signature does not allow.",
  "A smaller change keeps the diff reviewable and avoids touching the public API.",
  "The failing test only covers the happy path, so an extra case is worth adding.",
  "Renaming the helper would ripple through four files for no functional gain.",
  "The query builder escapes identifiers but not the alias, which is the real bug.",
] as const;

const USER_PROMPTS = [
  "Can you look at how %FILE% handles this and tell me what you find?",
  "The tests around %FILE% are flaky. What is going on?",
  "Please tidy %SYMBOL% so it copes with empty input.",
  "Why does %SYMBOL% return early here?",
  "Add a test for the case where %SYMBOL% receives a null.",
] as const;

function fill(template: string, rng: () => number): string {
  return template.replace("%FILE%", pick(rng, FILES)).replace("%SYMBOL%", pick(rng, SYMBOLS));
}

// -- Markdown answers -----------------------------------------------------------------------------

function answerWithCode(rng: () => number): string {
  const file = pick(rng, FILES);
  const symbol = pick(rng, SYMBOLS);
  const php = file.endsWith(".php");
  const code = php
    ? `public function ${symbol}(?string $value): string\n{\n    if ($value === null || $value === '') {\n        return '';\n    }\n\n    return trim($value, '/');\n}`
    : `export function ${symbol}(value: string | null): string {\n  if (value === null || value === "") {\n    return "";\n  }\n  return value.replace(/^\\/+|\\/+$/g, "");\n}`;
  return (
    `I looked at \`${file}\` and the problem is in \`${symbol}\`. It **assumes a non-empty value**, ` +
    `so the empty case falls through to the wrong branch.\n\n` +
    `\`\`\`${php ? "php" : "ts"}\n${code}\n\`\`\`\n\n` +
    `- the guard now returns early for null and empty input\n` +
    `- the trimming behaviour is unchanged for everything else\n` +
    `- callers need no changes\n`
  );
}

function answerWithTable(rng: () => number): string {
  const rows = Array.from({ length: between(rng, 3, 5) }, () => {
    const status = pick(rng, ["passing", "failing", "skipped"] as const);
    return `| \`${pick(rng, FILES)}\` | ${between(rng, 1, 40)} | ${status} |`;
  });
  return (
    `## Test summary\n\n` +
    `Here is where things stand after the change:\n\n` +
    `| File | Tests | Status |\n| --- | --- | --- |\n${rows.join("\n")}\n\n` +
    `The failing rows are unrelated to this edit; they fail on the base commit too.\n`
  );
}

function answerWithSteps(rng: () => number): string {
  const symbol = pick(rng, SYMBOLS);
  return (
    `Short version: \`${symbol}\` is fine, the **caller** is wrong.\n\n` +
    `1. read the value from the request\n2. validate it before it reaches \`${symbol}\`\n3. pass the validated value on\n\n` +
    `See [the architecture notes](docs/architecture.md) for why validation lives at the edge.\n`
  );
}

function makeAnswer(rng: () => number): string {
  return pick(rng, [answerWithCode, answerWithTable, answerWithSteps] as const)(rng);
}

// -- Tool calls -----------------------------------------------------------------------------------

function codeLines(rng: () => number, count: number): string {
  return Array.from({ length: count }, (_, i) => {
    const indent = "    ".repeat(between(rng, 0, 2));
    return `${indent}$${pick(rng, SYMBOLS)}${i} = ${pick(rng, SYMBOLS)}(${between(rng, 0, 999)});`;
  }).join("\n");
}

function makeRead(rng: () => number, fence: Fence): LongSessionItem {
  const path = pick(rng, FILES);
  return {
    kind: "tool",
    toolKind: "read",
    title: `Read ${path}`,
    path,
    failed: false,
    output: fence(fileLang(path), codeLines(rng, between(rng, 5, 30))),
    diff: null,
  };
}

function makeSearch(rng: () => number, fence: Fence): LongSessionItem {
  const symbol = pick(rng, SYMBOLS);
  const matches = Array.from(
    { length: between(rng, 3, 15) },
    () => `${pick(rng, FILES)}:${between(rng, 1, 400)}: ${symbol}(${between(rng, 0, 99)})`,
  );
  return {
    kind: "tool",
    toolKind: "search",
    title: `Search for "${symbol}"`,
    path: "",
    failed: false,
    output: fence("", matches.join("\n")),
    diff: null,
  };
}

function makeEdit(rng: () => number): LongSessionItem {
  const path = pick(rng, FILES);
  const total = between(rng, 12, 40);
  const oldLines = Array.from({ length: total }, (_, i) => `    line ${i + 1} of ${path}`);
  const start = between(rng, 2, total - 6);
  const removed = between(rng, 1, 4);
  const added = Array.from({ length: between(rng, 1, 8) }, (_, i) => `    changed ${i + 1}: ${pick(rng, SYMBOLS)}();`);
  const newLines = [...oldLines.slice(0, start), ...added, ...oldLines.slice(start + removed)];
  return {
    kind: "tool",
    toolKind: "edit",
    title: `Edit ${path}`,
    path,
    failed: false,
    output: null,
    diff: { oldText: `${oldLines.join("\n")}\n`, newText: `${newLines.join("\n")}\n` },
  };
}

/** Skewed towards the short end: most runs are a screen or two, a few are long. */
function executeLineCount(rng: () => number): number {
  const r = rng();
  return (
    LONG_SESSION_EXECUTE_MIN_LINES +
    Math.floor(r * r * r * (LONG_SESSION_EXECUTE_MAX_LINES - LONG_SESSION_EXECUTE_MIN_LINES + 1))
  );
}

function makeExecute(rng: () => number, fence: Fence): LongSessionItem {
  const command = pick(rng, COMMANDS);
  const lines = Array.from({ length: executeLineCount(rng) }, (_, i) =>
    i % 7 === 6
      ? `WARN  slow test: ${pick(rng, FILES)} (${between(rng, 200, 900)} ms)`
      : `PASS  ${pick(rng, FILES)} > case ${i + 1} (${between(rng, 1, 90)} ms)`,
  );
  return {
    kind: "tool",
    toolKind: "execute",
    title: `Run ${command}`,
    path: "",
    failed: false,
    output: fence("console", lines.join("\n")),
    diff: null,
  };
}

function makeNeedle(fence: Fence): LongSessionItem {
  const lines = Array.from({ length: 60 }, (_, i) => `PASS  tests/Unit/Case${i + 1}Test.php (${(i * 7) % 90 + 1} ms)`);
  lines[30] = `INFO  ${LONG_SESSION_NEEDLE}: the marker for the find spike`;
  return {
    kind: "tool",
    toolKind: "execute",
    title: "Run vendor/bin/phpunit --testdox",
    path: "",
    failed: false,
    output: fence("console", lines.join("\n")),
    diff: null,
  };
}

function failed(item: Extract<LongSessionItem, { kind: "tool" }>): LongSessionItem {
  const output =
    item.toolKind === "execute"
      ? "FAIL  1 test failed\nExit code 1"
      : item.toolKind === "edit"
        ? "Error: the file changed on disk since it was read"
        : "Error: ENOENT: no such file or directory";
  return { ...item, failed: true, output, diff: null };
}

// -- Blocks and the item stream -------------------------------------------------------------------

type BlockKind = "user" | "thought" | "run" | "answer" | "edit" | "execute";

/** A turn's rhythm: ask, think, look around (3 to 6 reads and searches), answer, act, answer. */
const CYCLE: readonly BlockKind[] = ["user", "thought", "run", "answer", "edit", "execute", "answer"];

function makeBlock(kind: BlockKind, rng: () => number, fence: Fence): LongSessionItem[] {
  switch (kind) {
    case "user":
      return [{ kind: "user", text: fill(pick(rng, USER_PROMPTS), rng) }];
    case "thought":
      return [
        {
          kind: "thought",
          text: `**${pick(rng, THOUGHT_TITLES)}**\n\n${pick(rng, THOUGHT_SENTENCES)} ${pick(rng, THOUGHT_SENTENCES)}`,
        },
      ];
    case "run":
      return Array.from({ length: between(rng, 3, 6) }, () => (rng() < 0.6 ? makeRead(rng, fence) : makeSearch(rng, fence)));
    case "answer":
      return [{ kind: "answer", text: makeAnswer(rng) }];
    case "edit":
      return [makeEdit(rng)];
    case "execute":
      return [makeExecute(rng, fence)];
  }
}

/**
 * Yields exactly `count` items. One tool call in each complete window of 50
 * items fails (the first tool call at or after a seeded slot in the window,
 * never the needle's). The item at `longSessionNeedleIndex(count)`, if any,
 * is replaced by an execute call whose output holds the needle. Tool output is fenced unless
 * `options.fenced` is false.
 */
export function* generateLongSessionItems(count: number, options: LongSessionOptions = {}): Generator<LongSessionItem> {
  const fence: Fence = options.fenced === false ? plainOutput : fenceOutput;
  const rng = createRng(SEED);
  const failureRng = createRng(FAILURE_SEED);
  const needleIndex = longSessionNeedleIndex(count);

  // Slots 10 to 39 of each window leave at least ten items for a tool call to land in.
  const pendingFailures: number[] = [];
  for (let window = 0; (window + 1) * LONG_SESSION_FAILURE_WINDOW <= count; window += 1) {
    pendingFailures.push(window * LONG_SESSION_FAILURE_WINDOW + between(failureRng, 10, 39));
  }

  let index = 0;
  for (let step = 0; index < count; step += 1) {
    for (const item of makeBlock(CYCLE[step % CYCLE.length] as BlockKind, rng, fence)) {
      if (index >= count) {
        return;
      }
      if (index === needleIndex) {
        yield makeNeedle(fence);
      } else if (item.kind === "tool" && pendingFailures.length > 0 && index >= (pendingFailures[0] as number)) {
        pendingFailures.shift();
        yield failed(item);
      } else {
        yield item;
      }
      index += 1;
    }
  }
}

/** The plan reported after the `number`-th multiple of 25 items (1-based). */
export function longSessionPlan(number: number): {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}[] {
  const steps = ["Read the affected files", "Make the edit", "Run the tests", "Summarise the result"];
  const done = number % (steps.length + 1);
  return steps.map((content, i) => ({
    content: `${content} (${number})`,
    priority: i === 1 ? "high" : "medium",
    status: i < done ? "completed" : i === done ? "in_progress" : "pending",
  }));
}
