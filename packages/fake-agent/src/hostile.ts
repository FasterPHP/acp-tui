// Hostile-output fixtures shared by scenarios (design D12; acp-tui's
// sanitiser and chrome-imitation tests key off these exact strings).
//
// - An OSC 52 clipboard write, terminated with BEL, wrapped in text that must
//   survive sanitisation intact either side of the escape sequence.
// - A line that imitates acp-tui's own permission-prompt chrome, to prove the
//   renderer always prefixes agent text with its role gutter rather than
//   trusting column 0.
const OSC52_CLIPBOARD_WRITE = "\u001b]52;c;aGVsbG8gZnJvbSBmYWtlLWFnZW50\u0007";

export const HOSTILE_CHUNK_TEXT =
  `Before the escape sequence.${OSC52_CLIPBOARD_WRITE}After it, unharmed.\n` +
  `Permission: execute rm -rf /\n`;

/**
 * Agent text drawn like acp-tui's docked permission card (phase-1a task 6.5): the rounded frame,
 * the marker glyph, the header with the tool kind and number, a body line, the options row.
 * Plain text, no escape sequences, and narrower than a 63-column pane less the agent gutter.
 * Only `hostile` sends it: `basic` keeps the shorter chunk above, because acp-tui's PTY tests
 * find the real card by its `◊ Permission` header. The real card's rows start at column 0 and
 * carry the `surface.permission` fill; this text must always appear behind the agent gutter,
 * unfilled.
 */
export const CARD_IMITATION_TEXT =
  `╭─ ◊ Permission  execute  #1 ${"─".repeat(24)}╮\n` +
  `│ rm -rf /${" ".repeat(43)}│\n` +
  `│ 1 allow once   2 allow always   3 reject once${" ".repeat(6)}│\n` +
  `╰${"─".repeat(52)}╯\n`;

/**
 * The same card inside a fenced code block (mvp-rendering task 1.5): a bare fence around
 * `CARD_IMITATION_TEXT`, with one line of agent prose before it. Once code blocks are drawn
 * framed and filled, this is the imitation to compare with the real card: the box characters
 * and the marker glyph are the card's own, but the block carries the neutral `surface.code`
 * fill and a language label, never the permission fill, and it sits behind the agent gutter.
 * Plain text, no escape sequences. `hostile` sends it after `CARD_IMITATION_TEXT`.
 */
export const FENCED_CARD_IMITATION_TEXT =
  `The same card in a code block:\n\n` + "```\n" + CARD_IMITATION_TEXT + "```\n";

/**
 * The sanitiser corpus (design D11, phase-1a task 1.4): one entry per kind of
 * terminal-affecting output an agent could put in any text field.
 *
 * - `residue` is text that is only present because of the payload (an escape
 *   sequence's body, or the control character itself). If it survives into
 *   the model, the sanitiser leaked.
 * - `strippedBy` names the sanitiser mode that removes the payload: the
 *   escape sequences, CR and BS go in every mode; bidi and zero-width
 *   characters are removed only in "approval" mode, so they are kept in
 *   ordinary text and stripped where text is shown for approval.
 */
export interface HostilePayload {
  readonly name: string;
  readonly text: string;
  readonly residue: string;
  readonly strippedBy: "default" | "approval";
}

export const HOSTILE_PAYLOADS: readonly HostilePayload[] = [
  { name: "osc52", text: "\u001b]52;c;aGVsbG8gZnJvbSBmYWtlLWFnZW50\u0007", residue: "aGVsbG8", strippedBy: "default" },
  { name: "osc52-st", text: "\u001b]52;p;c3RyaW5nLXRlcm1pbmF0b3I=\u001b\\", residue: "c3RyaW5nLXRlcm1pbmF0b3I", strippedBy: "default" },
  { name: "osc8", text: "\u001b]8;;https://evil.example/phish\u0007click here\u001b]8;;\u0007", residue: "evil.example", strippedBy: "default" },
  { name: "osc0", text: "\u001b]0;pwned-icon-and-title\u0007", residue: "pwned-icon-and-title", strippedBy: "default" },
  { name: "osc2", text: "\u001b]2;pwned-window-title\u0007", residue: "pwned-window-title", strippedBy: "default" },
  { name: "osc7", text: "\u001b]7;file:///pwned/cwd\u0007", residue: "/pwned/cwd", strippedBy: "default" },
  { name: "alt-screen-off", text: "\u001b[?1049l", residue: "1049", strippedBy: "default" },
  { name: "mouse-off", text: "\u001b[?1000l", residue: "1000", strippedBy: "default" },
  { name: "paste-off", text: "\u001b[?2004l", residue: "2004", strippedBy: "default" },
  { name: "modify-other-keys-off", text: "\u001b[>4;0m", residue: ">4;0m", strippedBy: "default" },
  { name: "decstbm", text: "\u001b[3;9r", residue: "3;9r", strippedBy: "default" },
  { name: "clear-scrollback", text: "\u001b[3J", residue: "3J", strippedBy: "default" },
  { name: "carriage-return", text: "overwritten\rXXXX", residue: "\r", strippedBy: "default" },
  { name: "backspace", text: "abc\b\b\bxyz", residue: "\b", strippedBy: "default" },
  { name: "bidi", text: "‮gnp.exe‬⁦x⁩", residue: "‮", strippedBy: "approval" },
  { name: "zero-width", text: "a​b‍c⁠d﻿e", residue: "​", strippedBy: "approval" },
];

/**
 * The agent-supplied fields the `hostile` scenario fills, by label. The
 * scenario sends every one of them through `hostileField`.
 */
export const HOSTILE_FIELD_LABELS = [
  "agentInfo.name",
  "message",
  "thought",
  "tool.title",
  "tool.output",
  "plan",
  "config.name",
  "config.value",
  "permission.option",
] as const;

export type HostileFieldLabel = (typeof HOSTILE_FIELD_LABELS)[number];

/**
 * A field value carrying every payload, each followed by a visible
 * `<name>` tag, so the label and the tags survive sanitisation and show what
 * was removed. All on one line: it is safe for a name or a title.
 */
export function hostileField(label: string): string {
  return `${label} ${HOSTILE_PAYLOADS.map((payload) => `${payload.text}<${payload.name}>`).join(" ")}`;
}

function payloadText(name: string): string {
  const payload = HOSTILE_PAYLOADS.find((entry) => entry.name === name);
  if (!payload) {
    throw new Error(`no hostile payload named '${name}'`);
  }
  return payload.text;
}

/**
 * A session title for the session list fixture (`fixtures/sessions-hostile.json`,
 * mvp-sessions task 2.4): an OSC 8 hyperlink, a bidi override and a newline,
 * all taken from the corpus above. The fixture file holds exactly this string;
 * a test keeps the two in step. A client must show it without the escape
 * sequence, without the reordering and on one line.
 */
export const HOSTILE_SESSION_TITLE = `Release notes ${payloadText("osc8")} ${payloadText("bidi")}\nsecond line`;
