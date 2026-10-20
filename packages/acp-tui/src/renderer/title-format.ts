// The terminal title's format (day-one-feedback design D8; spec tui-config "Terminal title setting"):
// a template over four placeholders. Pure and free of Solid and OpenTUI, since the configuration
// schema validates the setting with it (config/schema.ts).
import { parseTemplate, templateFields } from "../layout/template.ts";

/** What `title.format` may name. */
export const TITLE_PLACEHOLDERS = ["dir", "counter", "agent", "title"] as const;
export type TitlePlaceholder = (typeof TITLE_PLACEHOLDERS)[number];

/** The default: the session directory's name, with the instance number after it from the second
 *  instance on (` 2`). */
export const DEFAULT_TITLE_FORMAT = "{dir}{counter}";

/** The placeholders as the configuration's messages list them. */
export function titlePlaceholderList(): string {
  return TITLE_PLACEHOLDERS.map((p) => `{${p}}`).join(", ");
}

/** What is wrong with `format` as a title format (an unparsable template, a placeholder that is not
 *  one of the four), or null. */
export function titleFormatIssue(format: string): string | null {
  let parts;
  try {
    parts = parseTemplate(format);
  } catch (error) {
    return `is not a valid format: ${(error as Error).message}`;
  }
  const unknown = [...new Set(parts.flatMap((p) => (p.kind === "field" && !(TITLE_PLACEHOLDERS as readonly string[]).includes(p.name) ? [p.name] : [])))];
  if (unknown.length === 0) return null;
  return `names ${unknown.map((f) => `{${f}}`).join(", ")}, which the title does not have; the placeholders are ${titlePlaceholderList()}`;
}

/** Whether `format` shows the instance counter, so that the instance needs a slot. */
export function titleFormatUsesCounter(format: string): boolean {
  try {
    return templateFields(format).includes("counter");
  } catch {
    return false;
  }
}

/** The values of the placeholders: `counter` is empty or a space and the instance number, the
 *  others one printable line, empty when there is nothing to show. */
export type TitleValues = Readonly<Record<TitlePlaceholder, string>>;

/**
 * `format` filled in: literal text directly before an empty placeholder is dropped with it (so
 * `{dir}{counter} · {title}` is just the directory while the agent has sent no title), runs of
 * white space become one space and the ends are trimmed. A placeholder `format` names that is not
 * one of the four is empty. A format that cannot be parsed gives an empty string.
 */
export function expandTitleFormat(format: string, values: TitleValues): string {
  let parts;
  try {
    parts = parseTemplate(format);
  } catch {
    return "";
  }
  const out: { readonly text: string; readonly literal: boolean }[] = [];
  for (const part of parts) {
    if (part.kind === "text") {
      out.push({ text: part.text, literal: true });
      continue;
    }
    const value = (values as Readonly<Record<string, string>>)[part.name] ?? "";
    if (value === "") {
      if (out.at(-1)?.literal) out.pop();
      continue;
    }
    out.push({ text: value, literal: false });
  }
  return out.map((p) => p.text).join("").replace(/\s+/g, " ").trim();
}
