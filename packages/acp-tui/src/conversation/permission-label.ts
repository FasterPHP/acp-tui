// How a permission option is named, on the card and in the record (spec tui-layout "Options that
// share a kind"): by its kind, unless two options of the request share one (Auggie 1.x offers
// `Yes` and `No`, both `allow_once`), when every option is named by its own sanitised name.
import { sanitise, type PermissionRecordItem } from "acp-model";
import { expandTabs } from "./content.ts";

const KIND_LABELS: Readonly<Record<string, string>> = {
  allow_once: "allow once",
  allow_always: "allow always",
  reject_once: "reject once",
  reject_always: "reject always",
};

interface NamedOption {
  readonly optionId: string;
  readonly name: string;
  readonly kind: string;
}

/** One line of approval-sanitised text (no bidi controls or zero-width characters). */
export function approvalLine(text: string): string {
  return sanitise(text, "approval").replace(/[\r\n\t]+/g, " ").trim();
}

/**
 * The request's question as approval-sanitised lines: no bidi controls, zero-width or control
 * characters, its line breaks kept, tabs expanded, trailing white space dropped from each line,
 * every run of blank lines collapsed to one and none at either end; indentation kept. Joined
 * with `\n`; empty when nothing is left.
 */
export function approvalQuestion(text: string): string {
  const lines: string[] = [];
  for (const raw of sanitise(text, "approval").split("\n")) {
    const line = expandTabs(raw).trimEnd();
    if (line === "" && (lines.length === 0 || lines[lines.length - 1] === "")) continue;
    lines.push(line);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** The question's lines when it has more than one (what the expanded record shows), else none. */
export function questionLines(title: string): string[] {
  const question = approvalQuestion(title);
  return question.includes("\n") ? question.split("\n") : [];
}

/** The kind's label (`allow once`), else the sanitised name of an option of a kind we do not know. */
export function kindLabel(kind: string, name: string): string {
  return KIND_LABELS[kind] ?? approvalLine(name);
}

/** True when two of the options share a kind. */
export function sharesKind(options: readonly { readonly kind: string }[]): boolean {
  return new Set(options.map((o) => o.kind)).size < options.length;
}

/** The label of each option, in order. */
export function optionLabels(options: readonly NamedOption[]): string[] {
  const shared = sharesKind(options);
  return options.map((o) => (shared && approvalLine(o.name) !== "" ? approvalLine(o.name) : kindLabel(o.kind, o.name)));
}

/** The label of the option an answered record chose, or null when it is not answered or the
 *  option is not among the record's. */
export function answeredLabel(item: PermissionRecordItem): string | null {
  const outcome = item.outcome;
  if (outcome.type !== "answered") return null;
  const index = item.options.findIndex((o) => o.optionId === outcome.optionId);
  if (index < 0) return null;
  return optionLabels(item.options)[index] ?? null;
}
