// Shared by diff.test.ts and diff.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { unifiedDiff, type DiffOp } from "../../src/conversation/diff.ts";

export const text = (...lines: string[]) => lines.map((l) => `${l}\n`).join("");
export const printed = (path: string, oldText: string | null, newText: string) => unifiedDiff(path, oldText, newText).map((l) => l.text);

export function apply(ops: readonly DiffOp[]): { before: string[]; after: string[] } {
  const before: string[] = [];
  const after: string[] = [];
  for (const op of ops) {
    if (op.kind !== "add") before.push(op.line);
    if (op.kind !== "remove") after.push(op.line);
  }
  return { before, after };
}

export function lcs(a: string[], b: string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(row[j]!, row[j - 1]!);
      diagonal = above;
    }
  }
  return row[b.length]!;
}
