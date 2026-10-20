// Command results (day-one-feedback design D2, spec tui-rendering "Command results recognised"):
// a pure recogniser for the text in which agents report a shell command's result. Pure: no
// OpenTUI, no Solid, no theme. Agent text is already sanitised by acp-model and passes through
// unchanged.
//
// A text is a command result when, after unwrapping a text that is exactly one fence without an
// info string, it is exactly one of two envelopes:
//
// 1. Auggie's `launch-process` result (0.36.0): `Here are the results from executing the
//    command.`, the return code between `<return-code>` lines and the output between `<output>`
//    lines; for any call. Auggie wraps a failure in a bare fence (`content`) and a success is only
//    in `rawOutput.output`, so the fence is optional.
// 2. `claude-agent-acp`'s failure: a first line `Exit code <n>`, then the output; only for a failed
//    `execute` call and only inside a bare fence (a bare `Exit code` line elsewhere is ordinary
//    text).
//
// Anything else is not a result and is drawn as before. The table is exact on purpose: an agent
// that quotes the tags in prose must not be rewritten. Recheck both envelopes at each Auggie
// upgrade (design 5.6). Auggie's `read-process`, `kill-process` and "still running" envelopes are
// not recognised (design Non-Goals).
import type { ToolCallStatus, ToolKind } from "@agentclientprotocol/sdk";
import type { ToolCallItem, ToolCallItemContent } from "acp-model";
import { singleFence } from "./markdown/project.ts";

/** A recognised command result: the output (without leading blank lines and trailing whitespace)
 *  and the return code. */
export interface CommandResult {
  readonly output: string;
  readonly code: number;
}

/** Auggie's `launch-process` envelope. The output is whatever lies between the first
 *  `<output>\n` and the last `\n</output>`, so output holding the tag stays whole. */
const AUGGIE_ENVELOPE =
  /^Here are the results from executing the command\.\n<return-code>\n(-?\d+)\n<\/return-code>\n<output>\n([\s\S]*)\n<\/output>\n?$/;

/** `claude-agent-acp`'s failure: Claude Code's `Exit code <n>`, then the output (possibly none). */
const EXIT_CODE_FIRST_LINE = /^Exit code (\d+)(?:\n([\s\S]*))?$/;

/** The output without leading blank lines (the first line's indentation is kept) and without
 *  trailing whitespace. */
function tidyOutput(output: string): string {
  return output.replace(/^(?:[ \t]*\n)+/, "").trimEnd();
}

/**
 * `text` as a command result, or null. `kind` and `status` are the call's: the Auggie envelope
 * matches for any call, the `Exit code` form only for a failed `execute` call inside a fence.
 */
export function commandResult(text: string, kind: ToolKind | null | undefined, status: ToolCallStatus | null | undefined): CommandResult | null {
  const normal = text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
  const fence = singleFence(normal);
  const fenced = fence !== null && fence.lang === "";
  // A fence with an info string is code, not an envelope.
  if (fence !== null && !fenced) return null;
  const body = fenced ? fence.code : normal;

  const auggie = AUGGIE_ENVELOPE.exec(body);
  if (auggie) return { output: tidyOutput(auggie[2]!), code: Number.parseInt(auggie[1]!, 10) };

  if (fenced && kind === "execute" && status === "failed") {
    const claude = EXIT_CODE_FIRST_LINE.exec(body);
    if (claude) return { output: tidyOutput(claude[2] ?? ""), code: Number.parseInt(claude[1]!, 10) };
  }
  return null;
}

/** The lines of a result's output as drawn and projected: each with its trailing whitespace
 *  dropped (nothing to select there) and tabs expanded to stops every 8 columns. */
export function resultOutputLines(output: string): string[] {
  if (output === "") return [];
  return output.split("\n").map((line) => expandTabs(line).trimEnd());
}

const TAB_WIDTH = 8;

/** Tabs to spaces at stops every `TAB_WIDTH` columns (ASCII columns; a wide character counts as
 *  it is, which is close enough for output that holds tabs). */
function expandTabs(line: string): string {
  if (!line.includes("\t")) return line;
  let out = "";
  let col = 0;
  for (const ch of line) {
    if (ch === "\t") {
      const pad = TAB_WIDTH - (col % TAB_WIDTH);
      out += " ".repeat(pad);
      col += pad;
    } else {
      out += ch;
      col += 1;
    }
  }
  return out;
}

/** The label of the output rows and of the return code row. */
export const OUTPUT_LABEL = "Output:";
export const RETURN_CODE_LABEL = "Return code:";
/** The indent of the output lines when there are several (cells). */
export const OUTPUT_INDENT = 2;

/**
 * The result as the projection holds it, line by line (labels included, as drawn): `Output:
 * <line>` for one output line, else `Output:` and each line indented two cells (blank lines stay
 * empty), none when the output is empty; then `Return code: <code>`. The drawn rows
 * (card.ts `resultParts`) read in order give exactly these lines.
 */
export function resultProjectionLines(result: CommandResult): { output: string[]; code: string } {
  const lines = resultOutputLines(result.output);
  const output =
    lines.length === 0
      ? []
      : lines.length === 1
        ? [`${OUTPUT_LABEL} ${lines[0]}`]
        : [OUTPUT_LABEL, ...lines.map((line) => (line === "" ? "" : " ".repeat(OUTPUT_INDENT) + line))];
  return { output, code: `${RETURN_CODE_LABEL} ${result.code}` };
}

const fallbacks = new WeakMap<ToolCallItem, readonly ToolCallItemContent[]>();

/**
 * The content a tool call shows (spec tui-rendering "Raw output shown when a call has no
 * content"): its content blocks, or, when it has none and a raw output text is recorded
 * (acp-model `rawOutputText`), that text as the one text block. A call with content never shows
 * its raw output. The card, its height, the projection, the summary and the export all read this,
 * so they agree on what the call holds. Content block indices (`content` in card parts and
 * projection blocks) are indices into this list.
 */
export function toolContent(item: ToolCallItem): readonly ToolCallItemContent[] {
  if (item.content.length > 0) return item.content;
  const raw = item.rawOutputText;
  if (raw === null || raw.trim() === "") return item.content;
  let blocks = fallbacks.get(item);
  if (!blocks) fallbacks.set(item, (blocks = [{ type: "text", text: raw }]));
  return blocks;
}
