// The built-in default theme: text tokens use only the terminal's own palette
// (ANSI 0 to 15 plus default foreground), surface tokens are `derived` from the
// colours the terminal reports (derive.ts), so an Omarchy or IDE theme switch
// rethemes acp-tui with no integration code (design 6.10).
import type { LightStyle, Theme, TokenName, TokenStyle, TokenValue } from "./tokens.ts";
import { TOOL_KINDS } from "./tokens.ts";

// ANSI indices, for readability.
const RED = 1;
const GREEN = 2;
const YELLOW = 3;
const BLUE = 4;
const MAGENTA = 5;
const CYAN = 6;
const BRIGHT_BLACK = 8;
const BRIGHT_RED = 9;
const BRIGHT_BLUE = 12;

// Design decision 10: yellow is 1.88:1 on Zed's One Light and 1.89:1 on Ayu Light (3.16 on Islands
// Light), so on a light background (the terminal's reported background lighter than its
// foreground) the tokens that need 3:1 take another index: bright red for warnings (Solarized's
// orange) and types, magenta for inline code and attributes. The legibility test
// (legibility.test.ts) checks every listed token over the recorded palettes.

/**
 * Muted text (Marcus's review, 9 October 2026; spec tui-theme "Legible defaults in low-contrast
 * themes"): bright black on a dark background, where every recorded palette puts it between the
 * background and the foreground; on a light background the default foreground dimmed (SGR 2),
 * because there bright black is not muted: pure black in Zed's One Light (darker than the body
 * text), the link blue in Ayu Light, Solarized's darkest base. Both PhpStorm terminals draw SGR 2
 * as the average of the foreground and the cell's background (JediTerm's
 * `TerminalPanel.getStyleForeground`, the reworked terminal's `TerminalUiUtils.getResultForeground`,
 * PhpStorm 2026.2.3), and Zed with reduced opacity, so dimmed text always lies between the two in
 * lightness, follows the terminal's colours and never takes a hue of its own. `flags` are the
 * token's other attributes, kept on both backgrounds.
 */
function mutedStyle(flags: Omit<LightStyle, "color" | "dim"> = {}): TokenStyle {
  return { color: BRIGHT_BLACK, ...flags, light: { color: "default", dim: true, ...flags } };
}

/** Every `tool.kind.<kind>` refers to `tool.kind`, so the kinds look alike until a theme sets one. */
const TOOL_KIND_TOKENS = Object.fromEntries(TOOL_KINDS.map((kind) => [`tool.kind.${kind}`, { ref: "tool.kind" }])) as Record<
  `tool.kind.${(typeof TOOL_KINDS)[number]}`,
  TokenValue
>;

export const DEFAULT_THEME: Theme = {
  name: "terminal",
  tokens: {
    text: "default",
    muted: mutedStyle(),
    accent: BLUE,
    hint: mutedStyle(),
    warning: { color: YELLOW, light: BRIGHT_RED },
    danger: RED,
    user: BLUE,
    agent: MAGENTA,
    thought: mutedStyle({ italic: true }),
    permission: { color: YELLOW, bold: true },
    "status.fg": "default",
    // Day-one-feedback: bright blue and bold, so the sweep stands apart from the focused prompt
    // frame's `accent` (blue). On a light background bright blue is a pale grey-blue in some
    // palettes (2.93:1 on Solarized Light), so there it is magenta (4.2 to 7.4:1 on the others;
    // Zed Ayu Light, whose every colour is under 3:1, is a named palette limit).
    busy: { color: BRIGHT_BLUE, bold: true, light: MAGENTA },
    "tool.ok": GREEN,
    "tool.fail": RED,
    "tool.running": YELLOW,
    // Design decision 10: kind cyan, title default, count magenta, duration blue, index bright black.
    "tool.kind": CYAN,
    "tool.title": "default",
    "tool.count": MAGENTA,
    "tool.duration": BLUE,
    "tool.index": mutedStyle(),
    // day-one-feedback: a command result's labels refer to muted, so a theme that sets muted sets them.
    "tool.result.label": { ref: "muted" },
    ...TOOL_KIND_TOKENS,
    "diff.add": GREEN,
    "diff.remove": RED,
    "diff.hunk": CYAN,
    // tui-rendering "Headings distinct per level": quieter step by step (the rules are the renderer's).
    "markdown.heading.1": { color: BLUE, bold: true },
    "markdown.heading.2": { color: BLUE, bold: true },
    "markdown.heading.3": { color: BLUE, bold: true },
    "markdown.heading.4": { color: "default", bold: true },
    "markdown.heading.5": mutedStyle({ bold: true, italic: true }),
    "markdown.heading.6": mutedStyle({ italic: true }),
    "markdown.code": { color: YELLOW, light: MAGENTA },
    "markdown.link": { color: BLUE, underline: true },
    "markdown.quote": mutedStyle(),
    "markdown.list": BLUE,
    "markdown.task.done": GREEN,
    "markdown.task.open": "default",
    "markdown.table.border": mutedStyle(),
    "markdown.table.header": { color: BLUE, bold: true },
    "markdown.strike": mutedStyle(),
    "markdown.math": CYAN,
    // Audit M24: note blue, tip green, important magenta, warning yellow, caution red.
    "markdown.alert.note": BLUE,
    "markdown.alert.tip": GREEN,
    "markdown.alert.important": MAGENTA,
    "markdown.alert.warning": { color: YELLOW, light: BRIGHT_RED },
    "markdown.alert.caution": RED,
    // Design decision 8: keyword magenta, string green, comment bright black italic, number and
    // constant cyan, type yellow, function blue, tag red, attribute yellow, the rest default.
    "code.keyword": MAGENTA,
    "code.string": GREEN,
    "code.comment": mutedStyle({ italic: true }),
    "code.number": CYAN,
    "code.constant": CYAN,
    "code.type": { color: YELLOW, light: BRIGHT_RED },
    "code.function": BLUE,
    "code.variable": "default",
    "code.property": "default",
    "code.operator": "default",
    "code.punctuation": "default",
    "code.tag": RED,
    "code.attribute": { color: YELLOW, light: MAGENTA },
    "code.default": "default",
    "surface.user": "derived",
    "surface.card": "derived",
    "surface.code": "derived",
    "surface.overlay": "derived",
    "surface.cursor": "derived",
    "surface.cursor.faint": "derived",
    "surface.selection": "derived",
    "surface.permission": "derived",
    "surface.permission.selected": "derived",
    "status.bg": "derived",
    "diff.added.bg": "derived",
    "diff.removed.bg": "derived",
    "find.current": "derived",
    "find.other": "derived",
    "scrollbar.track": "derived",
    "scrollbar.thumb": "derived",
  } satisfies Record<TokenName, TokenValue>,
};
