// Places key problems found over the effective configuration (overrides.ts,
// kept.ts) in the file that set the entry, with its line and column, so they
// read like the loader's (spec tui-config "Validation errors name the place and
// the fix"). The project file wins over the user's file for the settings it may
// set, so it is searched first; an entry found in neither (it came from a
// default) is placed at the start of the user's file.
import { readFileSync } from "node:fs";
import { findNodeAtLocation, parseTree, type Node } from "jsonc-parser";
import type { ConfigProblem } from "../config/problems.ts";

/** Where to look, highest precedence last (the user's file, then the project file). */
export interface ProblemFiles {
  readonly user: string;
  readonly project: string | null;
}

/** Reads a file's text; null when it cannot be read (tests pass texts). */
export type ReadText = (file: string) => string | null;

const readText: ReadText = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/** 1-based line and column of `offset` in `text`. */
function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      start = i + 1;
    }
  }
  return { line, column: offset - start + 1 };
}

/** The key node of the property at `path` (its value's node for an array index). */
function keyNode(root: Node, path: readonly string[]): Node | undefined {
  const value = findNodeAtLocation(root, [...path]);
  if (!value) return undefined;
  return value.parent?.type === "property" ? value.parent.children?.[0] : value;
}

export interface LocatedInput {
  readonly path: readonly string[];
  readonly severity: ConfigProblem["severity"];
  readonly message: string;
  readonly suggestion?: string;
}

/** The problems with their file, line and column. */
export function locateProblems(problems: readonly LocatedInput[], files: ProblemFiles, read: ReadText = readText): ConfigProblem[] {
  const trees = new Map<string, { text: string; root: Node | undefined } | null>();
  const tree = (file: string) => {
    if (!trees.has(file)) {
      const text = read(file);
      trees.set(file, text === null ? null : { text, root: parseTree(text, [], { allowTrailingComma: true }) });
    }
    return trees.get(file)!;
  };
  const candidates = [files.project, files.user].filter((f): f is string => f !== null);
  return problems.map((problem) => {
    for (const file of candidates) {
      const t = tree(file);
      const node = t?.root ? keyNode(t.root, problem.path) : undefined;
      if (t && node) {
        const at = position(t.text, node.offset);
        return { file, ...at, path: problem.path.join("."), severity: problem.severity, message: problem.message, ...(problem.suggestion ? { suggestion: problem.suggestion } : {}) };
      }
    }
    return { file: files.user, line: 1, column: 1, path: problem.path.join("."), severity: problem.severity, message: problem.message, ...(problem.suggestion ? { suggestion: problem.suggestion } : {}) };
  });
}
