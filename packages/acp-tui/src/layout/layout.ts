// The screen layout engine (design D7, spec tui-layout): a declarative layout
// of the whole screen, its validation, and bar composition with priority
// dropping. The screen is one full-height column: bars and blocks take their
// natural height and the `conversation` block takes every row they leave.
import { isForegroundToken, isModuleId, MODULES, type ModuleId, type ModuleSettings, type ResolvedModuleSettings } from "./modules.ts";
import { fitSegments, segmentsWidth, type Segment } from "./segments.ts";
import { templateFields } from "./template.ts";
import { PILL_CATEGORIES, type PillCategory, type SessionView } from "./view.ts";

export const BLOCK_NAMES = ["conversation", "activity", "card", "prompt", "find"] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];

/** Blocks that must appear exactly once (spec tui-layout "Layout validation"). */
export const REQUIRED_BLOCKS = ["conversation", "card", "prompt", "find"] as const satisfies readonly BlockName[];

/** The top and bottom margins' rows: obligatory, 1 to 3 (Marcus's answer 4; mvp-chrome-and-keys
 *  design D1). */
export const MARGIN_ROWS = { min: 1, max: 3 } as const;
/** A spacer's rows. */
export const SPACER_ROWS = { min: 0, max: 3 } as const;

/** Blank rows above and below every other region. */
export interface Margins {
  top: number;
  bottom: number;
}

/** The margins of a layout that names none (as the configuration's omitted parts keep the default
 *  layout's, `mvp-configuration` design D11). */
export const DEFAULT_MARGINS: Readonly<Margins> = { top: 1, bottom: 1 };

/** Rows below an overlay anchored above the status row in the default layout (the palette, the
 *  session list, the link chooser): the status row and the bottom margin. */
export const OVERLAY_BOTTOM = DEFAULT_MARGINS.bottom + 1;

export type ModuleEntry = ModuleId | ({ id: ModuleId } & ModuleSettings);

export interface BarRegion {
  left?: readonly ModuleEntry[];
  center?: readonly ModuleEntry[];
  right?: readonly ModuleEntry[];
}

/** A fixed number of blank rows between two regions. */
export interface SpacerRegion {
  spacer: number;
}

export type Region = BlockName | BarRegion | SpacerRegion;

/** The prompt box's bottom border (spec tui-layout "Config option pills"): the pills, in order,
 *  and the modules on its right. */
export interface PromptBorder {
  /** Default all three: `mode`, `model`, `thought_level`. */
  pills?: readonly PillCategory[];
  /** Default `DEFAULT_PROMPT_RIGHT` (the context gauge). */
  right?: readonly ModuleEntry[];
}

/** The `layout` key of the config file (design 6.10, `mvp-configuration` design D11) as the
 *  engine takes it: the margins, the regions from top to bottom between them, the prompt box's
 *  bottom border, the conversation's row floor and its scroll bar. `layoutFromConfig`
 *  (from-config.ts) makes one from the configuration's snake-case section. */
export interface Layout {
  /** Default `DEFAULT_MARGINS`. */
  margins?: Margins;
  screen: readonly Region[];
  /** Omitted parts keep the default's. */
  prompt?: PromptBorder;
  /** `layout.conversation_min_rows`: the rows the row budget keeps for the conversation (spec
   *  tui-layout "Margins and row budget"); default `DEFAULT_CONVERSATION_MIN_ROWS`. */
  conversationMinRows?: number;
  /** `layout.scrollbar`: the conversation's rightmost column is its scroll bar (spec tui-layout
   *  "Conversation scrollbar"); default true. */
  scrollbar?: boolean;
}

/** The conversation's row floor by default (`layout.conversation_min_rows`), and its range. */
export const DEFAULT_CONVERSATION_MIN_ROWS = 12;
export const CONVERSATION_MIN_ROWS = { min: 4, max: 30 } as const;

/** The modules on the right of the prompt box's bottom border by default: the context gauge
 *  (mvp-chrome-and-keys design D4). */
export const DEFAULT_PROMPT_RIGHT: readonly ModuleEntry[] = [{ id: "usage", format: "{used}/{size}", token: "muted", priority: 60 }];

export interface ResolvedModule extends ResolvedModuleSettings {
  id: ModuleId;
}

export type ResolvedBar = { kind: "bar"; left: ResolvedModule[]; center: ResolvedModule[]; right: ResolvedModule[] };

export type ResolvedSpacer = { kind: "spacer"; rows: number };

export type ResolvedRegion = { kind: "block"; name: BlockName } | ResolvedBar | ResolvedSpacer;

export interface ResolvedPromptBorder {
  pills: readonly PillCategory[];
  right: ResolvedBar;
}

export interface ResolvedLayout {
  margins: Margins;
  regions: ResolvedRegion[];
  prompt: ResolvedPromptBorder;
  conversationMinRows: number;
  scrollbar: boolean;
}

/**
 * Decision 15 (research/full-screen-synthesis.md) with mvp-chrome-and-keys design D1: no header
 * row; a one-row top margin; the conversation, the activity bar and the docked card (each only
 * while non-empty), the prompt box; a one-row spacer; the find bar (only while find is open;
 * mvp-conversation design D10); one status row; a one-row bottom margin.
 */
export const DEFAULT_LAYOUT: Layout = {
  margins: { top: 1, bottom: 1 },
  screen: [
    "conversation",
    "activity",
    "card",
    "prompt",
    { spacer: 1 },
    "find",
    { left: ["cwd", "turn-state", "hints"], right: ["config", "mouse", "density", "position", "connection", "usage", "cost"] },
  ],
};

/** The header-bar alternative (spec "Alternative layout with a header bar"). */
export const COMPACT_LAYOUT: Layout = {
  margins: { top: 1, bottom: 1 },
  screen: [
    { left: ["agent", "cwd"] },
    "conversation",
    "activity",
    "card",
    "prompt",
    "find",
    { left: ["turn-state"], right: ["connection"] },
  ],
};

export type ValidationResult = { ok: true; layout: ResolvedLayout } | { ok: false; errors: string[] };

/** One resolved region object per block, shared by every layout, so a new layout (a live reload of
 *  the configuration, mvp-configuration task 3.2) keeps each block's component mounted: Screen's
 *  list is keyed by region object, so the conversation keeps its reading position and focus, and
 *  only the bars and spacers are built afresh. */
const BLOCK_REGIONS: Readonly<Record<BlockName, ResolvedRegion>> = Object.freeze(
  Object.fromEntries(BLOCK_NAMES.map((name) => [name, Object.freeze({ kind: "block" as const, name })])) as Record<BlockName, ResolvedRegion>,
);

const SIDES = ["left", "center", "right"] as const;
const SETTING_KEYS = new Set(["id", "format", "priority", "hideWhenEmpty", "token", "maxWidth", "hints"]);

function resolveEntry(entry: unknown, where: string, errors: string[]): ResolvedModule | null {
  const raw = typeof entry === "string" ? { id: entry } : entry;
  if (typeof raw !== "object" || raw === null || typeof (raw as { id?: unknown }).id !== "string") {
    errors.push(`${where}: a module entry must be a module name or an object with an "id"`);
    return null;
  }
  const settings = raw as { id: string } & Record<string, unknown>;
  if (!isModuleId(settings.id)) {
    errors.push(`${where}: unknown module "${settings.id}"`);
    return null;
  }
  const def = MODULES[settings.id];
  const name = `${where} module "${settings.id}"`;
  for (const key of Object.keys(settings)) {
    if (!SETTING_KEYS.has(key)) errors.push(`${name}: unknown setting "${key}"`);
  }
  const out: ResolvedModule = { ...def.defaults, id: settings.id };
  if (settings.format !== undefined) {
    if (typeof settings.format !== "string") {
      errors.push(`${name}: "format" must be a string`);
    } else {
      try {
        for (const field of templateFields(settings.format)) {
          if (!def.fields.includes(field)) {
            const allowed = def.fields.length ? def.fields.map((f) => `{${f}}`).join(", ") : "none";
            errors.push(`${name}: unknown placeholder "{${field}}" (allowed: ${allowed})`);
          }
        }
        out.format = settings.format;
      } catch (e) {
        errors.push(`${name}: ${(e as Error).message}`);
      }
    }
  }
  if (settings.priority !== undefined) {
    if (typeof settings.priority !== "number" || !Number.isFinite(settings.priority)) errors.push(`${name}: "priority" must be a number`);
    else out.priority = settings.priority;
  }
  if (settings.hideWhenEmpty !== undefined) {
    if (typeof settings.hideWhenEmpty !== "boolean") errors.push(`${name}: "hideWhenEmpty" must be true or false`);
    else out.hideWhenEmpty = settings.hideWhenEmpty;
  }
  if (settings.token !== undefined) {
    if (typeof settings.token !== "string" || !isForegroundToken(settings.token)) errors.push(`${name}: "token" must be a foreground theme token`);
    else out.token = settings.token;
  }
  if (settings.maxWidth !== undefined) {
    if (typeof settings.maxWidth !== "number" || !Number.isInteger(settings.maxWidth) || settings.maxWidth < 1) {
      errors.push(`${name}: "maxWidth" must be a positive integer`);
    } else out.maxWidth = settings.maxWidth;
  }
  if (settings.hints !== undefined) {
    if (!Array.isArray(settings.hints)) errors.push(`${name}: "hints" must be a list`);
    else out.hints = settings.hints as ModuleSettings["hints"];
  }
  return out;
}

/** Resolves one bar's module lists, collecting problems into `errors`. */
function resolveBarRegion(region: object, where: string, errors: string[], seen?: Map<ModuleId, ResolvedModule[]>): ResolvedBar {
  const bar: ResolvedBar = { kind: "bar", left: [], center: [], right: [] };
  for (const key of Object.keys(region)) {
    if (!(SIDES as readonly string[]).includes(key)) errors.push(`${where}: unknown bar key "${key}" (expected left, center, right)`);
  }
  for (const side of SIDES) {
    const list = (region as Record<string, unknown>)[side];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`${where}.${side}: must be a list of modules`);
      continue;
    }
    list.forEach((entry: unknown, j) => {
      const m = resolveEntry(entry, `${where}.${side}[${j}]`, errors);
      if (!m) return;
      bar[side].push(m);
      seen?.set(m.id, [...(seen.get(m.id) ?? []), m]);
    });
  }
  return bar;
}

const wholeIn = (n: unknown, range: { min: number; max: number }): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= range.min && n <= range.max;

/** A layout's margins, collecting problems into `errors`; absent ones take `DEFAULT_MARGINS`. */
function resolveMargins(raw: unknown, errors: string[]): Margins {
  const out: Margins = { ...DEFAULT_MARGINS };
  if (raw === undefined) return out;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push('"margins" must be an object with "top" and "bottom" rows');
    return out;
  }
  for (const key of Object.keys(raw)) {
    if (key !== "top" && key !== "bottom") errors.push(`margins: unknown key "${key}" (expected top, bottom)`);
  }
  for (const side of ["top", "bottom"] as const) {
    const value = (raw as Record<string, unknown>)[side];
    if (value === undefined) continue;
    if (wholeIn(value, MARGIN_ROWS)) out[side] = value;
    else errors.push(`the ${side} margin takes ${MARGIN_ROWS.min} to ${MARGIN_ROWS.max} rows (got ${JSON.stringify(value)})`);
  }
  return out;
}

/**
 * Validates a layout and resolves module defaults. Rules (spec tui-layout "Layout validation"):
 * `conversation`, `card`, `prompt` and `find` exactly once; top and bottom margins of 1 to 3 rows
 * (obligatory: absent ones take the default's), spacers of 0 to 3 rows; `turn-state` and
 * `connection` each in some bar, with a format that shows their state. Every problem is reported.
 */
export function validateLayout(layout: unknown): ValidationResult {
  const errors: string[] = [];
  const screen = (layout as { screen?: unknown } | null)?.screen;
  if (!Array.isArray(screen)) return { ok: false, errors: ['layout must have a "screen" list of regions'] };
  const margins = resolveMargins((layout as { margins?: unknown }).margins, errors);

  const regions: ResolvedRegion[] = [];
  const blockCounts = new Map<string, number>();
  const modulesSeen = new Map<ModuleId, ResolvedModule[]>();

  screen.forEach((region: unknown, i) => {
    const where = `screen[${i}]`;
    if (typeof region === "string") {
      if (!(BLOCK_NAMES as readonly string[]).includes(region)) {
        errors.push(`${where}: unknown region "${region}" (blocks: ${BLOCK_NAMES.join(", ")})`);
        return;
      }
      blockCounts.set(region, (blockCounts.get(region) ?? 0) + 1);
      regions.push(BLOCK_REGIONS[region as BlockName]);
      return;
    }
    if (typeof region !== "object" || region === null || Array.isArray(region)) {
      errors.push(`${where}: a region must be a block name, a spacer or a bar with left, center and right lists`);
      return;
    }
    if ("spacer" in region) {
      const rows = (region as { spacer: unknown }).spacer;
      for (const key of Object.keys(region)) if (key !== "spacer") errors.push(`${where}: unknown spacer key "${key}"`);
      if (wholeIn(rows, SPACER_ROWS)) regions.push({ kind: "spacer", rows });
      else errors.push(`${where}: a spacer takes ${SPACER_ROWS.min} to ${SPACER_ROWS.max} rows (got ${JSON.stringify(rows)})`);
      return;
    }
    regions.push(resolveBarRegion(region, where, errors, modulesSeen));
  });

  for (const block of REQUIRED_BLOCKS) {
    const n = blockCounts.get(block) ?? 0;
    if (n === 0) errors.push(`layout is missing the "${block}" region; it must appear exactly once`);
    else if (n > 1) errors.push(`the "${block}" region appears ${n} times; it must appear exactly once`);
  }
  for (const id of ["turn-state", "connection"] as const) {
    const seen = modulesSeen.get(id);
    if (!seen) {
      errors.push(`layout is missing the "${id}" module; it must appear in a bar`);
    } else if (!seen.some((m) => templateFields(m.format).includes("state"))) {
      errors.push(`the "${id}" module's format must include "{state}" so the state stays visible`);
    }
  }

  const raw = layout as Layout;
  const prompt = resolvePromptBorder(raw.prompt, errors);
  let conversationMinRows = DEFAULT_CONVERSATION_MIN_ROWS;
  if (raw.conversationMinRows !== undefined) {
    if (wholeIn(raw.conversationMinRows, CONVERSATION_MIN_ROWS)) conversationMinRows = raw.conversationMinRows;
    else errors.push(`the conversation's row floor takes ${CONVERSATION_MIN_ROWS.min} to ${CONVERSATION_MIN_ROWS.max} rows (got ${JSON.stringify(raw.conversationMinRows)})`);
  }
  let scrollbar = true;
  if (raw.scrollbar !== undefined) {
    if (typeof raw.scrollbar === "boolean") scrollbar = raw.scrollbar;
    else errors.push('"scrollbar" must be true or false');
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, layout: { margins, regions, prompt, conversationMinRows, scrollbar } };
}

/** The prompt box's bottom border, collecting problems into `errors`; omitted parts take the
 *  default's. */
function resolvePromptBorder(raw: unknown, errors: string[]): ResolvedPromptBorder {
  const out: ResolvedPromptBorder = { pills: PILL_CATEGORIES, right: resolveBarRegion({ right: DEFAULT_PROMPT_RIGHT }, "prompt", []) };
  if (raw === undefined) return out;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push('"prompt" must be an object with "pills" and "right"');
    return out;
  }
  for (const key of Object.keys(raw)) if (key !== "pills" && key !== "right") errors.push(`prompt: unknown key "${key}" (expected pills, right)`);
  const { pills, right } = raw as { pills?: unknown; right?: unknown };
  if (pills !== undefined) {
    if (!Array.isArray(pills) || pills.some((p) => !(PILL_CATEGORIES as readonly unknown[]).includes(p))) {
      errors.push(`prompt.pills: a list of ${PILL_CATEGORIES.join(", ")}`);
    } else if (new Set(pills).size !== pills.length) {
      errors.push("prompt.pills: each pill at most once");
    } else out.pills = pills as PillCategory[];
  }
  if (right !== undefined) out.right = resolveBarRegion({ right }, "prompt", errors);
  return out;
}

// -- Row budget ----------------------------------------------------------------------------

/** The prompt box's resting heights in text rows, the tallest first (design D1). */
export const PROMPT_REST_ROWS = [3, 2, 1] as const;

/**
 * The prompt box's resting text rows (spec tui-layout "Margins and row budget"): the largest of 3,
 * 2 or 1 that leaves the conversation at least `floor` rows of a `screenRows`-row screen, where
 * `chromeRows` are the rows every other region takes at rest (the margins, the spacers, the bars
 * and the prompt box's frame and padding row; no activity bar, card or find bar); 1 when none
 * does.
 */
export function restingPromptRows(screenRows: number, chromeRows: number, floor: number): number {
  for (const rows of PROMPT_REST_ROWS) if (screenRows - chromeRows - rows >= floor) return rows;
  return 1;
}

/**
 * The row budget at rest with the blank row between the conversation and the prompt box
 * (day-one-feedback, Marcus 15 October 2026), when the layout puts the prompt box directly under
 * the conversation (`idleRow`): the prompt box rests at the largest of 3, 2 or 1 text rows that,
 * with that row too, leaves the conversation its `floor`, so the row comes before a second or
 * third empty text row; when even one text row cannot, the row gives way (spacing before
 * content) and the text rows are `restingPromptRows`'s.
 */
export function restingBudget(screenRows: number, chromeRows: number, floor: number, idleRow: boolean): { rows: number; idleGap: boolean } {
  if (idleRow) for (const rows of PROMPT_REST_ROWS) if (screenRows - chromeRows - 1 - rows >= floor) return { rows, idleGap: true };
  return { rows: restingPromptRows(screenRows, chromeRows, floor), idleGap: false };
}

// -- Spacing (day-one-feedback, Marcus 15 October 2026) --------------------------------------

/**
 * The decorative rows around and inside the conversation's neighbours, in the order they give way
 * when the rows run short (spec tui-layout "Spacing gives way before content"): the row between
 * the docked card and the prompt box, the row above the card, the activity bar's blank row, the
 * row between the conversation and the prompt box while nothing else sits between them, the
 * card's padding rows inside its frame, and the prompt box's padding row.
 */
export const SPACING_ORDER = ["cardBelow", "cardAbove", "activityGap", "idleGap", "cardPadding", "promptPadding"] as const;
export type SpacingRow = (typeof SPACING_ORDER)[number];
/** Which decorative rows are drawn now (a row that does not apply is false). */
export type Spacing = Readonly<Record<SpacingRow, boolean>>;

/** Every decorative row drawn (before the screen has measured its regions). */
export const FULL_SPACING: Spacing = Object.freeze({ cardBelow: true, cardAbove: true, activityGap: true, idleGap: true, cardPadding: true, promptPadding: true });

/** The conversation's rows that spacing never takes (and the docked card's keep, spec tui-layout
 *  "Permission card"). */
export const CONVERSATION_KEEP_ROWS = 4;

export interface SpacingInput {
  /** The rows the conversation, the activity bar, the docked card, the prompt box and their
   *  spacing share: the screen less its margins, spacers, bars and other blocks. */
  readonly rows: number;
  /** The activity bar's line shows. */
  readonly activity: boolean;
  /** The activity bar's blank row may be drawn (default true): the screen withholds it where the
   *  row budget would not keep the conversation's floor with it and no card is docked. */
  readonly activityGap?: boolean;
  /** The docked card's claim in rows, its frame included and its padding not: its title, its
   *  options and its preview's first rows (`PREVIEW_CLAIM_ROWS`); 0 while no card is docked. */
  readonly card: number;
  /** The card's padding rows at its top and at its bottom (`cards.padding.rows`). */
  readonly cardPadding: number;
  /** The prompt box's rows without its padding row (its text rows and frame); 0 if not shown. */
  readonly prompt: number;
  /** The conversation is directly above the prompt box (no activity bar or card between). */
  readonly idle: boolean;
  /** The conversation's rows spacing never takes (`CONVERSATION_KEEP_ROWS` by default). */
  readonly keep?: number;
}

/**
 * The decorative rows to draw (spec tui-layout "Spacing gives way before content"): every one that
 * applies while the content (the activity line, the card's claim, the prompt box and the
 * conversation's keep) and the spacing fit `rows`; otherwise they give way one by one in
 * `SPACING_ORDER` until they do, or none is left.
 */
export function spacing(input: SpacingInput): Spacing {
  const docked = input.card > 0;
  const rowsOf: Record<SpacingRow, number> = {
    cardBelow: docked ? 1 : 0,
    cardAbove: docked ? 1 : 0,
    activityGap: input.activity && input.activityGap !== false ? 1 : 0,
    idleGap: input.idle ? 1 : 0,
    cardPadding: docked ? 2 * Math.max(0, input.cardPadding) : 0,
    promptPadding: input.prompt > 0 ? 1 : 0,
  };
  const content = (input.activity ? 1 : 0) + input.card + input.prompt + (input.keep ?? CONVERSATION_KEEP_ROWS);
  let decoration = 0;
  for (const name of SPACING_ORDER) decoration += rowsOf[name];
  const drawn = {} as Record<SpacingRow, boolean>;
  for (const name of SPACING_ORDER) drawn[name] = rowsOf[name] > 0;
  for (const name of SPACING_ORDER) {
    if (content + decoration <= input.rows) break;
    if (!drawn[name]) continue;
    drawn[name] = false;
    decoration -= rowsOf[name];
  }
  return drawn;
}

export class LayoutError extends Error {
  constructor(readonly errors: string[]) {
    super(`invalid layout: ${errors.join("; ")}`);
  }
}

/** Resolves a layout or throws a LayoutError listing every problem. */
export function resolveLayout(layout: unknown): ResolvedLayout {
  const result = validateLayout(layout);
  if (!result.ok) throw new LayoutError(result.errors);
  return result.layout;
}

/** Resolves a single bar outside a layout (the prompt box's border); throws on problems. */
export function resolveBar(bar: BarRegion): ResolvedBar {
  const errors: string[] = [];
  const out = resolveBarRegion(bar, "bar", errors);
  if (errors.length > 0) throw new LayoutError(errors);
  return out;
}

// -- Bar composition -----------------------------------------------------------------------

/** Columns of padding at each end of a bar, and between modules and groups. */
export const BAR_PADDING = 1;
export const MODULE_GAP = 2;

type Side = (typeof SIDES)[number];

interface Rendered {
  module: ResolvedModule;
  side: Side;
  order: number;
  segments: Segment[];
  width: number;
  pinned: boolean;
}

function groupWidth(items: readonly Rendered[]): number {
  if (items.length === 0) return 0;
  return items.reduce((w, r) => w + r.width, 0) + MODULE_GAP * (items.length - 1);
}

function totalWidth(items: readonly Rendered[], padding: number): number {
  const groups = SIDES.map((side) => items.filter((r) => r.side === side)).filter((g) => g.length > 0);
  if (groups.length === 0) return 0;
  return 2 * padding + groups.reduce((w, g) => w + groupWidth(g), 0) + MODULE_GAP * (groups.length - 1);
}

function joinGroup(items: readonly Rendered[], gapToken: Segment["token"]): Segment[] {
  const out: Segment[] = [];
  items.forEach((r, i) => {
    if (i > 0) out.push({ text: " ".repeat(MODULE_GAP), token: gapToken });
    out.push(...r.segments);
  });
  return out;
}

/** The segments before the last clean break (`breakBefore`), trailing blanks removed; null if none. */
function cutAtLastBreak(segments: readonly Segment[]): Segment[] | null {
  for (let i = segments.length - 1; i > 0; i--) {
    if (!segments[i]!.breakBefore) continue;
    const kept = segments.slice(0, i);
    while (kept.length > 0 && kept[kept.length - 1]!.text.trim() === "") kept.pop();
    return kept.length > 0 ? kept : null;
  }
  return null;
}

export interface FittedBar {
  left: Segment[][];
  center: Segment[][];
  right: Segment[][];
  /** Module ids shown, in bar order. */
  shown: ModuleId[];
  /** Module ids dropped to fit, lowest priority first. */
  dropped: ModuleId[];
}

/**
 * Renders every module of a bar and fits them into `width` columns (with `padding` at each end
 * and MODULE_GAP between modules and groups): the lowest priority goes first (later entries first
 * on ties), a module made of clean breaks (the hints) losing its last part before it is dropped
 * whole, and modules whose `neverDrop` holds are never dropped. What is still too wide is then
 * truncated, lowest priority first. This is the width policy every bar and the prompt box's
 * bottom border share (design D7).
 */
export function fitBar(bar: ResolvedBar, view: SessionView, width: number, padding = BAR_PADDING): FittedBar {
  let order = 0;
  let items: Rendered[] = [];
  for (const side of SIDES) {
    for (const module of bar[side]) {
      const def = MODULES[module.id];
      const segments = def.render(view, module);
      order++;
      if (!segments || segments.length === 0) continue;
      items.push({ module, side, order, segments, width: segmentsWidth(segments), pinned: def.neverDrop?.(view) ?? false });
    }
  }

  const dropped: ModuleId[] = [];
  while (items.length > 0 && totalWidth(items, padding) > width) {
    const candidates = items.filter((r) => !r.pinned);
    if (candidates.length === 0) break;
    // Keep the last module standing if it can be truncated to fit on its own.
    if (items.length === 1) break;
    const victim = candidates.reduce((a, b) =>
      b.module.priority < a.module.priority || (b.module.priority === a.module.priority && b.order > a.order) ? b : a,
    );
    const cut = cutAtLastBreak(victim.segments);
    if (cut) {
      victim.segments = cut;
      victim.width = segmentsWidth(cut);
      continue;
    }
    dropped.push(victim.module.id);
    items = items.filter((r) => r !== victim);
  }

  // Still too wide (pinned modules, or one module on its own): truncate, lowest priority first.
  let excess = totalWidth(items, padding) - width;
  if (excess > 0) {
    const byPriority = [...items].sort((a, b) => a.module.priority - b.module.priority || b.order - a.order);
    for (const r of byPriority) {
      if (excess <= 0) break;
      const target = Math.max(1, r.width - excess);
      r.segments = fitSegments(r.segments, target);
      const w = segmentsWidth(r.segments);
      excess -= r.width - w;
      r.width = w;
    }
  }

  const side = (name: Side) => items.filter((r) => r.side === name).map((r) => r.segments);
  return { left: side("left"), center: side("center"), right: side("right"), shown: items.map((r) => r.module.id), dropped };
}

export interface BarLayout {
  /** The whole row, spacing included; at most `width` columns. Empty when nothing shows. */
  segments: Segment[];
  /** Module ids shown, in bar order. */
  shown: ModuleId[];
  /** Module ids dropped to fit, lowest priority first. */
  dropped: ModuleId[];
}

function asRendered(groups: FittedBar): Rendered[] {
  const out: Rendered[] = [];
  for (const side of SIDES) {
    for (const segments of groups[side]) {
      out.push({ module: MODULE_PLACEHOLDER, side, order: out.length, segments, width: segmentsWidth(segments), pinned: false });
    }
  }
  return out;
}

const MODULE_PLACEHOLDER: ResolvedModule = { ...MODULES.text.defaults, id: "text" };

/**
 * Places fitted groups in a row of `width` columns: left from the start, center in the middle
 * when it does not collide with the sides, right against the end; gaps are `fill` characters.
 */
export function placeGroups(
  groups: FittedBar,
  width: number,
  padding: number,
  fillToken: Segment["token"],
  fill = " ",
  gapToken: Segment["token"] = fillToken,
): Segment[] {
  const items = asRendered(groups);
  if (items.length === 0) return [];
  const left = items.filter((r) => r.side === "left");
  const center = items.filter((r) => r.side === "center");
  const right = items.filter((r) => r.side === "right");
  const lw = groupWidth(left);
  const cw = groupWidth(center);
  const rw = groupWidth(right);
  const inner = Math.max(0, width - 2 * padding);
  const pad = (n: number): Segment[] => (n > 0 ? [{ text: fill.repeat(n), token: fillToken }] : []);

  const out: Segment[] = [...pad(padding), ...joinGroup(left, gapToken)];
  let x = lw;
  if (center.length > 0) {
    const minX = left.length > 0 ? lw + MODULE_GAP : 0;
    const maxX = inner - cw - (right.length > 0 ? rw + MODULE_GAP : 0);
    const ideal = Math.floor((inner - cw) / 2);
    const cx = Math.max(minX, Math.min(ideal, maxX));
    out.push(...pad(cx - x), ...joinGroup(center, gapToken));
    x = cx + cw;
  }
  if (right.length > 0) {
    const rx = Math.max(inner - rw, x + (x > 0 ? MODULE_GAP : 0));
    out.push(...pad(rx - x), ...joinGroup(right, gapToken));
    x = rx + rw;
  }
  out.push(...pad(Math.min(padding, width - x - padding)));
  return fitSegments(out, width);
}

/**
 * Composes one bar row: fits the modules (`fitBar`), then places the left, center and right
 * groups with spaces between them.
 */
export function layoutBar(bar: ResolvedBar, view: SessionView, width: number, spacerToken: Segment["token"] = "status.fg"): BarLayout {
  const fitted = fitBar(bar, view, width);
  return { segments: placeGroups(fitted, width, BAR_PADDING, spacerToken), shown: fitted.shown, dropped: fitted.dropped };
}

/** The bar row as plain text (tests and debugging). */
export function barText(layout: BarLayout): string {
  return layout.segments.map((s) => s.text).join("");
}
