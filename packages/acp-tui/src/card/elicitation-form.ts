// The elicitation card's form model (design 6.4 "Elicitation card"; decision
// 13, research/full-screen-synthesis.md 2.10; parity 7.1: JetBrains' one
// question at a time), promoted from S6 (Phase 1a) by mvp-chrome-and-keys task
// 5.6. Pure: the questions of an
// ACP `requestedSchema`, answers and their validation, the `accept` content,
// and the card's rows. Every agent string (titles, descriptions, choice
// labels, the message, the URL) is sanitised in approval mode, since the user
// answers on the strength of it.
import type { CreateElicitationRequest, ElicitationContentValue, ElicitationSchema } from "@agentclientprotocol/sdk";
import { sanitise } from "acp-model";
import { cardInner, NO_FRAME_PADDING, wrapText, type CardSegment, type FramePadding } from "../app/permission.ts";
import { LIVE_PERMISSION_GLYPHS } from "../conversation/live-glyphs.ts";
import { displayWidth, fitSegments, truncateEnd, type Segment } from "../layout/segments.ts";
import type { TokenName } from "../theme/index.ts";

export type QuestionKind = "single" | "multi" | "text" | "number" | "boolean";

export interface Choice {
  readonly value: string;
  readonly label: string;
}

export interface Question {
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly required: boolean;
  readonly kind: QuestionKind;
  /** Choices for `single`, `multi` and `boolean` (Yes, No). */
  readonly choices: readonly Choice[];
  readonly integer: boolean;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly minLength: number | null;
  readonly maxLength: number | null;
  readonly pattern: string | null;
  readonly minItems: number | null;
  readonly maxItems: number | null;
  readonly defaultValue: ElicitationContentValue | undefined;
}

/** One line of approval-sanitised text (no escape sequences, bidi controls or zero-width characters). */
export function clean(text: unknown): string {
  return typeof text === "string" ? sanitise(text, "approval").replace(/[\r\n\t]+/g, " ").trim() : "";
}

type Schema = Record<string, unknown>;

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function choicesOf(source: Schema | undefined): Choice[] {
  if (!source) return [];
  if (Array.isArray(source["oneOf"])) return (source["oneOf"] as Schema[]).map((o) => ({ value: String(o["const"] ?? ""), label: clean(o["title"] ?? o["const"]) }));
  if (Array.isArray(source["anyOf"])) return (source["anyOf"] as Schema[]).map((o) => ({ value: String(o["const"] ?? ""), label: clean(o["title"] ?? o["const"]) }));
  if (Array.isArray(source["enum"])) return (source["enum"] as unknown[]).map((v) => ({ value: String(v), label: clean(String(v)) }));
  return [];
}

/** The form's questions, in the schema's property order. Unknown property types are asked as text. */
export function formQuestions(schema: ElicitationSchema): Question[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([key, raw]) => {
    const p = raw as Schema;
    const type = p["type"];
    const choices = type === "array" ? choicesOf(p["items"] as Schema) : type === "boolean" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : choicesOf(p);
    const kind: QuestionKind =
      type === "array" ? "multi" : type === "boolean" ? "boolean" : type === "number" || type === "integer" ? "number" : choices.length > 0 ? "single" : "text";
    return {
      key,
      title: clean(p["title"]) || clean(key),
      description: clean(p["description"]) || null,
      required: required.has(key),
      kind,
      choices,
      integer: type === "integer",
      minimum: num(p["minimum"]),
      maximum: num(p["maximum"]),
      minLength: num(p["minLength"]),
      maxLength: num(p["maxLength"]),
      pattern: typeof p["pattern"] === "string" ? (p["pattern"] as string) : null,
      minItems: num(p["minItems"]),
      maxItems: num(p["maxItems"]),
      defaultValue: p["default"] as ElicitationContentValue | undefined,
    };
  });
}

export type Answers = Readonly<Record<string, ElicitationContentValue | undefined>>;

/** The answers the form starts with: each question's `default`, if any. */
export function initialAnswers(questions: readonly Question[]): Record<string, ElicitationContentValue | undefined> {
  return Object.fromEntries(questions.map((q) => [q.key, q.defaultValue]));
}

/** Checks an answer against the question's constraints; the problem, or null. */
export function validateAnswer(question: Question, value: ElicitationContentValue | undefined): string | null {
  if (value === undefined || value === "") return question.required ? "an answer is required" : null;
  if (question.kind === "multi" && Array.isArray(value)) {
    if (question.minItems !== null && value.length < question.minItems) return `choose at least ${question.minItems}`;
    if (question.maxItems !== null && value.length > question.maxItems) return `choose at most ${question.maxItems}`;
    if (question.required && value.length === 0) return "choose at least one";
    return null;
  }
  if (question.kind === "number" && typeof value === "number") {
    if (question.minimum !== null && value < question.minimum) return `at least ${question.minimum}`;
    if (question.maximum !== null && value > question.maximum) return `at most ${question.maximum}`;
    return null;
  }
  if (typeof value === "string" && question.kind === "text") {
    if (question.minLength !== null && value.length < question.minLength) return `at least ${question.minLength} characters`;
    if (question.maxLength !== null && value.length > question.maxLength) return `at most ${question.maxLength} characters`;
    if (question.pattern !== null) {
      try {
        if (!new RegExp(question.pattern, "u").test(value)) return "does not match the expected format";
      } catch {
        // An invalid pattern from the agent is not the user's problem.
      }
    }
  }
  return null;
}

/** A text or number question's draft as an answer. */
export function draftAnswer(question: Question, draft: string): { value: ElicitationContentValue | undefined; error: string | null } {
  const text = draft.trim();
  if (question.kind === "number") {
    if (text === "") return { value: undefined, error: validateAnswer(question, undefined) };
    const value = Number(text);
    if (!Number.isFinite(value) || (question.integer && !Number.isInteger(value))) return { value: undefined, error: question.integer ? "a whole number is needed" : "a number is needed" };
    return { value, error: validateAnswer(question, value) };
  }
  const value = draft === "" ? undefined : draft;
  return { value, error: validateAnswer(question, value) };
}

/** The `accept` content: every answered question (skipped ones are left out). */
export function formContent(questions: readonly Question[], answers: Answers): Record<string, ElicitationContentValue> {
  const out: Record<string, ElicitationContentValue> = {};
  for (const q of questions) {
    const value = answers[q.key];
    if (value !== undefined) out[q.key] = value;
  }
  return out;
}

/** An answer as the review shows it. */
export function answerLabel(question: Question, value: ElicitationContentValue | undefined): string {
  if (value === undefined) return "(skipped)";
  const label = (v: string) => question.choices.find((c) => c.value === v)?.label ?? clean(v);
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.map(label).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (question.kind === "single") return label(String(value));
  return clean(String(value));
}

// -- Rows ---------------------------------------------------------------------------------------

/** What the card shows: a question, the review, or a URL request (open or waiting). */
export type CardPage =
  | {
      readonly kind: "question";
      readonly index: number;
      readonly count: number;
      readonly formTitle: string;
      readonly message: string;
      readonly question: Question;
      /** The choice under the cursor (single, multi, boolean). */
      readonly cursor: number;
      /** Ticked choices (multi) or the chosen one (single, boolean). */
      readonly chosen: readonly string[];
      /** The typed text (text, number). */
      readonly draft: string;
      readonly error: string | null;
    }
  | { readonly kind: "review"; readonly formTitle: string; readonly questions: readonly Question[]; readonly answers: Answers; readonly error: string | null }
  | { readonly kind: "url"; readonly message: string; readonly url: string; readonly cursor: number; readonly waiting: boolean };

export interface ElicitationRowStyle {
  readonly focused: boolean;
  /** The most rows the card may take, its borders included and its padding rows not. */
  readonly maxRows: number;
  /** The padding inside the frame, as the permission card's (`NO_FRAME_PADDING` when absent). */
  readonly padding?: FramePadding;
  /** Key hints for the bottom border (from the key map in use). */
  readonly hints: readonly Segment[];
}

/** A URL request's actions (design D7): open the link in the system opener (and accept), copy it,
 *  accept without opening, decline. */
export const URL_OPTIONS = ["open", "copy", "accept", "decline"] as const;
/** Once accepted, the card waits for `elicitation/complete` and still offers these. */
export const URL_WAITING_OPTIONS = ["open", "copy"] as const;

/** The text the URL request's waiting state shows. */
export const URL_WAITING = "Waiting for the agent to finish. The link can still be opened or copied from here.";

/** The header word that tells an agent's question from a permission request (design D7). */
export const QUESTION_WORD = "Question";

/**
 * The card's rows for `width` columns, in the permission card's frame, fill and marker (it sits in
 * the same docked position and needs the same anti-spoofing marks): the top border names the page
 * (`Question 1 of 3`, `Review`, `Open a link`), the body the page's content, the bottom border the
 * key hints. At most `style.maxRows` rows: the message and description give way first.
 */
export function elicitationRows(page: CardPage, width: number, style: ElicitationRowStyle): CardSegment[][] {
  const g = LIVE_PERMISSION_GLYPHS;
  const frameToken: TokenName = "permission";
  const padding = style.padding ?? NO_FRAME_PADDING;
  const inner = cardInner(width, padding.columns);
  // Every page's header starts with the word `Question`, never `Permission` (design D7).
  const heading = page.kind === "question" ? `${QUESTION_WORD} ${page.index + 1} of ${page.count}` : QUESTION_WORD;
  const subtitle = page.kind === "question" ? page.formTitle : page.kind === "review" ? "Review your answers" : "Open a link";

  // Top border: `╭─ ◊ Question 1 of 3  Set up the change ───╮`.
  const head: CardSegment[] = [
    { text: `${g.topLeft}${g.horizontal} `, token: frameToken },
    { text: `${g.marker} `, token: frameToken },
    { text: heading, token: "permission" },
  ];
  const headWidth = 3 + 2 + displayWidth(heading);
  const room = width - headWidth - 3;
  if (subtitle && room > 4) head.push({ text: `  ${truncateEnd(subtitle, room - 2)}`, token: "muted" });
  const used = head.reduce((n, s) => n + displayWidth(s.text), 0);
  const top: CardSegment[] = [...head, { text: ` ${g.horizontal.repeat(Math.max(0, width - used - 2))}`, token: frameToken }, { text: g.topRight, token: frameToken }];
  const topFitted = displayWidth(top.map((s) => s.text).join("")) > width ? [...head.slice(0, 3), { text: g.topRight, token: frameToken } as CardSegment] : top;

  const sel = (on: boolean) => (on && style.focused ? { selected: true } : {});
  const fixed: CardSegment[][] = [];
  const flexible: { rows: CardSegment[][]; min: number }[] = [];
  const text = (t: string, token: TokenName): CardSegment[] => [{ text: t, token }];

  if (page.kind === "question") {
    const q = page.question;
    flexible.push({ rows: wrapText(page.message, inner).slice(0, 2).map((t) => text(t, "muted")), min: 0 });
    fixed.push([{ text: truncateEnd(q.title, inner - (q.required ? 11 : 0)), token: "accent" }, ...(q.required ? [{ text: " (required)", token: "muted" as TokenName }] : [])]);
    if (q.description) flexible.push({ rows: wrapText(q.description, inner).slice(0, 2).map((t) => text(t, "muted")), min: 0 });
    if (q.kind === "text" || q.kind === "number") {
      const room = Math.max(1, inner - 3);
      // The end of a long draft, where the caret is.
      let shown = page.draft;
      while (displayWidth(shown) > room) shown = [...shown].slice(1).join("");
      fixed.push([
        { text: "› ", token: "accent" },
        { text: shown, token: "text" },
        { text: " ", token: "text", selected: style.focused },
        ...(page.draft === "" ? [{ text: truncateEnd(q.kind === "number" ? "type a number" : "type your answer", inner - 3), token: "muted" as TokenName }] : []),
      ]);
    } else {
      q.choices.forEach((choice, i) => {
        const chosen = page.chosen.includes(choice.value);
        const box = q.kind === "multi" ? (chosen ? "[x] " : "[ ] ") : chosen ? "● " : "○ ";
        const number = i < 9 ? `${i + 1} ` : "  ";
        const on = i === page.cursor;
        fixed.push([
          { text: number, token: style.focused ? "accent" : "muted", ...sel(on) },
          { text: box, token: "accent", ...sel(on) },
          { text: truncateEnd(choice.label, Math.max(1, inner - number.length - box.length)), token: "text", ...sel(on) },
        ]);
      });
    }
    if (page.error) fixed.push(text(truncateEnd(page.error, inner), "warning"));
  } else if (page.kind === "review") {
    page.questions.forEach((q, i) => {
      const value = page.answers[q.key];
      const label = `${q.title}: `;
      fixed.push([
        { text: i < 9 ? `${i + 1} ` : "  ", token: "accent" },
        { text: truncateEnd(label, Math.max(1, Math.floor(inner / 2))), token: "text" },
        { text: truncateEnd(answerLabel(q, value), Math.max(1, inner - 2 - Math.min(displayWidth(label), Math.floor(inner / 2)))), token: value === undefined ? "muted" : "accent" },
      ]);
    });
    if (page.error) fixed.push(text(truncateEnd(page.error, inner), "warning"));
  } else {
    flexible.push({ rows: wrapText(page.message, inner).slice(0, 3).map((t) => text(t, "text")), min: 1 });
    // The whole URL, wrapped and never cut: the user approves what they can read.
    for (const row of wrapText(page.url, inner)) fixed.push(text(row, "accent"));
    if (page.waiting) flexible.push({ rows: wrapText(URL_WAITING, inner).map((t) => text(t, "muted")), min: 1 });
    const row: CardSegment[] = [];
    (page.waiting ? URL_WAITING_OPTIONS : URL_OPTIONS).forEach((label, i) => {
      if (i > 0) row.push({ text: "   ", token: "muted" });
      row.push({ text: `${i + 1}`, token: style.focused ? "accent" : "muted", ...sel(i === page.cursor) }, { text: ` ${label}`, token: style.focused ? "text" : "muted", ...sel(i === page.cursor) });
    });
    fixed.push(row);
  }

  // Fit: the flexible parts shrink (to their minimum) before the fixed rows are cut.
  const budget = Math.max(1, style.maxRows - 2);
  let flexRows = flexible.reduce((n, f) => n + f.rows.length, 0);
  for (const f of flexible) {
    while (fixed.length + flexRows > budget && f.rows.length > f.min) {
      f.rows.pop();
      flexRows--;
    }
  }
  const body: CardSegment[][] =
    page.kind === "question"
      ? [...(flexible[0]?.rows ?? []), fixed[0]!, ...(page.question.description ? (flexible[1]?.rows ?? []) : []), ...fixed.slice(1)]
      : page.kind === "url"
        ? [...(flexible[0]?.rows ?? []), ...fixed.slice(0, -1), ...(page.waiting ? (flexible[1]?.rows ?? []) : []), fixed.at(-1)!]
        : fixed;

  const framed = (content: CardSegment[]): CardSegment[] => {
    const w = content.reduce((n, s) => n + displayWidth(s.text), 0);
    // The padding columns plain, not in the frame's token (no bold on a blank cell).
    return [
      { text: g.vertical, token: frameToken },
      { text: " ".repeat(padding.columns), token: "text" },
      ...content,
      { text: " ".repeat(Math.max(0, inner - w)), token: "text" },
      { text: " ".repeat(padding.columns), token: "text" },
      { text: g.vertical, token: frameToken },
    ];
  };

  // Bottom border with the hints.
  const hints = fitSegments(style.hints, Math.max(0, width - 6)) as CardSegment[];
  const hintWidth = hints.reduce((n, s) => n + displayWidth(s.text), 0);
  const bottom: CardSegment[] =
    hintWidth > 0
      ? [
          { text: `${g.bottomLeft}${g.horizontal.repeat(Math.max(0, width - hintWidth - 5))} `, token: frameToken },
          ...hints,
          { text: ` ${g.horizontal}${g.bottomRight}`, token: frameToken },
        ]
      : [{ text: `${g.bottomLeft}${g.horizontal.repeat(Math.max(0, width - 2))}${g.bottomRight}`, token: frameToken }];

  // The padding rows inside the frame, besides `maxRows` (day-one-feedback).
  const blank = Array.from({ length: Math.max(0, padding.rows) }, () => framed([]));
  return [topFitted, ...blank, ...body.slice(0, budget).map(framed), ...blank.map((row) => [...row]), bottom];
}

/** The request's kind: a form, a URL, or a mode acp-tui does not know (declined). */
export function requestKind(request: CreateElicitationRequest): "form" | "url" | "unknown" {
  if (request.mode === "form" && "requestedSchema" in request) return "form";
  if (request.mode === "url" && "url" in request && typeof request.url === "string") return "url";
  return "unknown";
}
