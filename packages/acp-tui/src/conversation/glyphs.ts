// The glyph registry (mvp-configuration design D9; spec tui-config "Glyph sets"). Every glyph
// acp-tui draws has a name here (`tool.kind.read`, `list.bullet.1`, `frame.top_left`,
// `permission.marker`, ...) and a value in each of three sets: `unicode` (the default),
// `ascii` and `nerd-font`. The structures the renderers read (`ConversationGlyphs`,
// `ChromeGlyphs`, `PermissionGlyphs`, `MarkdownGlyphs`) are built from one resolved set of
// values, so choosing a set, or overriding a glyph by name, replaces one record.
//
// `unicode` holds glyphs that are in both JetBrains Mono and Lilex (decision 7; spec
// tui-rendering "Rendering glyphs in both fonts"), apart from the two Marcus accepted from a
// fallback font, `◦` and `✗`: `tools/glyph-check.py` checks every glyph of it and lists those as
// `ACCEPTED`. `ascii` has a form for every name, no wider than the unicode glyph. `nerd-font`
// replaces tool kinds and statuses with Nerd Font icons and keeps `unicode` for the rest.
//
// Each name has a width class (`Width`): one cell for single glyphs, a fixed width for gutters,
// task boxes and the like, a range for the footnote brackets, any width for the splash wordmark.
// A value must be printable and measure the same to OpenTUI (which draws it) and to the layout
// (`Bun.stringWidth`, which counts it), or it would be drawn misaligned; `checkGlyph` is the one
// check, used for overrides and for the built-in sets in the unit tests.
//
// Reading a glyph reactively is `live-glyphs.ts`: the active set in a Solid signal and the
// `LIVE_*` objects the renderers read it through. This module stays free of Solid and loads
// OpenTUI only when a width is first measured, because the configuration loader reads it.
//
// Gutters are all the same width, so wrapped rows line up. Agent text is always drawn behind the
// agent gutter and never starts at column 0 (design section 8); the permission marker is used by
// no other glyph of a set (except the title marker, which never reaches a screen cell), so agent
// text drawn with the set's glyphs never shows it.
import type { OptimizedBuffer } from "@opentui/core";
import { suggest } from "../config/problems.ts";
import type { ChromeGlyphs } from "../layout/glyphs.ts";
import type { PermissionGlyphs } from "../app/permission.ts";
import type { MarkdownGlyphs } from "./markdown/types.ts";

// -- Names, width classes and the three sets ---------------------------------------------------

/** How wide a glyph must be: `n` cells; `[min, max]` cells; `digits`: ten one-cell digits; `any`:
 *  any width (the splash wordmark's rows). */
export type Width = number | readonly [number, number] | "digits" | "any";

interface Row {
  readonly name: string;
  readonly width: Width;
  readonly unicode: string;
  readonly ascii: string;
  /** The `nerd-font` set's glyph, where it differs from `unicode`. */
  readonly nerd?: string;
}

const row = (name: string, width: Width, unicode: string, ascii: string, nerd?: string): Row => ({ name, width, unicode, ascii, ...(nerd === undefined ? {} : { nerd }) });

/** The `unicode` set's permission marker: a lozenge, in both JetBrains Mono and Lilex (`◈` is
 *  missing from Lilex) and used by no other glyph of the set (docs/mvp-notes/configuration.md). */
const UNICODE_MARKER = "◊";

const ROWS: readonly Row[] = [
  // Gutters: every one the same width, so wrapped rows line up.
  row("gutter.agent", 2, "  ", "  "),
  row("gutter.meta", 2, "  ", "  "),
  // Tool kinds, OpenCode's conventions where both fonts have the glyph (design 6.1, benchmark M8);
  // the nerd-font set draws Font Awesome icons.
  row("tool.kind.read", 1, "→", ">", "\uf15c"),
  row("tool.kind.edit", 1, "←", "<", "\uf040"),
  row("tool.kind.delete", 1, "×", "x", "\uf1f8"),
  row("tool.kind.move", 1, "»", "^", "\uf0ec"),
  row("tool.kind.search", 1, "*", "*", "\uf002"),
  row("tool.kind.execute", 1, "$", "$", "\uf120"),
  row("tool.kind.think", 1, "○", "o", "\uf0eb"),
  row("tool.kind.fetch", 1, "%", "%", "\uf0ac"),
  row("tool.kind.switch_mode", 1, "»", "~", "\uf074"),
  row("tool.kind.other", 1, "•", ".", "\uf141"),
  // Tool statuses. `stopped` is a tool the turn ended on while still pending or in progress, and
  // `running` a tool still running when no spinner frame is given (the activity bar).
  row("tool.status.ok", 1, "✓", "v", "\uf00c"),
  row("tool.status.fail", 1, "✗", "x", "\uf00d"),
  row("tool.status.stopped", 4, "stop", "stop"),
  row("tool.status.running", 1, "…", ".", "\uf110"),
  // The running-tool spinner: quadrants (the braille spinner is in neither font).
  row("spinner.1", 1, "▖", "|"),
  row("spinner.2", 1, "▘", "/"),
  row("spinner.3", 1, "▝", "-"),
  row("spinner.4", 1, "▗", "\\"),
  row("thought", 1, "○", "o"),
  row("plan.completed", 3, "[x]", "[x]"),
  row("plan.in_progress", 3, "[~]", "[~]"),
  row("plan.pending", 3, "[ ]", "[ ]"),
  // Between fields of the turn-end marker.
  row("separator", 3, " · ", " - "),
  // The rule on the left of an expanded card under the flat theme (no fill to mark it).
  row("card.rule", 1, "┃", "|"),
  // The conversation cursor's bar, in the gutter's first column beside the item under the cursor.
  row("cursor.bar", 1, "▎", "|"),
  // The conversation scroll bar under the flat theme (with derived surfaces the bar is fills).
  row("scrollbar.track", 1, "│", "|"),
  row("scrollbar.thumb", 1, "█", "#"),
  // Rendered Markdown (audit section 9): bullets by depth, repeating from the fifth level (review
  // C1): a cell-sized solid and hollow dot, then a small solid and hollow one.
  row("list.bullet.1", 1, "●", "*"),
  row("list.bullet.2", 1, "○", "o"),
  row("list.bullet.3", 1, "•", "+"),
  row("list.bullet.4", 1, "◦", "-"),
  row("task.done", 3, "[x]", "[x]"),
  row("task.open", 3, "[ ]", "[ ]"),
  row("heading.rule.1", 1, "━", "="),
  row("heading.rule.2", 1, "─", "-"),
  row("table.top_left", 1, "╭", "+"),
  row("table.top_right", 1, "╮", "+"),
  row("table.bottom_left", 1, "╰", "+"),
  row("table.bottom_right", 1, "╯", "+"),
  row("table.horizontal", 1, "─", "-"),
  row("table.vertical", 1, "│", "|"),
  row("table.top_tee", 1, "┬", "+"),
  row("table.bottom_tee", 1, "┴", "+"),
  row("table.left_tee", 1, "├", "+"),
  row("table.right_tee", 1, "┤", "+"),
  row("table.cross", 1, "┼", "+"),
  row("quote.bar", 1, "│", "|"),
  // A code block's left rule under the flat theme, and the mark in the last column of a code row
  // whose line goes on in the next row.
  row("code.rule", 1, "▎", "|"),
  row("code.continuation", 1, "↩", "\\"),
  // A footnote's number is its digits between `open` and `close`; no superscript digits in ASCII,
  // so there it is bracketed and `<sup>` and `<sub>` digits are left as written.
  row("footnote.digits", "digits", "⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789"),
  row("footnote.open", [0, 1], "", "["),
  row("footnote.close", [0, 1], "", "]"),
  row("superscript.digits", "digits", "⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789"),
  row("subscript.digits", "digits", "₀₁₂₃₄₅₆₇₈₉", "0123456789"),
  // The permission card's rounded frame and its marker. Never blank, and the marker is used by no
  // other glyph of the set (spec tui-config "Glyph validation").
  row("frame.top_left", 1, "╭", "+"),
  row("frame.top_right", 1, "╮", "+"),
  row("frame.bottom_left", 1, "╰", "+"),
  row("frame.bottom_right", 1, "╯", "+"),
  row("frame.horizontal", 1, "─", "-"),
  row("frame.vertical", 1, "│", "|"),
  row("permission.marker", 1, UNICODE_MARKER, "!"),
  // The busy indicator in the prompt box's top border: the track (the border's own line) and the
  // segment that sweeps over it.
  row("busy.track", 1, "─", "-"),
  row("busy.segment", 1, "━", "="),
  // The half cells of a segment that starts or ends in the middle of a cell (day-two-feedback
  // design D4): box-drawing half lines, never block elements (seams in PhpStorm reworked). The
  // segment's leading cell is light on the left and heavy on the right, its trailing cell the
  // reverse; a gap's cells are the line's remaining half. Empty means whole-cell steps.
  row("busy.segment.lead", [0, 1], "╼", ""),
  row("busy.segment.trail", [0, 1], "╾", ""),
  row("busy.gap.lead", [0, 1], "╴", ""),
  row("busy.gap.trail", [0, 1], "╶", ""),
  // The splash: the wordmark's rows, in box-drawing characters and never block elements (seams in
  // PhpStorm reworked, design 6.1), and the graphic's arrow, separator and the `more` that ends
  // its list of agents.
  row("splash.wordmark.1", "any", "┏━┓ ┏━╸ ┏━┓    ╺┳╸ ╻ ╻ ╻", ".-. .-- .-.    --- . . ."),
  row("splash.wordmark.2", "any", "┣━┫ ┃   ┣━┛ ━━  ┃  ┃ ┃ ┃", "|-| |   |-' --  |  | | |"),
  row("splash.wordmark.3", "any", "╹ ╹ ┗━╸ ╹       ╹  ┗━┛ ╹", "' ' '-- '       '  '-' '"),
  row("splash.arrow", 2, "━→", "->"),
  row("splash.separator", 3, " · ", " - "),
  row("splash.more", [1, 3], "…", "..."),
  // Marks the terminal's title while the session waits for the user. The permission marker unless
  // set otherwise, and exempt from the marker's uniqueness rule: the title is never drawn in screen
  // cells.
  row("title.marker", 1, UNICODE_MARKER, "!"),
];

export type GlyphName = string;
export type GlyphValues = Readonly<Record<GlyphName, string>>;
export const GLYPH_NAMES: readonly GlyphName[] = ROWS.map((r) => r.name);
const WIDTH_OF: ReadonlyMap<string, Width> = new Map(ROWS.map((r) => [r.name, r.width]));
export const GLYPH_SET_NAMES = ["unicode", "ascii", "nerd-font"] as const;
export type GlyphSetName = (typeof GLYPH_SET_NAMES)[number];

const toRecord = (pick: (r: Row) => string): GlyphValues => Object.freeze(Object.fromEntries(ROWS.map((r) => [r.name, pick(r)])));
const UNICODE_VALUES: GlyphValues = toRecord((r) => r.unicode);
const ASCII_VALUES: GlyphValues = toRecord((r) => r.ascii);
const NERD_VALUES: GlyphValues = toRecord((r) => r.nerd ?? r.unicode);

/** The glyphs of a set, by name. */
export const GLYPH_SETS: Readonly<Record<GlyphSetName, GlyphValues>> = { unicode: UNICODE_VALUES, ascii: ASCII_VALUES, "nerd-font": NERD_VALUES };

/** The group a glyph is listed in by `acp-tui glyphs --test`: its name up to the last dot (`list.bullet`
 *  for `list.bullet.1`, `tool.kind` for `tool.kind.read`), or the name itself when it has no dot. */
export function glyphGroup(name: GlyphName): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

export function widthClass(name: GlyphName): Width | undefined {
  return WIDTH_OF.get(name);
}

// -- Width and validity --------------------------------------------------------------------------

/** OpenTUI's width of text in cells: the function it draws with. OpenTUI 0.6 removed
 *  `RenderLib.encodeUnicode` and gives every buffer an owner, here a context of its own (as
 *  scripts/build-emoji-names.ts `openTuiWidth` does). Made when first used, so a module that only
 *  reads glyph values never loads the native library. */
let measureBuffer: OptimizedBuffer | null = null;
export function openTuiCells(text: string): number {
  if (text === "") return 0;
  if (measureBuffer === null) {
    // Loaded here and not at the top, so that reading a glyph (the configuration loader does) never loads the native library.
    const { OptimizedBuffer, ResourceContext } = require("@opentui/core") as typeof import("@opentui/core");
    const owner = new ResourceContext({ objectCapacity: 16, renderCellsMax: 16 });
    measureBuffer = OptimizedBuffer.create(1, 1, "unicode", { owner });
  }
  const encoded = measureBuffer.encodeUnicode(text);
  const width = encoded.data.reduce((sum, d) => sum + d.width, 0);
  measureBuffer.freeUnicode(encoded);
  return width;
}

/** The layout's width of text (what `layout/segments.ts` `displayWidth` counts with). */
const layoutCells = (text: string): number => Bun.stringWidth(text);

/** Control, format, surrogate and line or paragraph separator characters: not printable. Private
 *  use characters are, since Nerd Font icons live there. */
const NOT_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
/** Nothing visible: spaces, the Braille blank and Hangul filler. */
const BLANK = /^[\s⠀ㅤᅟᅠ]*$/u;

const cellsWord = (n: number): string => `${n} ${n === 1 ? "cell" : "cells"}`;

function widthRequirement(width: Width): string {
  if (typeof width === "number") return cellsWord(width);
  if (Array.isArray(width)) return `${width[0]} to ${width[1]} cells`;
  return "any width";
}

/**
 * Why `value` cannot be glyph `name`, or null when it can: printable; the same width to OpenTUI
 * and to the layout; the width its name requires; and not blank where it is a frame glyph or the
 * permission marker.
 */
export function checkGlyph(name: GlyphName, value: string, measure: (text: string) => number = openTuiCells): string | null {
  const width = WIDTH_OF.get(name);
  if (width === undefined) return "is not a glyph name";
  if (NOT_PRINTABLE.test(value)) return "is not printable (it holds a control or format character)";
  if (/^frame\./.test(name) || name === "permission.marker" || name === "title.marker") {
    if (BLANK.test(value)) return "cannot be blank";
  }
  if (width === "digits") {
    const digits = [...value];
    if (digits.length !== 10) return `takes ten digits, one cell each, not ${digits.length} characters`;
    for (const digit of digits) {
      const problem = checkCells(digit, 1, measure);
      if (problem) return problem;
    }
    return null;
  }
  const agreed = checkAgreement(value, measure);
  if (agreed) return agreed;
  if (width === "any") return null;
  const cells = measure(value);
  const [min, max] = typeof width === "number" ? [width, width] : width;
  if (cells < min || cells > max) {
    return typeof width === "number" ? `takes ${cellsWord(cells)} where ${width} ${width === 1 ? "is" : "are"} required` : `takes ${cellsWord(cells)} where ${widthRequirement(width)} are required`;
  }
  return null;
}

/** OpenTUI and the layout must count the glyph alike, or it is drawn misaligned. */
function checkAgreement(value: string, measure: (text: string) => number): string | null {
  const drawn = measure(value);
  const counted = layoutCells(value);
  if (drawn === counted) return null;
  return `is drawn ${cellsWord(drawn)} wide by the renderer and counted as ${cellsWord(counted)} by the layout, so it would be misaligned`;
}

function checkCells(value: string, cells: number, measure: (text: string) => number): string | null {
  const agreed = checkAgreement(value, measure);
  if (agreed) return agreed;
  const n = measure(value);
  return n === cells ? null : `takes ${cellsWord(n)} where ${cellsWord(cells)} ${cells === 1 ? "is" : "are"} required`;
}

// -- Overrides ------------------------------------------------------------------------------------

export interface GlyphProblem {
  /** The glyph's name as given. */
  readonly name: string;
  /** What is wrong, without the place (`takes 2 cells where 1 is required; "✓" stays in use`). */
  readonly message: string;
  /** The closest glyph name, for an unknown one. */
  readonly suggestion?: string;
}

/** The glyphs that never carry the permission marker's uniqueness: the marker itself and the title's. */
const MARKER_EXEMPT: ReadonlySet<string> = new Set(["permission.marker", "title.marker"]);

export interface GlyphsConfig {
  readonly set: GlyphSetName;
  readonly overrides: Readonly<Record<string, string>>;
}

export interface CheckedOverrides {
  /** The overrides that passed, by name. */
  readonly accepted: Readonly<Record<string, string>>;
  readonly problems: readonly GlyphProblem[];
}

/**
 * Checks `overrides` against the glyph set `set`: a name that is not a glyph, a value that is not
 * valid for its name (`checkGlyph`), and a glyph that holds the permission marker, or a marker that
 * another glyph of the set holds, are reported and left out, the set's own glyph staying in use.
 */
export function checkOverrides(set: GlyphSetName, overrides: Readonly<Record<string, string>>, measure: (text: string) => number = openTuiCells): CheckedOverrides {
  const base = GLYPH_SETS[set];
  const problems: GlyphProblem[] = [];
  const accepted: Record<string, string> = {};
  const stays = (name: string): string => `${JSON.stringify(base[name] ?? "")} stays in use`;
  for (const [name, value] of Object.entries(overrides)) {
    if (!WIDTH_OF.has(name)) {
      const closest = suggest(name, GLYPH_NAMES);
      problems.push({ name, message: "is not a glyph name and is ignored", ...(closest === undefined ? {} : { suggestion: closest }) });
      continue;
    }
    const why = checkGlyph(name, value, measure);
    if (why !== null) problems.push({ name, message: `${why}; ${stays(name)}` });
    else accepted[name] = value;
  }

  // The permission marker belongs to the card alone. A marker override that another glyph of the
  // set holds is dropped; then any other glyph override that holds the marker is.
  const reject = (name: string, message: string): void => {
    problems.push({ name, message: `${message}; ${stays(name)}` });
    delete accepted[name];
  };
  const held = (marker: string, name: string, value: string): boolean => !MARKER_EXEMPT.has(name) && value.includes(marker);
  const markerOverride = accepted["permission.marker"];
  if (markerOverride !== undefined) {
    const clash = GLYPH_NAMES.find((name) => !(name in accepted) && held(markerOverride, name, base[name]!));
    if (clash !== undefined) reject("permission.marker", `is used by ${clash} (the permission marker may not be used elsewhere)`);
  }
  const marker = accepted["permission.marker"] ?? base["permission.marker"]!;
  for (const [name, value] of Object.entries({ ...accepted })) {
    if (held(marker, name, value)) reject(name, "holds the permission marker, which may not be used elsewhere");
  }
  return { accepted, problems };
}

export interface ResolvedGlyphs {
  /** Every glyph by name, overrides applied. */
  readonly values: GlyphValues;
  readonly conversation: ConversationGlyphs;
  readonly chrome: ChromeGlyphs;
  readonly permission: PermissionGlyphs;
  /** Marks the terminal's title while the session waits for the user. */
  readonly titleMarker: string;
  /** Changes whenever `values` do; "" for the plain `unicode` set. */
  readonly key: string;
}

/**
 * The glyphs of a configuration: the set, with each valid override applied. `title.marker` follows
 * `permission.marker` unless it is overridden itself. The problems are those of the overrides that
 * were left out.
 */
export function resolveGlyphs(config: GlyphsConfig, measure: (text: string) => number = openTuiCells): { glyphs: ResolvedGlyphs; problems: readonly GlyphProblem[] } {
  const { accepted, problems } = checkOverrides(config.set, config.overrides, measure);
  const values: Record<string, string> = { ...GLYPH_SETS[config.set], ...accepted };
  if (accepted["permission.marker"] !== undefined && accepted["title.marker"] === undefined) values["title.marker"] = accepted["permission.marker"];
  return { glyphs: buildResolved(values), problems };
}

// -- The structures the renderers read ------------------------------------------------------------

export interface ConversationGlyphs {
  /** Width of every gutter, in columns. */
  readonly gutterWidth: number;
  readonly gutter: {
    readonly agent: string;
    /** Thoughts, tools, permission records, plans, markers. */
    readonly meta: string;
  };
  readonly toolStatus: {
    readonly ok: string;
    readonly fail: string;
    /** A tool the turn ended on while still pending or in progress. */
    readonly stopped: string;
    /** A tool still running, when no spinner frame is given (the activity bar). */
    readonly running: string;
  };
  /** Frames of the running-tool spinner, one column each. */
  readonly spinner: readonly string[];
  /** One column per ACP tool kind (`read`, `edit`, ...); `other` for anything else. */
  readonly toolKind: Readonly<Record<string, string>> & { readonly other: string };
  /** The thought one-liner's glyph. */
  readonly thought: string;
  readonly plan: { readonly completed: string; readonly in_progress: string; readonly pending: string };
  /** Between fields of the turn-end marker. */
  readonly separator: string;
  /** The rule on the left of an expanded card under the flat theme (no fill to mark it); never
   *  the permission card's frame glyph. */
  readonly cardRule: string;
  /** The conversation cursor's bar, one column, in the gutter's first column beside every row of
   *  the item under the cursor (review C5; not drawn under the flat theme). */
  readonly cursorBar: string;
  /** The conversation scroll bar under the flat theme, one column each, in `muted` (spec
   *  tui-layout "Conversation scrollbar"; with derived surfaces the bar is drawn as fills). */
  readonly scrollbar: { readonly track: string; readonly thumb: string };
  /** Rendered Markdown: bullets, task boxes, rules, quote bars, table borders. */
  readonly markdown: MarkdownGlyphs;
}

const TOOL_KINDS = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"] as const;

function buildMarkdown(v: GlyphValues): MarkdownGlyphs {
  return {
    bullets: [v["list.bullet.1"]!, v["list.bullet.2"]!, v["list.bullet.3"]!, v["list.bullet.4"]!],
    taskDone: v["task.done"]!,
    taskOpen: v["task.open"]!,
    ruleHeavy: v["heading.rule.1"]!,
    ruleLight: v["heading.rule.2"]!,
    quoteBar: v["quote.bar"]!,
    codeRule: v["code.rule"]!,
    codeContinuation: v["code.continuation"]!,
    footnoteDigits: [...v["footnote.digits"]!],
    footnoteOpen: v["footnote.open"]!,
    footnoteClose: v["footnote.close"]!,
    superscriptDigits: [...v["superscript.digits"]!],
    subscriptDigits: [...v["subscript.digits"]!],
    table: {
      topLeft: v["table.top_left"]!,
      topRight: v["table.top_right"]!,
      bottomLeft: v["table.bottom_left"]!,
      bottomRight: v["table.bottom_right"]!,
      horizontal: v["table.horizontal"]!,
      vertical: v["table.vertical"]!,
      topTee: v["table.top_tee"]!,
      bottomTee: v["table.bottom_tee"]!,
      leftTee: v["table.left_tee"]!,
      rightTee: v["table.right_tee"]!,
      cross: v["table.cross"]!,
    },
  };
}

function buildConversation(v: GlyphValues): ConversationGlyphs {
  const gutter = { agent: v["gutter.agent"]!, meta: v["gutter.meta"]! };
  return {
    gutterWidth: gutter.meta.length,
    gutter,
    toolStatus: { ok: v["tool.status.ok"]!, fail: v["tool.status.fail"]!, stopped: v["tool.status.stopped"]!, running: v["tool.status.running"]! },
    spinner: [v["spinner.1"]!, v["spinner.2"]!, v["spinner.3"]!, v["spinner.4"]!],
    toolKind: Object.fromEntries(TOOL_KINDS.map((kind) => [kind, v[`tool.kind.${kind}`]!])) as ConversationGlyphs["toolKind"],
    thought: v["thought"]!,
    plan: { completed: v["plan.completed"]!, in_progress: v["plan.in_progress"]!, pending: v["plan.pending"]! },
    separator: v["separator"]!,
    cardRule: v["card.rule"]!,
    cursorBar: v["cursor.bar"]!,
    scrollbar: { track: v["scrollbar.track"]!, thumb: v["scrollbar.thumb"]! },
    markdown: buildMarkdown(v),
  };
}

function buildChrome(v: GlyphValues): ChromeGlyphs {
  return {
    busy: {
      track: v["busy.track"]!,
      segment: v["busy.segment"]!,
      segmentLead: v["busy.segment.lead"]!,
      segmentTrail: v["busy.segment.trail"]!,
      gapLead: v["busy.gap.lead"]!,
      gapTrail: v["busy.gap.trail"]!,
    },
    splash: {
      wordmark: [v["splash.wordmark.1"]!, v["splash.wordmark.2"]!, v["splash.wordmark.3"]!],
      arrow: v["splash.arrow"]!,
      separator: v["splash.separator"]!,
      more: v["splash.more"]!,
    },
  };
}

function buildPermission(v: GlyphValues): PermissionGlyphs {
  return {
    marker: v["permission.marker"]!,
    topLeft: v["frame.top_left"]!,
    topRight: v["frame.top_right"]!,
    bottomLeft: v["frame.bottom_left"]!,
    bottomRight: v["frame.bottom_right"]!,
    horizontal: v["frame.horizontal"]!,
    vertical: v["frame.vertical"]!,
  };
}

/** Short keys for the sets in use, by their values: the same glyphs always have the same key. */
const SET_KEYS = new Map<string, string>();

function buildResolved(values: Record<string, string>): ResolvedGlyphs {
  const frozen: GlyphValues = Object.freeze({ ...values });
  const same = GLYPH_NAMES.every((name) => frozen[name] === UNICODE_VALUES[name]);
  const json = same ? "" : JSON.stringify(GLYPH_NAMES.map((name) => frozen[name]));
  let key = "";
  if (!same) {
    key = SET_KEYS.get(json) ?? `g${SET_KEYS.size + 1}`;
    SET_KEYS.set(json, key);
  }
  return {
    values: frozen,
    conversation: buildConversation(frozen),
    chrome: buildChrome(frozen),
    permission: buildPermission(frozen),
    titleMarker: frozen["title.marker"]!,
    key,
  };
}

/** The `unicode` set's Markdown glyphs; every one is in JetBrains Mono and Lilex (audit section 9),
 *  except the fourth-level bullet `◦`, which Lilex lacks and Zed draws from a fallback font
 *  (Marcus, 9 October 2026, review C1). */
const UNICODE_RESOLVED = buildResolved({ ...UNICODE_VALUES });
const ASCII_RESOLVED = buildResolved({ ...ASCII_VALUES });
const NERD_RESOLVED = buildResolved({ ...NERD_VALUES });
export const UNICODE_MARKDOWN_GLYPHS: MarkdownGlyphs = UNICODE_RESOLVED.conversation.markdown;

/** The `ascii` set's Markdown glyphs: a form for every key of the unicode set, no wider than the
 *  glyph it replaces. */
export const ASCII_MARKDOWN_GLYPHS: MarkdownGlyphs = ASCII_RESOLVED.conversation.markdown;

/** Each built-in set, resolved (no overrides). */
export const RESOLVED_SETS: Readonly<Record<GlyphSetName, ResolvedGlyphs>> = { unicode: UNICODE_RESOLVED, ascii: ASCII_RESOLVED, "nerd-font": NERD_RESOLVED };

/** The `unicode` set, fixed: what tests and tools that name no configuration draw with. */
export const DEFAULT_GLYPHS: ConversationGlyphs = UNICODE_RESOLVED.conversation;
/** The `ascii` set, fixed. */
export const ASCII_GLYPHS: ConversationGlyphs = ASCII_RESOLVED.conversation;
/** The `unicode` set's chrome and permission glyphs, fixed. */
export const DEFAULT_CHROME_GLYPHS: ChromeGlyphs = UNICODE_RESOLVED.chrome;
export const ASCII_CHROME_GLYPHS: ChromeGlyphs = ASCII_RESOLVED.chrome;
export const DEFAULT_PERMISSION_GLYPHS: PermissionGlyphs = UNICODE_RESOLVED.permission;

/** Milliseconds per spinner frame. */
export const SPINNER_FRAME_MS = 120;
