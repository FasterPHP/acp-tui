// One component per conversation item (spec tui-conversation "Item
// presentation", design 6.2): the user card on `surface.user` with a one-cell
// bar, agent Markdown streamed in place behind the agent gutter, and the
// collapsible thought, tool call and plan (a one-line header, and an expanded
// card on `surface.card` below it: a tool call's or thought's from the rows of
// card.ts, mvp-rendering tasks 9.1 to 9.4), permission records, turn ends and
// error lines. Every row starts with a gutter, so agent text never reaches column 0
// (design section 8), and agent rows have no fill of their own. The item
// under the conversation cursor takes the faint `surface.cursor.faint` fill
// and a `▎` bar in `surface.cursor`'s colour beside every row (review C5), or,
// under the flat theme, its gutter in inverse video.
//
// Every colour is a theme token passed as an explicit `fg` (OpenTUI #1105, see
// docs/phase-0-notes/opentui.md).
import { StyledText, TextAttributes, type BoxRenderable, type MarkdownRenderable, type OptimizedBuffer, type SyntaxStyle, type TextRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack, type Accessor, type JSX } from "solid-js";
import type { Item, ToolCallItem } from "acp-model";
import { displayWidth, type Segment } from "../layout/segments.ts";
import { spanStyle, type ResolvedTheme, type TokenName } from "../theme/index.ts";
import { markerHere, markerSpans, setDrawnCard, setDrawnMarker, thoughtCardLayout, toolCardLayout, type CardLayout, type MarkerCells } from "./card.ts";
import { wrapLine, type CardLine } from "./content.ts";
import { permissionLine, planLine, planRows, thoughtLine, toolLine, toolTitleShown, turnEndLine } from "./format.ts";
import { SPINNER_FRAME_MS, type ConversationGlyphs } from "./glyphs.ts";
import { createRenderNode, drawCapabilities, rowsToChunks, type MarkdownHolder } from "./markdown/draw.ts";
import { createHighlightedRows } from "./markdown/highlight.ts";
import type { Row, Span } from "./markdown/types.ts";
import { cardPadding, terminalFlags } from "./markdown/context.ts";
import { MessageLayout } from "./markdown/layout.ts";
import { isPrimaryPress } from "../renderer/mouse.ts";
import type { ConversationViewModel } from "./view-model.ts";

/** A shared spinner clock: it ticks only while some running tool line holds it. */
export interface Spinner {
  readonly frame: Accessor<number>;
  /** Holds the clock until the returned function is called. */
  hold(): () => void;
}

export function createSpinner(intervalMs = SPINNER_FRAME_MS): Spinner {
  const [frame, setFrame] = createSignal(0);
  let holders = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    frame,
    hold() {
      holders += 1;
      if (timer === null) timer = setInterval(() => setFrame((f) => f + 1), intervalMs);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
}

export interface ItemContext {
  readonly theme: ResolvedTheme;
  readonly glyphs: ConversationGlyphs;
  readonly style: SyntaxStyle;
  readonly items: Readonly<Record<string, Item>>;
  readonly vm: ConversationViewModel;
  readonly spinner: Spinner;
  /** Columns the conversation's entries are laid out in: the region's width less its right
   *  margin and the scroll bar (window/WindowedConversation.tsx). */
  readonly width: Accessor<number>;
  /** Whether the item is under the cursor while the conversation has focus. */
  readonly selected: (id: string) => boolean;
  /** Called with each item's root box as it mounts (the scroll controller's geometry). */
  readonly register: (id: string, box: BoxRenderable | null) => void;
  /** Primary-button presses and releases (the conversation's click handling). */
  readonly mouse: {
    /** Pressed anywhere on an item (after a header's `pressHeader` for the same event). */
    pressItem(id: string, event: object): void;
    /** Pressed on a collapsible item's header line. */
    pressHeader(id: string, event: object): void;
    /** Released on a collapsible item's header line. */
    releaseHeader(id: string): void;
    /** Pressed on a tool card's snippet marker row (mvp-rendering "Output snippets"). */
    pressOutput?(id: string, event: object): void;
    /** Released on a tool card's snippet marker row. */
    releaseOutput?(id: string): void;
  };
  /** The key bound to `expandOutput`, named on a snippet's marker row (null or absent: none). */
  readonly outputKey?: () => string | null;
}

/** One line of styled segments; with `wrap`, word-wrapped within `width` columns. The width is
 *  given rather than left to the row's flex layout, which measures a growing text one column wider
 *  than the room it has, so its last column would reach the conversation's right margin. */
export function Segments(props: { segments: readonly Segment[]; theme: ResolvedTheme; wrap?: boolean; width?: number }): JSX.Element {
  return (
    <text wrapMode={props.wrap ? "word" : "none"} flexGrow={1} flexShrink={1} maxWidth={props.width} {...props.theme.text("text")}>
      {/* Spans take attribute flags, not an attributes mask (spanStyle, S1). */}
      <For each={props.segments}>{(s) => <span style={spanStyle(props.theme.text(s.token))}>{s.text}</span>}</For>
    </text>
  );
}

/** The gutter cell text; inverse video marks the cursor under the flat theme. */
function GutterText(props: { text: string; token: TokenName; selected: boolean; ctx: ItemContext }): JSX.Element {
  const style = () => {
    const base = props.ctx.theme.text(props.token);
    return props.selected && props.ctx.theme.flat ? { ...base, attributes: base.attributes | TextAttributes.INVERSE } : base;
  };
  return (
    <text width={props.ctx.glyphs.gutterWidth} height={1} flexShrink={0} {...style()}>
      {props.text}
    </text>
  );
}

/** The fill of an item's root box: `surface.cursor.faint` under the conversation cursor, else
 *  none (under the flat theme the cursor is its gutter in inverse video, and fills are off). */
export function cursorFill(selected: boolean, theme: ResolvedTheme) {
  return selected && !theme.flat ? theme.color("surface.cursor.faint") : undefined;
}

/**
 * The conversation cursor's bar (review C5, option C of docs/mvp-notes/rendering-choices.md; spec
 * tui-theme "Separate highlight surfaces"): the `cursorBar` glyph in `surface.cursor`'s colour on
 * the faint fill, in the first column of every row of the item box it is the last child of,
 * expanded card rows included (their card starts after the gutter). It is a zero-size box that
 * draws after its siblings, so the gutter text cannot cover it, and that takes no cell of the hit
 * grid, so a press in that column still reaches the row under it. Drawn with `drawText`, which
 * keeps to the scroll box's clip.
 */
export function CursorBar(props: { ctx: ItemContext }): JSX.Element {
  const { theme, glyphs } = props.ctx;
  function draw(this: BoxRenderable, buffer: OptimizedBuffer): void {
    const item = this.parent;
    if (!item) return;
    const fg = theme.color("surface.cursor");
    const bg = theme.color("surface.cursor.faint");
    for (let y = 0; y < item.height; y++) buffer.drawText(glyphs.cursorBar, item.screenX, item.screenY + y, fg, bg);
  }
  return <box position="absolute" left={0} top={0} width={0} height={0} renderAfter={draw} />;
}

/** A row box: the gutter on the first row, the body beside it on every row. With `clickId` it is
 *  a collapsible item's header line, which a click toggles. */
export function Gutter(props: { gutter: string; token: TokenName; selected: boolean; ctx: ItemContext; clickId?: string; children: JSX.Element }): JSX.Element {
  const id = props.clickId;
  const mouse = props.ctx.mouse;
  return (
    <box
      flexDirection="row"
      width="100%"
      flexShrink={0}
      onMouseDown={id === undefined ? undefined : (event) => void (isPrimaryPress(event) && mouse.pressHeader(id, event))}
      onMouseUp={id === undefined ? undefined : (event) => void (event.button === 0 && mouse.releaseHeader(id))}
    >
      <GutterText text={props.gutter} token={props.token} selected={props.selected} ctx={props.ctx} />
      {props.children}
    </box>
  );
}

interface CardSpan {
  text: string;
  token: TokenName;
  fill?: TokenName;
}

/** The card's left padding (`cards.padding.columns` spaces; under the flat theme, its rule and the
 *  spaces). */
function cardPrefix(ctx: ItemContext): string {
  const pad = " ".repeat(cardPadding().columns);
  return ctx.theme.flat ? `${ctx.glyphs.cardRule}${pad}` : pad;
}

/** Columns inside a card: the width less the gutter, the left padding (or the flat rule and the
 *  spaces) and the same padding on the right (window/heights.ts `estimateHeight` computes the
 *  same). */
function cardInner(ctx: ItemContext): number {
  return Math.max(1, ctx.width() - ctx.glyphs.gutterWidth - displayWidth(cardPrefix(ctx)) - cardPadding().columns);
}

/**
 * A plan's expanded card below its header: pre-wrapped rows in one text renderable, on the
 * `surface.card` fill, or behind a rule under the flat theme; lines are broken at the column.
 */
function Card(props: { lines: () => CardLine[]; ctx: ItemContext }): JSX.Element {
  const { theme, glyphs } = props.ctx;
  const prefix = () => cardPrefix(props.ctx);
  const spans = createMemo(() => {
    const out: CardSpan[] = [];
    const width = cardInner(props.ctx);
    const lines = props.lines();
    // The padding rows at the top and the bottom (`cards.padding.rows`): the left padding only.
    const padRows = cardPadding().rows;
    for (let k = 0; k < padRows; k++) out.push({ text: prefix(), token: "muted" }, { text: "\n", token: "text" });
    lines.forEach((line, i) => {
      const rows = line.segments.length === 0 ? [[]] : wrapLine(line.segments, width);
      rows.forEach((row, r) => {
        out.push({ text: prefix(), token: "muted" });
        for (const s of row) out.push({ text: s.text, token: s.token, fill: line.fill });
        if (i < lines.length - 1 || r < rows.length - 1) out.push({ text: "\n", token: "text" });
      });
    });
    for (let k = 0; k < padRows; k++) out.push({ text: "\n", token: "text" }, { text: prefix(), token: "muted" });
    return out;
  });
  const style = (s: CardSpan) => {
    const base = theme.text(s.token);
    return spanStyle(s.fill && !theme.flat ? { ...base, bg: theme.color(s.fill) } : base);
  };
  return (
    <box marginLeft={glyphs.gutterWidth} flexShrink={0} backgroundColor={theme.color("surface.card")}>
      <text wrapMode="none" flexShrink={0} {...theme.text("text")}>
        <For each={spans()}>{(s) => <span style={style(s)}>{s.text}</span>}</For>
      </text>
    </box>
  );
}

/**
 * An expanded tool card or thought below its header (mvp-rendering design decision 9; card.ts):
 * the layout's rows, each behind the card's left padding (or flat rule), drawn as one text
 * renderable of styled chunks (a 5000-line output stays one node) on the `surface.card` fill,
 * rows with a fill (diff lines, code blocks) filled to the card's edge. A snippet's marker row
 * names the hidden rows and the `expandOutput` key; a press and release on it shows the output
 * in full (`id`: tool calls).
 */
function LayoutCard(props: { layout: (inner: number) => CardLayout; id?: string; ctx: ItemContext }): JSX.Element {
  const { ctx } = props;
  const { theme, glyphs } = ctx;
  const layout = createMemo(() => props.layout(cardInner(ctx)));
  // Code blocks in the card coloured as their highlights arrive (no row count changes).
  const highlighted = createHighlightedRows(() => layout().rows);
  // Where the marker row's `here` is drawn (the hover mark, hover.tsx); only a tool card's is
  // clickable.
  let here: MarkerCells | null = null;
  const content = createMemo(() => {
    const l = layout();
    const drawn = highlighted();
    const inner = cardInner(ctx);
    const prefixText = cardPrefix(ctx);
    const prefix: Span = { text: prefixText, token: "muted", fill: "surface.card", projection: "" };
    const key = ctx.outputKey?.() ?? null;
    const marker = l.marker >= 0 ? [prefix, ...markerSpans(l.hidden, key, inner)] : null;
    here = marker && props.id !== undefined ? markerHere(marker, l.marker) : null;
    const rows: Row[] = drawn.map((row, i) => (i === l.marker && marker ? { spans: marker, decorative: true } : { ...row, spans: [prefix, ...row.spans] }));
    return new StyledText(rowsToChunks(rows, displayWidth(prefixText) + inner + cardPadding().columns, theme));
  });
  let box: BoxRenderable | undefined;
  let text: TextRenderable | undefined;
  // The styled rows are set on the renderable itself (a `content` prop would be taken for a text
  // child), and the selection's row maps read the layout it draws (card.ts `drawnCard`).
  createEffect(() => {
    const styled = content();
    if (!text) return;
    text.content = styled;
    setDrawnCard(text, layout());
    setDrawnMarker(text, here);
  });
  const onMarker = (event: { y: number }) => {
    const marker = layout().marker;
    return box !== undefined && marker >= 0 && event.y - box.y === marker;
  };
  const id = props.id;
  return (
    <box
      ref={(r: BoxRenderable) => (box = r)}
      marginLeft={glyphs.gutterWidth}
      flexShrink={0}
      backgroundColor={theme.color("surface.card")}
      onMouseDown={id === undefined ? undefined : (event) => void (isPrimaryPress(event) && onMarker(event) && ctx.mouse.pressOutput?.(id, event))}
      onMouseUp={id === undefined ? undefined : (event) => void (event.button === 0 && onMarker(event) && ctx.mouse.releaseOutput?.(id))}
    >
      <text
        ref={(r: TextRenderable) => {
          text = r;
          r.content = content();
          setDrawnCard(r, layout());
          setDrawnMarker(r, here);
        }}
        wrapMode="none"
        flexShrink={0}
        {...theme.text("text")}
      />
    </box>
  );
}

export function ItemView(props: { id: string; margin: number; ctx: ItemContext }): JSX.Element {
  const { ctx } = props;
  const { theme, glyphs } = ctx;
  const item = () => ctx.items[props.id]!;
  const as = <K extends Item["kind"]>(kind: K) => () => item() as Extract<Item, { kind: K }>;
  const selected = () => ctx.selected(props.id);
  const expanded = () => ctx.vm.expanded(item());
  const width = () => Math.max(1, ctx.width() - glyphs.gutterWidth);
  onCleanup(() => ctx.register(props.id, null));
  const meta = (token: TokenName, body: () => JSX.Element, clickable = false) => (
    <Gutter gutter={glyphs.gutter.meta} token={token} selected={selected()} ctx={ctx} clickId={clickable ? props.id : undefined}>
      {body()}
    </Gutter>
  );

  const content = (): JSX.Element => {
    switch (item().kind) {
      case "user_message": {
        const user = as("user_message");
        // The cell beside the bar: inverse video marks the cursor under the flat theme.
        const beside = () => {
          const base = theme.text("user");
          return selected() && theme.flat ? { ...base, attributes: base.attributes | TextAttributes.INVERSE } : base;
        };
        // Under the cursor (review C5, as the demo's option C draws a user card): the card takes the
        // faint fill and the column beside the bar the cursor's colour, as tall as the message,
        // so the card's own bar stays and the cursor widens it.
        const besideFill = () => (selected() && !theme.flat ? theme.color("surface.cursor") : undefined);
        return (
          <box flexDirection="row" width="100%" flexShrink={0} backgroundColor={theme.color(selected() ? "surface.cursor.faint" : "surface.user")}>
            {/* The bar: a one-cell column in the `user` colour (an ANSI colour, so it also
                marks the card under the flat theme), as tall as the message. */}
            <box width={1} flexShrink={0} backgroundColor={theme.color("user")} />
            <box width={cardPadding().columns} flexShrink={0} backgroundColor={besideFill()}>
              <text width={cardPadding().columns} height={1} marginTop={cardPadding().rows} flexShrink={0} {...beside()}>
                {" ".repeat(cardPadding().columns)}
              </text>
            </box>
            {/* Wrapped within the card less the bar and the padding on both sides (`cards.padding`;
                window/heights.ts estimates the same), so the text never reaches the card's last
                column or the conversation's right margin (Segments); the padding rows are the
                text's margins, with the bar and the fill beside them. */}
            <text
              wrapMode="word"
              flexGrow={1}
              flexShrink={1}
              marginTop={cardPadding().rows}
              marginBottom={cardPadding().rows}
              maxWidth={Math.max(1, ctx.width() - 1 - 2 * cardPadding().columns)}
              {...theme.text("text")}
            >
              {user().text.replace(/\n+$/, "")}
            </text>
          </box>
        );
      }
      case "agent_message": {
        const agent = as("agent_message");
        // Markdown from tokens (mvp-rendering design decision 1): the message is laid out at the
        // body width by acp-tui's own renderers (markdown/layout.ts), and OpenTUI's `<markdown>`
        // only lexes, reconciles blocks while streaming, and mounts what `renderNode` returns.
        const holder: MarkdownHolder = { current: null };
        const layout = createMemo(() => new MessageLayout(agent().text, width(), glyphs, terminalFlags(), agent().status !== "live"));
        const renderNode = createMemo(() => {
          // Rebuilt (and every block redrawn) when the width, the theme, the rendering settings
          // (`markdown.*`) or what the terminal draws (`terminals.<id>.strikethrough`) change;
          // `createRenderNode` reads the capabilities, so they are tracked too.
          width();
          theme.color("text");
          terminalFlags();
          return createRenderNode({ holder, layout, theme, capabilities: drawCapabilities() });
        });
        return (
          <Gutter gutter={glyphs.gutter.agent} token="agent" selected={selected()} ctx={ctx}>
            {/* `content` last: @opentui/solid sets props in JSX order, and a message that starts
                with a list parsed before the style and fg exist keeps raw white rows (OpenTUI
                #1105); `renderNode` must also be set before the content is parsed. The content
                is the pre-passed source (markdown/prepass.ts). */}
            <markdown
              ref={(r: MarkdownRenderable) => (holder.current = r)}
              syntaxStyle={ctx.style}
              fg={theme.color("text")}
              streaming={agent().status === "live"}
              internalBlockMode="top-level"
              renderNode={renderNode()}
              content={layout().prepared.source}
              flexGrow={1}
              flexShrink={1}
            />
          </Gutter>
        );
      }
      case "thought": {
        const thought = as("thought");
        return (
          <>
            {meta("thought", () => <Segments segments={thoughtLine(thought(), width(), glyphs)} theme={theme} />, true)}
            <Show when={expanded()}>
              <LayoutCard layout={(inner) => thoughtCardLayout(thought(), inner, glyphs)} ctx={ctx} />
            </Show>
          </>
        );
      }
      case "tool_call": {
        const tool = as("tool_call");
        const running = () => tool().status === "live" && (tool().toolStatus === "pending" || tool().toolStatus === "in_progress");
        // Holds the spinner clock while this tool runs, so only running lines redraw.
        const frame = createMemo(() => {
          if (!running()) return null;
          return ctx.spinner.frame();
        });
        createEffect(() => {
          if (running()) onCleanup(ctx.spinner.hold());
        });
        return (
          <>
            {meta("muted", () => <Segments segments={toolLine(tool(), width(), glyphs, frame() ?? 0)} theme={theme} />, true)}
            <Show when={expanded()}>
              <LayoutCard
                layout={(inner) => toolCardLayout(tool(), inner, ctx.vm.outputShown(props.id), glyphs, !toolTitleShown(tool(), width(), glyphs))}
                id={props.id}
                ctx={ctx}
              />
            </Show>
          </>
        );
      }
      case "permission_record": {
        const record = as("permission_record");
        const tool = () => {
          const t = ctx.items[`tool:${record().toolCallId}`];
          return t?.kind === "tool_call" ? (t as ToolCallItem) : null;
        };
        return meta("muted", () => <Segments segments={permissionLine(record(), tool(), width())} theme={theme} />);
      }
      case "plan": {
        const plan = as("plan");
        return (
          <>
            {meta("muted", () => <Segments segments={planLine(plan().entries)} theme={theme} />, true)}
            <Show when={expanded()}>
              <Card lines={() => planRows(plan().entries, glyphs).map((segments) => ({ segments }))} ctx={ctx} />
            </Show>
          </>
        );
      }
      case "marker": {
        // Markers arrive final and never change.
        const m = as("marker")();
        if (m.markerKind === "turn_end") return meta("muted", () => <Segments segments={turnEndLine(m, glyphs)} theme={theme} />);
        const token: TokenName = m.markerKind === "error" ? "danger" : "warning";
        const prefix = m.markerKind === "error" ? "error: " : "";
        return meta(token, () => <Segments segments={[{ text: prefix + m.text.replace(/\n+$/, ""), token }]} theme={theme} wrap width={width()} />);
      }
    }
  };

  // Built once, outside tracking: an item's kind never changes, and rebuilding on every update
  // would replace the Markdown renderable (and its pending highlighting) on each chunk.
  const body = untrack(content);
  return (
    <box
      id={`item:${props.id}`}
      ref={(r: BoxRenderable) => ctx.register(props.id, r)}
      onMouseDown={(event) => void (isPrimaryPress(event) && ctx.mouse.pressItem(props.id, event))}
      flexDirection="column"
      width="100%"
      flexShrink={0}
      marginTop={props.margin}
      backgroundColor={cursorFill(selected(), theme)}
    >
      {body}
      {/* A user card marks the cursor with the column beside its bar instead. */}
      <Show when={selected() && !theme.flat && item().kind !== "user_message"}>
        <CursorBar ctx={ctx} />
      </Show>
    </box>
  );
}
