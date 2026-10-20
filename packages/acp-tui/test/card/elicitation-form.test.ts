// SPIKE (phase-1a): S6, the elicitation card's form model and rows
// (src/card/elicitation-form.ts) and the host's queue (src/card/elicitation.tsx).
import { describe, expect, test } from "bun:test";
import type { CreateElicitationRequest, ElicitationSchema } from "@agentclientprotocol/sdk";
import { createElicitationHost } from "../../src/card/elicitation.tsx";
import {
  answerLabel,
  draftAnswer,
  elicitationRows,
  formContent,
  formQuestions,
  initialAnswers,
  requestKind,
  validateAnswer,
} from "../../src/card/elicitation-form.ts";
import { displayWidth } from "../../src/layout/segments.ts";

const schema: ElicitationSchema = {
  type: "object",
  title: "Set up",
  properties: {
    strategy: { type: "string", title: "Strategy", oneOf: [{ const: "a", title: "In place" }, { const: "b", title: "Copy" }] },
    checks: { type: "array", title: "Checks", items: { anyOf: [{ const: "t", title: "Tests" }, { const: "l", title: "Lint" }] }, maxItems: 1 },
    notes: { type: "string", title: "No‮tes​", description: "Anything\x1b]0;x\x07 else?", minLength: 2 },
    count: { type: "integer", title: "Count", minimum: 1, default: 3 },
    ok: { type: "boolean", title: "OK?" },
  },
  required: ["strategy", "count"],
};
const text = (row: { text: string }[]) => row.map((s) => s.text).join("");

describe("form questions", () => {
  const questions = formQuestions(schema);

  test("one question per property, in order, with kinds, choices and sanitised text (approval mode)", () => {
    expect(questions.map((q) => [q.key, q.kind, q.required])).toEqual([
      ["strategy", "single", true],
      ["checks", "multi", false],
      ["notes", "text", false],
      ["count", "number", true],
      ["ok", "boolean", false],
    ]);
    expect(questions[0]!.choices).toEqual([{ value: "a", label: "In place" }, { value: "b", label: "Copy" }]);
    // Bidi and zero-width characters and escape sequences are gone.
    expect(questions[2]!.title).toBe("Notes");
    expect(questions[2]!.description).toBe("Anything else?");
    expect(initialAnswers(questions)).toEqual({ strategy: undefined, checks: undefined, notes: undefined, count: 3, ok: undefined });
  });

  test("validation and drafts", () => {
    const [strategy, checks, notes, count] = questions;
    expect(validateAnswer(strategy!, undefined)).toBe("an answer is required");
    expect(validateAnswer(checks!, ["t", "l"])).toBe("choose at most 1");
    expect(validateAnswer(notes!, undefined)).toBeNull();
    expect(draftAnswer(notes!, "x")).toEqual({ value: "x", error: "at least 2 characters" });
    expect(draftAnswer(count!, "2.5")).toEqual({ value: undefined, error: "a whole number is needed" });
    expect(draftAnswer(count!, "0")).toEqual({ value: 0, error: "at least 1" });
    expect(draftAnswer(count!, "4")).toEqual({ value: 4, error: null });
  });

  test("content leaves skipped questions out; the review labels answers", () => {
    const answers = { strategy: "b", checks: ["t"], notes: undefined, count: 4, ok: true };
    expect(formContent(questions, answers)).toEqual({ strategy: "b", checks: ["t"], count: 4, ok: true });
    expect(answerLabel(questions[0]!, "b")).toBe("Copy");
    expect(answerLabel(questions[1]!, ["t"])).toBe("Tests");
    expect(answerLabel(questions[2]!, undefined)).toBe("(skipped)");
    expect(answerLabel(questions[4]!, true)).toBe("Yes");
  });

  test("rows: `Question 1 of 5` in the permission frame and marker, every row the card's width", () => {
    const rows = elicitationRows(
      { kind: "question", index: 0, count: 5, formTitle: "Set up", message: "A few questions.", question: questions[0]!, cursor: 1, chosen: [], draft: "", error: null },
      63,
      { focused: true, maxRows: 13, hints: [{ text: "enter next", token: "muted" }] },
    );
    expect(rows.map(text)).toEqual([
      expect.stringMatching(/^╭─ ◊ Question 1 of 5 {2}Set up ─+╮$/),
      expect.stringMatching(/^│ A few questions\. +│$/),
      expect.stringMatching(/^│ Strategy \(required\) +│$/),
      expect.stringMatching(/^│ 1 ○ In place +│$/),
      expect.stringMatching(/^│ 2 ○ Copy +│$/),
      expect.stringMatching(/^╰─+ enter next ─╯$/),
    ]);
    for (const row of rows) expect(displayWidth(text(row))).toBe(63);
    // The cursor's choice is highlighted.
    expect(rows[4]!.some((s) => s.selected)).toBe(true);
    expect(rows[3]!.some((s) => s.selected)).toBe(false);
  });

  test("URL mode shows the whole sanitised URL, wrapped rather than cut", () => {
    const url = `https://example.invalid/${"a".repeat(80)}‮/x`;
    const rows = elicitationRows({ kind: "url", message: "Sign in.", url: url.replace("‮", ""), cursor: 0, waiting: false }, 63, {
      focused: true,
      maxRows: 13,
      hints: [],
    }).map(text);
    expect(rows[0]).toMatch(/^╭─ ◊ Question  Open a link ─+╮$/);
    const shown = rows.slice(2, -2).map((r) => r.slice(2, -2).trimEnd()).join("");
    expect(shown).toBe(`https://example.invalid/${"a".repeat(80)}/x`);
    expect(rows.at(-2)).toMatch(/^│ 1 open {3}2 copy {3}3 accept {3}4 decline +│$/);
  });
});

describe("elicitation host", () => {
  const form = { mode: "form", sessionId: "s", message: "m", requestedSchema: schema } as CreateElicitationRequest;
  const url = { mode: "url", sessionId: "s", message: "m", url: "https://x.invalid", elicitationId: "e1" } as CreateElicitationRequest;

  test("requests queue; an answer resolves the agent's request; an accepted URL waits for elicitation/complete", async () => {
    const host = createElicitationHost();
    const first = host.create(form);
    const second = host.create(url);
    expect(requestKind(form)).toBe("form");
    expect(host.current()?.request).toBe(form);
    host.answer(host.current()!, { action: "decline" });
    expect(await first).toEqual({ action: "decline" });
    expect(host.current()?.request).toBe(url);
    host.answer(host.current()!, { action: "accept" });
    expect(await second).toEqual({ action: "accept" });
    expect(host.current()?.stage).toBe("waiting");
    host.complete({ elicitationId: "e1" });
    expect(host.current()).toBeNull();
  });

  test("cancelAll answers every open request with cancel; an unknown mode is declined at once", async () => {
    const host = createElicitationHost();
    const pending = host.create(form);
    host.cancelAll();
    expect(await pending).toEqual({ action: "cancel" });
    expect(host.current()).toBeNull();
    expect(await host.create({ mode: "_custom", sessionId: "s", message: "m" } as CreateElicitationRequest)).toEqual({ action: "decline" });
  });
});
