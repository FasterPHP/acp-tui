// Theme tokens (design 6.10, D7; spec tui-theme "Theme tokens, never literal colours"). Components
// refer to these names only; the theme decides the colour. A token is either a foreground or a
// background. The catalogue is the spec's, the conversation scroll bar's two surfaces
// (mvp-chrome-and-keys D17) included; `catalogue.test.ts` checks that every token name the
// components, renderers and bar modules read is here.

export type TokenRole = "fg" | "bg";

export const TOKENS = {
  // General text.
  text: { role: "fg", use: "body text of conversation rows and the composer" },
  muted: { role: "fg", use: "secondary text: turn-end markers, cwd, metadata" },
  accent: { role: "fg", use: "prompt marker, focus and the other accents" },
  hint: { role: "fg", use: "key hints bar" },
  warning: { role: "fg", use: "warnings, exit-armed hint" },
  danger: { role: "fg", use: "errors, disconnected state" },
  user: { role: "fg", use: "the user card's bar; under the flat style also the conversation cursor's inverse block on a user message (defaults to accent's colour)" },
  agent: { role: "fg", use: "the agent message's gutter glyph, blank unless glyphs.overrides sets gutter.agent; under the flat style, the conversation cursor's inverse gutter on an agent message" },
  thought: { role: "fg", use: "thought summary lines" },
  permission: { role: "fg", use: "permission prompt frame and marker glyph" },
  "status.fg": { role: "fg", use: "status bar text" },
  busy: { role: "fg", use: "the busy indicator's segment in the prompt box's top border under `busy.style` `colour` (bold bright blue by default, bold magenta on a light background, apart from the focused frame's accent)" },
  // Tool lines.
  "tool.ok": { role: "fg", use: "tool line: the ok status glyph" },
  "tool.fail": { role: "fg", use: "tool line: the fail status glyph and word" },
  "tool.running": { role: "fg", use: "tool line: the running status; in-progress tools in the activity region" },
  "tool.kind": { role: "fg", use: "tool line: the kind glyph and kind word (each tool.kind.<kind> defaults to it)" },
  "tool.title": { role: "fg", use: "tool line title, and an expanded tool card's full title" },
  "tool.count": { role: "fg", use: "tool line: line and match counts" },
  "tool.duration": { role: "fg", use: "tool line: the duration" },
  "tool.index": { role: "fg", use: "tool line: the per-session index (#n)" },
  "tool.result.label": { role: "fg", use: "a command result's labels in an expanded tool card: `Output:` and `Return code:` (defaults to muted)" },
  "tool.kind.read": { role: "fg", use: "tool line kind of read calls (defaults to tool.kind)" },
  "tool.kind.edit": { role: "fg", use: "tool line kind of edit calls (defaults to tool.kind)" },
  "tool.kind.delete": { role: "fg", use: "tool line kind of delete calls (defaults to tool.kind)" },
  "tool.kind.move": { role: "fg", use: "tool line kind of move calls (defaults to tool.kind)" },
  "tool.kind.search": { role: "fg", use: "tool line kind of search calls (defaults to tool.kind)" },
  "tool.kind.execute": { role: "fg", use: "tool line kind of execute calls (defaults to tool.kind)" },
  "tool.kind.think": { role: "fg", use: "tool line kind of think calls (defaults to tool.kind)" },
  "tool.kind.fetch": { role: "fg", use: "tool line kind of fetch calls (defaults to tool.kind)" },
  "tool.kind.switch_mode": { role: "fg", use: "tool line kind of switch_mode calls (defaults to tool.kind)" },
  "tool.kind.other": { role: "fg", use: "tool line kind of other and unknown calls (defaults to tool.kind)" },
  // Diffs.
  "diff.add": { role: "fg", use: "added lines (tool cards, one-liner summaries)" },
  "diff.remove": { role: "fg", use: "removed lines (tool cards, one-liner summaries)" },
  "diff.hunk": { role: "fg", use: "diff hunk headers (tool cards)" },
  // Markdown.
  "markdown.heading.1": { role: "fg", use: "Markdown level 1 headings (the renderer draws the heavy rule)" },
  "markdown.heading.2": { role: "fg", use: "Markdown level 2 headings (the renderer draws the light rule)" },
  "markdown.heading.3": { role: "fg", use: "Markdown level 3 headings" },
  "markdown.heading.4": { role: "fg", use: "Markdown level 4 headings" },
  "markdown.heading.5": { role: "fg", use: "Markdown level 5 headings" },
  "markdown.heading.6": { role: "fg", use: "Markdown level 6 headings" },
  "markdown.code": { role: "fg", use: "Markdown inline code, and maths shown as its source" },
  "markdown.link": { role: "fg", use: "Markdown links and footnote references" },
  "markdown.quote": { role: "fg", use: "Markdown block quotes and thematic breaks" },
  "markdown.list": { role: "fg", use: "Markdown list bullets and numbers" },
  "markdown.task.done": { role: "fg", use: "Markdown checked task box [x]" },
  "markdown.task.open": { role: "fg", use: "Markdown unchecked task box [ ]" },
  "markdown.table.border": { role: "fg", use: "Markdown table borders and the record layout's rules" },
  "markdown.table.header": { role: "fg", use: "Markdown table header cells and record headers" },
  "markdown.strike": { role: "fg", use: "Markdown ~~strikethrough~~ (always; SGR 9 only where the terminal draws it)" },
  "markdown.math": { role: "fg", use: "Markdown maths converted to Unicode" },
  "markdown.alert.note": { role: "fg", use: "GitHub alert [!NOTE]: bar and header word" },
  "markdown.alert.tip": { role: "fg", use: "GitHub alert [!TIP]: bar and header word" },
  "markdown.alert.important": { role: "fg", use: "GitHub alert [!IMPORTANT]: bar and header word" },
  "markdown.alert.warning": { role: "fg", use: "GitHub alert [!WARNING]: bar and header word" },
  "markdown.alert.caution": { role: "fg", use: "GitHub alert [!CAUTION]: bar and header word" },
  // Highlighted code (spec tui-theme "Code scope tokens"): a capture maps by its first segment.
  "code.keyword": { role: "fg", use: "highlighted code: keywords" },
  "code.string": { role: "fg", use: "highlighted code: strings" },
  "code.comment": { role: "fg", use: "highlighted code: comments" },
  "code.number": { role: "fg", use: "highlighted code: numbers" },
  "code.constant": { role: "fg", use: "highlighted code: constants and booleans" },
  "code.type": { role: "fg", use: "highlighted code: types and classes" },
  "code.function": { role: "fg", use: "highlighted code: functions and methods" },
  "code.variable": { role: "fg", use: "highlighted code: variables" },
  "code.property": { role: "fg", use: "highlighted code: properties and keys" },
  "code.operator": { role: "fg", use: "highlighted code: operators" },
  "code.punctuation": { role: "fg", use: "highlighted code: punctuation and brackets" },
  "code.tag": { role: "fg", use: "highlighted code: markup tags" },
  "code.attribute": { role: "fg", use: "highlighted code: markup attributes" },
  "code.default": { role: "fg", use: "highlighted code: every other scope, and code without a grammar" },
  // Surfaces.
  "surface.user": { role: "bg", use: "user message card" },
  "surface.card": { role: "bg", use: "expanded tool, thought and plan cards" },
  "surface.code": { role: "bg", use: "code blocks: a neutral fill, never the permission card's hue" },
  "surface.overlay": { role: "bg", use: "overlays: the session list, the link chooser and the @ file picker (the palette, pickers and key help are on the default background, mvp-chrome-and-keys task 12.7); derived at surface.card's step" },
  "surface.cursor": { role: "bg", use: "the conversation cursor's gutter bar (its colour), and the highlighted row of an overlay list (a fill)" },
  "surface.cursor.faint": { role: "bg", use: "the faint fill across the item under the conversation cursor, beside its bar" },
  "surface.selection": { role: "bg", use: "the conversation's text selection (distinct from the cursor's fill)" },
  "surface.permission": { role: "bg", use: "permission card fill" },
  "surface.permission.selected": { role: "bg", use: "selected option on the permission card (and other cards filled with surface.permission)" },
  "status.bg": { role: "bg", use: "status bar background (a surface)" },
  "diff.added.bg": { role: "bg", use: "added lines in diffs" },
  "diff.removed.bg": { role: "bg", use: "removed lines in diffs" },
  "find.current": { role: "bg", use: "the current find hit (text in the default foreground)" },
  "find.other": { role: "bg", use: "the other visible find hits (text in the default foreground)" },
  // The conversation scroll bar (mvp-chrome-and-keys D17).
  "scrollbar.track": { role: "bg", use: "the conversation scroll bar's track; flat: the glyph set's `scrollbar.track` in muted" },
  "scrollbar.thumb": { role: "bg", use: "the conversation scroll bar's thumb; flat: the glyph set's `scrollbar.thumb` in muted" },
} as const satisfies Record<string, { role: TokenRole; use: string }>;

export type TokenName = keyof typeof TOKENS;

export const TOKEN_NAMES = Object.keys(TOKENS) as TokenName[];

// The retired names are spelt in parts, so that `catalogue.test.ts`, which scans the source for
// token names read anywhere, does not take them for reads.
const RETIRED_SELECTED = ["surface", "selected"].join(".");
const RETIRED_HEADING = ["markdown", "heading"].join(".");

/**
 * Tokens a theme may no longer set, with what replaced them (spec tui-theme "Theme validation"):
 * `mvp-rendering` split the selection surface in two and gave every heading level its own token.
 */
export const RETIRED_TOKENS: Readonly<Record<string, readonly TokenName[]>> = {
  [RETIRED_SELECTED]: ["surface.cursor", "surface.selection"],
  [RETIRED_HEADING]: ["markdown.heading.1", "markdown.heading.2", "markdown.heading.3", "markdown.heading.4", "markdown.heading.5", "markdown.heading.6"],
};

/** How a retired token's replacements read in a message; null for a name that is not retired. */
export function retiredReplacement(name: string): string | null {
  const replacements = Object.hasOwn(RETIRED_TOKENS, name) ? RETIRED_TOKENS[name]! : null;
  if (!replacements) return null;
  if (replacements.length > 2) return `${replacements[0]} to ${replacements.at(-1)}`;
  return replacements.length === 1 ? replacements[0]! : `${replacements.slice(0, -1).join(", ")} and ${replacements.at(-1)}`;
}

/** The ACP tool kinds, each with its own `tool.kind.<kind>` token. */
export const TOOL_KINDS = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"] as const;
export type ToolKindName = (typeof TOOL_KINDS)[number];

/** The token of a tool kind's segment; a missing or unknown kind takes `tool.kind.other`. */
export function toolKindToken(kind: string | null | undefined): TokenName {
  return (TOOL_KINDS as readonly string[]).includes(kind ?? "") ? (`tool.kind.${kind}` as TokenName) : "tool.kind.other";
}

/**
 * The surface tokens: the background tokens whose default is `derived` from the
 * terminal's own colours (theme surfaces, design D8). Outside these the terminal's
 * default background shows.
 */
export const SURFACE_NAMES = [
  "status.bg",
  "surface.card",
  "surface.overlay",
  "surface.user",
  "surface.code",
  "surface.cursor",
  "surface.cursor.faint",
  "surface.selection",
  "surface.permission",
  "surface.permission.selected",
  "diff.added.bg",
  "diff.removed.bg",
  "find.current",
  "find.other",
  "scrollbar.track",
  "scrollbar.thumb",
] as const satisfies readonly TokenName[];

export type SurfaceName = (typeof SURFACE_NAMES)[number];

/**
 * A colour: an ANSI palette index (0 to 15 for the default theme; up to 255
 * accepted), `default` (the terminal's own foreground or background, by the
 * token's role), a `#rrggbb` hex value (later themes only), or `derived` (a
 * surface token only: computed from the terminal's reported foreground and
 * background, or the terminal's default background when they are unknown).
 */
export type ColorValue = number | "default" | "derived" | `#${string}`;

export interface TokenStyle {
  color: ColorValue;
  /**
   * The look on a light background (the terminal's reported background lighter than its
   * foreground), when it differs (design decision 10: one ANSI index cannot always serve light
   * and dark themes): a colour, which replaces `color` only, or a whole style, which replaces the
   * colour and the attributes (muted text drawn as the default foreground dimmed, Marcus's review
   * of 9 October 2026). While the terminal's colours are unknown, the token's own style applies.
   */
  light?: ColorValue | LightStyle;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** A token's whole style on a light background (`TokenStyle.light`). */
export type LightStyle = Omit<TokenStyle, "light">;

/**
 * A reference to another token of the same role: the token takes that token's value, so a theme
 * that changes the referenced token changes this one too (each `tool.kind.<kind>` refers to
 * `tool.kind` in the default theme).
 */
export interface TokenRef {
  ref: TokenName;
}

/** A token value is a bare colour, a colour with text attributes, or a reference to another token. */
export type TokenValue = ColorValue | TokenStyle | TokenRef;

export interface Theme {
  name: string;
  tokens: Record<TokenName, TokenValue>;
}
