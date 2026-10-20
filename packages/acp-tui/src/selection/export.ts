// The conversation as Markdown, for `Y` (an item as Markdown) and the export to
// a file; design of record 6.3 ("Per-item keys copy an item as plain text or as
// its Markdown source (`y`, `Y`); `/export` writes the whole conversation as
// Markdown").
//
// The export format (`conversationMarkdown`), one blank line between blocks
// and one newline at the end of the file:
//
//   # <title>                          only when a title is given
//
//   ## User                            before every user message
//
//   <the user's text, verbatim>
//
//   ## Agent                           before the first agent-side item after
//                                      a user message (or at the start)
//
//   <agent message: its Markdown source, verbatim>
//
//   > **Thought**                      a thought: its text as a block quote
//   >
//   > <text>
//
//   **Tool** (<kind>, <status>): <title>
//
//   ```diff                            per content block: a diff as unified
//   --- <path>                         diff text in a `diff` fence, text
//   +++ <path>                         output in a bare fence, `terminal`
//   @@ -1,3 +1,3 @@                    content as an italic notice line
//   ...
//   ```
//
//   **Plan**
//
//   - [x] <completed entry>
//   - [ ] <in-progress entry> (in progress)
//   - [ ] <pending entry>
//
//   **Permission** (<outcome>): <title>
//
//   **Error:** <text>                  error and notice markers; turn ends
//   **Notice:** <text>                 are left out (status chrome)
//
// Fences are longer than any backtick run in their content, so output that
// holds a fence cannot close the block early. Agent Markdown is not
// rewritten: its own headings keep their level. `itemMarkdown` (`Y`) gives an
// item's block of this format, without a role heading.
import type { Item, ToolCallItem } from "acp-model";
import { toolContent } from "../conversation/command-result.ts";
import { unifiedDiff } from "../conversation/diff.ts";
import { outcomeLabel, TERMINAL_NOTICE, toolTitle, type ItemLookup } from "./projection.ts";

function trimTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, "");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A fence of backticks longer than any run of backticks in `body` (at least three). */
export function fenceFor(body: string): string {
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

function fenced(body: string, lang = ""): string {
  const fence = fenceFor(body);
  return `${fence}${lang}\n${body}${body === "" ? "" : "\n"}${fence}`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

function toolMarkdown(item: ToolCallItem): string {
  const kind = oneLine(item.toolKind ?? item.toolName ?? "tool");
  const status = item.toolStatus.replace(/_/g, " ");
  const blocks = [`**Tool** (${kind}, ${status}): ${toolTitle(item)}`];
  for (const content of toolContent(item)) {
    switch (content.type) {
      case "text":
        blocks.push(fenced(trimTrailingNewlines(content.text)));
        break;
      case "diff":
        blocks.push(fenced(unifiedDiff(content.path, content.oldText, content.newText).map((line) => line.text).join("\n"), "diff"));
        break;
      case "terminal_unavailable":
        blocks.push(`*${TERMINAL_NOTICE}*`);
        break;
    }
  }
  return blocks.join("\n\n");
}

/** An item as Markdown (`Y`): its block of the export format; empty for a turn end. */
export function itemMarkdown(item: Item): string {
  switch (item.kind) {
    case "user_message":
    case "agent_message":
      return trimTrailingNewlines(item.text);
    case "thought": {
      const text = trimTrailingNewlines(item.text);
      return text === "" ? "> **Thought**" : `> **Thought**\n>\n${quote(text)}`;
    }
    case "tool_call":
      return toolMarkdown(item);
    case "plan": {
      const entries = item.entries.map((entry) => {
        const box = entry.status === "completed" ? "[x]" : "[ ]";
        const note = entry.status === "in_progress" ? " (in progress)" : "";
        return `- ${box} ${oneLine(entry.content)}${note}`;
      });
      return ["**Plan**", ...(entries.length > 0 ? [entries.join("\n")] : [])].join("\n\n");
    }
    case "permission_record":
      return `**Permission** (${outcomeLabel(item)}): ${oneLine(item.title) || item.toolCallId}`;
    case "marker":
      if (item.markerKind === "turn_end") return "";
      return `**${item.markerKind === "error" ? "Error" : "Notice"}:** ${trimTrailingNewlines(item.text)}`;
  }
}

export interface ExportOptions {
  /** A `# title` line at the top (for example the session's agent and working directory). */
  readonly title?: string;
}

/** The whole conversation as Markdown (the export of task 15.3; format in the module header). */
export function conversationMarkdown(order: readonly string[], lookup: ItemLookup, options: ExportOptions = {}): string {
  const blocks: string[] = [];
  if (options.title) blocks.push(`# ${oneLine(options.title)}`);
  let role: "user" | "agent" | null = null;
  for (const id of order) {
    const item = lookup(id);
    if (!item) continue;
    const body = itemMarkdown(item);
    if (body === "") continue;
    const next = item.kind === "user_message" ? "user" : "agent";
    if (next === "user") blocks.push("## User");
    else if (role !== "agent") blocks.push("## Agent");
    role = next;
    blocks.push(body);
  }
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
}
