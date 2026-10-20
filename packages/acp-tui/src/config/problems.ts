// Configuration problems (mvp-configuration design D3; spec tui-config
// "Validation errors name the place and the fix"): what is wrong, in which
// file, at which line and column, under which setting, and the closest known
// name when a name was misspelt. Plain data, so the store, `config --check`,
// notices and the palette entry all show the same thing.
import { basename } from "node:path";
import { sanitise } from "acp-model";

/** `notice`: only `config --check` reports it, and it is not counted among the warnings (a
 *  deprecated name that still works). */
export type ProblemSeverity = "error" | "warning" | "notice";

export interface ConfigProblem {
  /** The file the problem is in (absolute). */
  readonly file: string;
  /** 1-based line and column of the value (or key) at fault; 1:1 when the file as a whole is. */
  readonly line: number;
  readonly column: number;
  /** The setting's path, dotted (`agent_servers.fake.args`); empty for the file as a whole (a
   *  syntax error). */
  readonly path: string;
  /** Errors reject their section (or the file, for a syntax error); warnings are reported and the
   *  value is ignored or kept. */
  readonly severity: ProblemSeverity;
  /** What was found and what is allowed, without the place (`takes "full", "wheel" or "off", not
   *  "sometimes"`). */
  readonly message: string;
  /** The closest known name or value, when one is close. */
  readonly suggestion?: string;
}

/** `file:line:column: path message (did you mean x?)`, one line, printable. */
export function formatProblem(problem: ConfigProblem): string {
  return formatLine(problem, false);
}

/** `file:line:column: error: path message (did you mean x?)`, as `acp-tui config --check` prints
 *  it (the severity after the place, as compilers write it). */
export function formatProblemWithSeverity(problem: ConfigProblem): string {
  return formatLine(problem, true);
}

function formatLine(problem: ConfigProblem, severity: boolean): string {
  const place = `${problem.file}:${problem.line}:${problem.column}${severity ? `: ${problem.severity}` : ""}`;
  const what = problem.path === "" ? problem.message : `${problem.path} ${problem.message}`;
  const hint = problem.suggestion === undefined ? "" : ` (did you mean ${problem.suggestion}?)`;
  return sanitise(`${place}: ${what}${hint}`, "approval").replace(/\s+/g, " ");
}

/** One line for a notice: the first problem and how many there are (spec tui-config
 *  "Configuration problems are visible"), the file by its name only, since the notice has the
 *  width of the prompt box; null when there are none. */
export function problemSummary(problems: readonly ConfigProblem[]): string | null {
  const first = problems[0];
  if (first === undefined) return null;
  const more = problems.length > 1 ? ` (${problems.length} configuration problems)` : "";
  return `configuration: ${formatProblem({ ...first, file: basename(first.file) })}${more}`;
}

/** The load notice (spec tui-config "Configuration problems are visible"): `problemSummary`'s
 *  text; what the top border keeps at its end when the text is cut (`Notice.more`): how many
 *  problems there are and where to read them in full, `route` (IDE check 12.5: a kept-key warning's
 *  routes come after the part the border shows); and the first problem alone, cut before it
 *  (`Notice.short`), since `more` says it is the configuration's. Null when there are none. */
export function problemNotice(problems: readonly ConfigProblem[], route: string): { text: string; more: string; short: string } | null {
  const first = problems[0];
  const text = problemSummary(problems);
  if (first === undefined || text === null) return null;
  const more = problems.length > 1 ? `(${problems.length} problems, see ${route})` : `(see ${route})`;
  return { text, more, short: formatProblem({ ...first, file: basename(first.file) }) };
}

/** What the debug log records of the problems: places and setting names, never values. */
export function problemsForLog(problems: readonly ConfigProblem[]): { file: string; line: number; column: number; path: string; severity: ProblemSeverity }[] {
  return problems.map(({ file, line, column, path, severity }) => ({ file, line, column, path, severity }));
}

export function hasErrors(problems: readonly ConfigProblem[]): boolean {
  return problems.some((p) => p.severity === "error");
}

/** Levenshtein distance, for suggestions. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]!;
      previous[j] = Math.min(above + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

/** The candidate closest to `name` when it is close enough to be a likely typo (at most a third of
 *  the name's length, and at least 2, edits away); undefined otherwise. */
export function suggest(name: string, candidates: Iterable<string>): string | undefined {
  const limit = Math.max(2, Math.floor(name.length / 3));
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    const distance = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= limit ? best : undefined;
}
