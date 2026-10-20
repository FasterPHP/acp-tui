// The screen: renders a resolved layout as one full-height column (design D7).
// The top and bottom margins and the spacers are blank rows that never give
// way (mvp-chrome-and-keys design D1). Bars are composed from module segments
// and take one row while they show anything; the `activity`, `card`, `prompt`
// and `find` blocks are Solid components that report how many rows they need
// (0 hides them); the `conversation` block takes every row the other regions
// leave. The prompt box's resting height comes from the row budget
// (`restingBudget`): the rows the margins, spacers, bars, its own frame and
// padding row and the blank row above it leave above the conversation's floor
// (`layout.conversation_min_rows`; the blank row gives way where even one text
// row cannot keep the floor with it), or 1 while a docked card is open and the
// prompt box is empty.
//
// Spacing (day-one-feedback, Marcus 15 October 2026; spec tui-layout "Spacing
// gives way before content"): the screen owns the decorative rows around and
// inside the conversation's neighbours. It draws a blank row above the
// activity bar, above and below the docked card, and above the prompt box
// while the conversation sits directly on it; the card's padding rows and the
// prompt box's padding row are drawn by those blocks as `BlockProps.spacing`
// says, and the screen adds them to the rows the blocks report. When the rows
// run short, they give way in `SPACING_ORDER` before the card's content (its
// claim, `BlockProps.onClaim`) is cut or the conversation goes below its keep.
import { Dynamic, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { createStore } from "solid-js/store";
import type { ResolvedTheme } from "../theme/index.ts";
import {
  layoutBar,
  restingBudget,
  spacing,
  type BlockName,
  type ResolvedBar,
  type ResolvedLayout,
  type ResolvedRegion,
  type Spacing,
} from "./layout.ts";
import type { SessionView } from "./view.ts";

export interface BlockProps {
  view: SessionView;
  /** The layout in use: the prompt box reads its bottom border's pills and modules from it, the
   *  conversation whether it has its scroll bar. */
  layout: ResolvedLayout;
  theme: ResolvedTheme;
  /** Screen width in columns. */
  width: number;
  /** Screen height in rows (the prompt box grows to a third of it). */
  rows: number;
  /**
   * The rows every other region leaves this block: the screen's height less the margins, the
   * spacers, the current height and spacing of each other region except the conversation, which
   * takes what is left, and this block's own spacing (so this block's reported rows plus the
   * conversation). Follows the other regions as they change height (the docked card computes its
   * resting and grown heights from it, mvp-chrome-and-keys design D6).
   */
  free: number;
  /** The prompt box's resting height in text rows (spec tui-layout "Margins and row budget");
   *  other blocks ignore it. */
  promptRows: number;
  /** The decorative rows drawn now (day-one-feedback): the prompt box draws its padding row while
   *  `promptPadding`, the docked card its padding rows while `cardPadding`; the screen draws the
   *  others. */
  spacing: Spacing;
  /** Report the rows this block needs now, without the padding rows `spacing` grants it (the
   *  screen adds those); 0 hides it. Call again whenever it changes. The `conversation` block need
   *  not call it: it takes the rows left over. */
  onHeight: (rows: number) => void;
  /** The docked card's claim (spec tui-layout "Spacing gives way before content"): the rows its
   *  content needs before any decorative row gives way, its frame included, and its padding rows
   *  at the top and at the bottom; `{ rows: 0 }` while no card is docked. Other blocks ignore it. */
  onClaim: (claim: BlockClaim) => void;
}

/** What the docked card claims (`BlockProps.onClaim`). */
export interface BlockClaim {
  readonly rows: number;
  readonly padding: number;
}

export type BlockComponent = (props: BlockProps) => JSX.Element;

export interface ScreenProps {
  layout: ResolvedLayout;
  view: SessionView;
  theme: ResolvedTheme;
  /** One component per block name. */
  blocks: Record<BlockName, BlockComponent>;
}

/** The prompt box's frame: its top and bottom borders. */
export const PROMPT_FRAME_ROWS = 2;
/** The blank padding row inside the prompt box's frame, below the text (day-one-feedback, Marcus
 *  14 October 2026); drawn while `Spacing.promptPadding`. */
export const PROMPT_PADDING_ROWS = 1;

/** The activity bar's line, which takes its row for the whole session (day-two-feedback task 13.2,
 *  Marcus 17 October 2026), blank until a tool call has run; its blank row above is spacing. */
export const ACTIVITY_LINE_ROWS = 1;

/** One bar row on the `status.bg` surface; takes no row while no module shows anything. */
export function Bar(props: { bar: ResolvedBar; view: SessionView; theme: ResolvedTheme; width: number; onHeight?: (rows: number) => void }) {
  const row = createMemo(() => layoutBar(props.bar, props.view, props.width));
  createEffect(() => props.onHeight?.(row().segments.length > 0 ? 1 : 0));
  return (
    <Show when={row().segments.length > 0}>
      <box height={1} flexShrink={0} backgroundColor={props.theme.color("status.bg")}>
        <text wrapMode="none" {...props.theme.text("status.fg")}>
          <For each={row().segments}>{(s) => <span style={props.theme.text(s.token)}>{s.text}</span>}</For>
        </text>
      </box>
    </Show>
  );
}

/** A key per region object: blocks are shared objects (layout.ts), so a block keeps its key, and
 *  its reported height, across layouts; a bar or spacer of a new layout gets a new key. */
const regionKeys = new WeakMap<ResolvedRegion, string>();
let nextRegionKey = 0;
function regionKey(region: ResolvedRegion): string {
  let key = regionKeys.get(region);
  if (key === undefined) {
    key = region.kind === "block" ? region.name : `r${++nextRegionKey}`;
    regionKeys.set(region, key);
  }
  return key;
}

export function Screen(props: ScreenProps) {
  const dims = useTerminalDimensions();
  // Reported heights by region key. A new layout (a configuration reload) keeps the block
  // components that are still in it mounted, with their heights, and mounts its bars afresh, which
  // report their own; keys of regions no longer shown are never read.
  const [heights, setHeights] = createStore<Record<string, number>>({});
  const heightOf = (region: ResolvedRegion): number | undefined => heights[regionKey(region)];
  const [claim, setClaim] = createSignal<BlockClaim>({ rows: 0, padding: 0 }, { equals: (a, b) => a.rows === b.rows && a.padding === b.padding });
  const blockOf = (name: BlockName) => props.layout.regions.find((region) => region.kind === "block" && region.name === name);
  const shown = (region: ResolvedRegion): boolean => (region.kind === "spacer" ? region.rows > 0 : region.kind === "block" && region.name === "conversation" ? true : (heightOf(region) ?? 0) > 0);

  /** Whether the conversation is the region directly above the prompt box: `atRest` reads the
   *  layout as it rests (no activity bar, card or find bar), otherwise the regions shown now. */
  const conversationOnPrompt = (atRest: boolean): boolean => {
    const regions = props.layout.regions;
    const at = regions.findIndex((region) => region.kind === "block" && region.name === "prompt");
    for (let j = at - 1; j >= 0; j--) {
      const region = regions[j]!;
      if (region.kind === "block" && region.name === "conversation") return true;
      const empty = atRest
        ? region.kind === "block" && (region.name === "activity" || region.name === "card" || region.name === "find")
        : !shown(region);
      if (!empty) return false;
    }
    return false;
  };

  // The rows every region but the conversation and the prompt box's text takes at rest: margins,
  // spacers, bars (one row until a bar reports that it shows nothing), and the prompt box's frame
  // and padding row.
  const chromeRows = createMemo(() => {
    let rows = props.layout.margins.top + props.layout.margins.bottom + PROMPT_FRAME_ROWS + PROMPT_PADDING_ROWS;
    props.layout.regions.forEach((region) => {
      if (region.kind === "spacer") rows += region.rows;
      else if (region.kind === "bar") rows += heightOf(region) ?? 1;
      else if (region.name === "activity") rows += ACTIVITY_LINE_ROWS;
    });
    return rows;
  });
  // The resting budget: the prompt box's text rows, and whether the blank row above it fits with
  // the conversation's floor (`restingBudget`).
  const budget = createMemo(() => restingBudget(dims().height, chromeRows(), props.layout.conversationMinRows, conversationOnPrompt(true)));
  const cardOpen = () => props.layout.regions.some((region) => region.kind === "block" && region.name === "card" && (heightOf(region) ?? 0) > 0);
  const promptRows = createMemo(() => (cardOpen() && props.view.ui.promptEmpty ? 1 : budget().rows));

  // The decorative rows drawn now (spec tui-layout "Spacing gives way before content").
  const spaced = createMemo((): Spacing => {
    let rows = dims().height - props.layout.margins.top - props.layout.margins.bottom;
    let activity = false;
    let prompt = 0;
    for (const region of props.layout.regions) {
      if (region.kind === "spacer") rows -= region.rows;
      else if (region.kind === "bar") rows -= heightOf(region) ?? 0;
      else if (region.name === "activity") activity = (heightOf(region) ?? 0) > 0;
      else if (region.name === "prompt") prompt = heightOf(region) ?? 0;
      else if (region.name !== "conversation" && region.name !== "card") rows -= heightOf(region) ?? 0;
    }
    const card = blockOf("card") ? claim() : { rows: 0, padding: 0 };
    // The activity bar's blank row replaces the idle blank row above the prompt box (task 13.2): it
    // is drawn where the row budget grants that row (the conversation keeps its floor with it), so
    // that it does not come and go with the tool calls, and also whenever a card is docked.
    return spacing({
      rows,
      activity,
      activityGap: budget().idleGap || card.rows > 0,
      card: card.rows,
      cardPadding: card.padding,
      prompt,
      idle: budget().idleGap && conversationOnPrompt(false),
    });
  });
  /** A region's rows besides those it reports: blank rows above and below it, and its padding. */
  const gapAbove = (region: ResolvedRegion): number => {
    if (region.kind !== "block") return 0;
    const s = spaced();
    if (region.name === "activity") return s.activityGap ? 1 : 0;
    if (region.name === "card") return s.cardAbove ? 1 : 0;
    if (region.name === "prompt") return s.idleGap ? 1 : 0;
    return 0;
  };
  const gapBelow = (region: ResolvedRegion): number => (region.kind === "block" && region.name === "card" && spaced().cardBelow ? 1 : 0);
  const padding = (region: ResolvedRegion): number => {
    if (region.kind !== "block") return 0;
    if (region.name === "prompt") return spaced().promptPadding ? PROMPT_PADDING_ROWS : 0;
    if (region.name === "card") return spaced().cardPadding ? 2 * claim().padding : 0;
    return 0;
  };
  const extra = (region: ResolvedRegion): number => gapAbove(region) + gapBelow(region) + padding(region);

  /** The rows the margins, the spacers and the regions other than `index` and the conversation
   *  leave, less the region's own spacing (`BlockProps.free`). */
  const freeFor = (index: number): number => {
    let used = props.layout.margins.top + props.layout.margins.bottom;
    props.layout.regions.forEach((region, j) => {
      if (region.kind === "block" && region.name === "conversation") return;
      if (j === index) used += extra(region);
      else used += region.kind === "spacer" ? region.rows : (heightOf(region) ?? 0) + extra(region);
    });
    return Math.max(0, dims().height - used);
  };

  const blank = (rows: number) => <box height={rows} flexShrink={0} />;
  return (
    <box flexDirection="column" width="100%" height="100%">
      {blank(props.layout.margins.top)}
      <For each={props.layout.regions}>
        {(region, i) => {
          const report = (rows: number) => setHeights(regionKey(region), rows);
          // A region object never changes kind. Blocks are shared objects (layout.ts), so a new layout
          // keeps them mounted (the conversation keeps its reading position); bars are remounted.
          if (region.kind === "spacer") return blank(region.rows);
          if (region.kind === "bar") {
            return <Bar bar={region} view={props.view} theme={props.theme} width={dims().width} onHeight={report} />;
          }
          const block = (
            <Dynamic
              component={props.blocks[region.name]}
              view={props.view}
              layout={props.layout}
              theme={props.theme}
              width={dims().width}
              rows={dims().height}
              free={freeFor(i())}
              promptRows={promptRows()}
              spacing={spaced()}
              onHeight={report}
              onClaim={region.name === "card" ? setClaim : () => {}}
            />
          );
          if (region.name === "conversation") {
            return (
              <box flexGrow={1} flexShrink={1} minHeight={0} flexDirection="column">
                {block}
              </box>
            );
          }
          // The blank rows are mounted only while drawn: OpenTUI gives even a zero-height box a row
          // of the mouse hit grid, which took the clicks on the prompt box's top border.
          return (
            <box height={(heightOf(region) ?? 0) + extra(region)} flexShrink={0} flexDirection="column">
              <Show when={gapAbove(region) > 0}>{blank(1)}</Show>
              <box height={(heightOf(region) ?? 0) + padding(region)} flexShrink={0} overflow="hidden" flexDirection="column">
                {block}
              </box>
              <Show when={gapBelow(region) > 0}>{blank(1)}</Show>
            </box>
          );
        }}
      </For>
      {blank(props.layout.margins.bottom)}
    </box>
  );
}
