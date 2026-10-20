// The `Configuration problems` list (mvp-configuration tasks 3.4 and 8.4; spec
// tui-config "Configuration problems are visible", scenario "Problems listed in
// the palette"): every problem, grouped by its file (`~` for home), each with
// its line, column and setting, and what is wrong in muted text after it; the
// severity in the value column; when the selected row cuts its message, the
// message alone is wrapped under the list (`problemDetail`; IDE check 12.5: a
// kept-key warning's routes). Shown in the palette's overlay
// (Overlay.tsx). Pure.
import { homedir } from "node:os";
import { sanitise } from "acp-model";
import type { ConfigProblem } from "../config/problems.ts";
import { actionLabel, type KeyMap } from "../keys/keymap.ts";
import { shortenHome } from "../layout/segments.ts";
import type { ListItem } from "./list.ts";

const clean = (text: string): string => sanitise(text, "approval").replace(/\s+/g, " ").trim();

/** The list's items, in the store's order (the loader's problems, then each channel's). */
export function problemItems(problems: readonly ConfigProblem[], home: string | null = homedir()): ListItem[] {
  return problems.map((problem, i) => {
    const hint = problem.suggestion === undefined ? "" : ` (did you mean ${problem.suggestion}?)`;
    return {
      id: `problem:${i}`,
      group: clean(shortenHome(problem.file, home)),
      title: clean(`${problem.line}:${problem.column}${problem.path === "" ? "" : ` ${problem.path}`}`),
      description: clean(`${problem.message}${hint}`),
      value: problem.severity,
    };
  });
}

/** The selected problem's message in full, for the area under the list when its row cuts it. The
 *  place and setting are not repeated: the selected row has them, so the message reads as its
 *  continuation. Null for a problem with no message. */
export function problemDetail(item: ListItem): string | null {
  return item.description ?? null;
}

/** The word typed in the palette's filter to reach `Configuration problems`. */
export const PROBLEMS_FILTER = "configuration";

/**
 * How to reach the list from the prompt box, for the load notice (IDE check 12.5): the key bound to
 * `configProblems` when there is one; else the palette's key and the word to type (`? configuration`,
 * `?` in the empty prompt box first, since Zed keeps Ctrl+P); else `acp-tui config --check`.
 */
export function problemsRoute(map: KeyMap): string {
  const direct = actionLabel(map, "global", "configProblems");
  if (direct) return direct;
  const palette = actionLabel(map, "prompt", "palette") ?? actionLabel(map, "global", "palette");
  return palette ? `${palette} ${PROBLEMS_FILTER}` : "acp-tui config --check";
}
