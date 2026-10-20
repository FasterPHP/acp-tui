// The built-in `.gitignore` matcher behind the `@` file picker's directory walk
// (mvp-chrome-and-keys design D9), for a session directory outside a git work
// tree; inside one the picker asks `git ls-files` instead (src/overlay/files.ts).
// Pure, so it is unit-tested without a file system.
//
// What it follows of gitignore(5): blank lines and `#` comments are skipped; a
// backslash escapes the next character (`\#`, `\!`, `\ `); trailing spaces are
// dropped unless escaped; `!` re-includes; a trailing `/` matches directories
// only; a pattern with a `/` elsewhere is anchored to the directory of its
// `.gitignore`, one without matches a name at any depth below it; `*` and `?`
// never match `/`; `[...]` classes (with `!` or `^` negation and ranges);
// `**/` at the start, `/**` at the end and `/**/` in the middle as Git reads
// them, other runs of asterisks as `*`. The last matching rule wins, and the
// rules of a deeper `.gitignore` come after those of the directories above it.
// A file inside an excluded directory cannot be re-included: the walk never
// enters an excluded directory. Not followed: `core.excludesFile` and
// `.git/info/exclude`, which exist only for a git work tree.

/** One rule of a `.gitignore`. */
export interface IgnoreRule {
  /** The directory of its `.gitignore`, relative to the walk's root: `""` or `a/b/`. */
  readonly base: string;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly regex: RegExp;
}

/** The rules of one `.gitignore`'s text; `base` is its directory relative to the walk's root
 *  (`""` for the root, else ending with `/`). */
export function parseGitignore(text: string, base = ""): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = trimTrailingSpaces(raw);
    if (line === "" || line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    let directoryOnly = false;
    if (line.endsWith("/") && !line.endsWith("\\/")) {
      directoryOnly = true;
      line = line.replace(/\/+$/, "");
    }
    if (line === "") continue;
    // A slash at the start or in the middle anchors the pattern to `base`.
    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    const body = globToRegex(line);
    if (body === null) continue;
    rules.push({ base, negated, directoryOnly, regex: new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}$`) });
  }
  return rules;
}

/** A line without its trailing spaces, except those escaped with a backslash. */
function trimTrailingSpaces(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === " " && !(end > 1 && line[end - 2] === "\\" && !escapedBackslash(line, end - 2))) end--;
  return line.slice(0, end);
}

/** Whether the backslash at `at` is itself escaped by the one before it. */
function escapedBackslash(line: string, at: number): boolean {
  let count = 0;
  for (let i = at - 1; i >= 0 && line[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/g;
const literal = (ch: string) => ch.replace(REGEX_SPECIAL, "\\$&");

/** A glob (anchoring already removed) as a regular expression body; null when it cannot match
 *  anything (an unterminated escape at the end, which Git treats as matching nothing). */
export function globToRegex(glob: string): string | null {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === "*") {
      let j = i;
      while (glob[j] === "*") j++;
      const run = j - i;
      const atStart = i === 0 || glob[i - 1] === "/";
      const atEnd = j === glob.length || glob[j] === "/";
      if (run >= 2 && atStart && atEnd) {
        if (j === glob.length) {
          // `**` alone: everything; `.../**`: everything inside, not the directory itself.
          out += i === 0 ? ".*" : ".+";
          i = j;
        } else {
          // `**/` at the start or `/**/` in the middle: zero or more directories.
          out += "(?:.*/)?";
          i = j + 1;
        }
        continue;
      }
      out += "[^/]*";
      i = j;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i++;
      continue;
    }
    if (ch === "\\") {
      if (i + 1 >= glob.length) return null;
      out += literal(glob[i + 1]!);
      i += 2;
      continue;
    }
    if (ch === "[") {
      const cls = charClass(glob, i);
      if (cls) {
        out += cls.regex;
        i = cls.end;
        continue;
      }
      out += "\\[";
      i++;
      continue;
    }
    out += literal(ch);
    i++;
  }
  return out;
}

/** A bracket expression starting at `start` (`[`), or null when it is not closed. */
function charClass(glob: string, start: number): { regex: string; end: number } | null {
  let i = start + 1;
  let negate = false;
  if (glob[i] === "!" || glob[i] === "^") {
    negate = true;
    i++;
  }
  let body = "";
  let first = true;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === "]" && !first) return { regex: `(?!/)[${negate ? "^" : ""}${body}]`, end: i + 1 };
    first = false;
    if (ch === "\\" && i + 1 < glob.length) {
      body += `\\${glob[i + 1]!}`;
      i += 2;
      continue;
    }
    if (ch === "-" && body !== "" && glob[i + 1] !== "]" && i + 1 < glob.length) {
      body += "-";
      i++;
      continue;
    }
    body += ch === "\\" || ch === "]" || ch === "[" || ch === "^" || ch === "-" ? `\\${ch}` : ch;
    i++;
  }
  return null;
}

/**
 * Whether `path` (relative to the walk's root, `/`-separated, no trailing slash) is excluded by
 * `rules`, given in order (outer `.gitignore` files first): the last rule that matches decides.
 * A rule applies only below its own directory and matches the path relative to it.
 */
export function isIgnored(rules: readonly IgnoreRule[], path: string, isDirectory: boolean): boolean {
  for (let r = rules.length - 1; r >= 0; r--) {
    const rule = rules[r]!;
    if (rule.directoryOnly && !isDirectory) continue;
    if (rule.base !== "" && !path.startsWith(rule.base)) continue;
    if (rule.regex.test(path.slice(rule.base.length))) return !rule.negated;
  }
  return false;
}
