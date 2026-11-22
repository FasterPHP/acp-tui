import type { ToolCallItem } from "acp-model";

/** The title a tool call is drawn, projected, found and exported under (spec `tui-rendering`
 *  "Tool titles from raw input"): when the harness's title is one bare word (`bash`, `read`) and
 *  the call recorded an input text (its command or path), that text; otherwise the title. On one
 *  line, white space collapsed; empty when there is neither. */
export function toolTitleText(item: Pick<ToolCallItem, "title"> & { readonly inputText?: string | null }): string {
  const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
  const title = oneLine(item.title);
  if (title !== "" && !/\s/.test(title)) {
    const input = oneLine(item.inputText ?? "");
    if (input !== "") return input;
  }
  return title;
}
