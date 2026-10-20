// The docked permission card (spec tui-layout "Permission card", "Permission
// card focus and typing guard"; tui-agent-session "Permission requests";
// decision 12). Shown between the activity bar and the prompt box while a
// permission request is open, filled with `surface.permission` edge to edge,
// framed and marked in the warning colour (the frame and marker carry the
// card on their own under the flat theme).
//
// Focus: when the card appears, focus moves to it if the prompt box is empty;
// otherwise it flashes and focus stays in the prompt box until Tab. A card
// whose preview does not fit has two focus stops, the preview and then the
// answer row (mvp-chrome-and-keys design D6, Marcus 13.7); any other card only
// the answer row. Focus enters at the first stop, and Tab moves from the
// preview to the answer row and on to the prompt box (keys/controller.ts,
// `CardStops`). No option is drawn selected until the answer row has focus;
// when it takes focus its first option is selected. Keys (the `card` key
// context, scoped to this box, so none of them acts without focus): in the
// preview Up, Down, PgUp, PgDn, Home and End scroll it and Enter does nothing;
// in the answer row Left and Right (and Up and Down when the options are
// stacked) move the selection and Enter answers with it (decision 1 by Marcus
// before apply); a digit from either stop, or from the conversation (task
// 12.4: the digits are a layer of their own that acts while the card or the
// conversation has focus, never the prompt box), selects that option and
// moves focus to the answer row. Option keys are ignored for OPTION_GUARD_MS after the
// card appears, so typing ahead cannot answer. Esc returns focus to the prompt
// box.
//
// The preview (spec tui-layout "Permission card preview"): the card also shows
// what it approves, the tool call's content (`previewRows`), between the title
// and the options; Up, Down, PgUp, PgDn, Home and End scroll it while the card
// has focus, and Ctrl+O grows the card and back. The card is laid out last
// (mvp-chrome-and-keys design D6): at rest it takes what it needs while the
// conversation keeps 4 of the rows the other regions leave (`props.free`),
// grown every row but one, recomputed whenever another region changes height.
//
// Padding and spacing (day-one-feedback, Marcus 15 October 2026): the card
// keeps its content inside the cards' padding (`cards.padding`): columns
// between the frame and the content, and padding rows at the top and the
// bottom inside the frame while the screen's spacing keeps them
// (`BlockProps.spacing.cardPadding`). It tells the screen its claim (the
// frame, the title, the options and the preview's first rows, `cardClaim`),
// so the blank rows around it and its padding rows give way before its
// content in a short pane.
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, type JSX } from "solid-js";
import type { BoxRenderable } from "@opentui/core";
import type { BlockProps } from "../layout/Screen.tsx";
import { useKeys } from "../keys/context.ts";
import { CONTEXT_PRIORITY, registerContext, type ContextHandlers } from "../keys/register.ts";
import { isPrimaryPress } from "../renderer/mouse.ts";
import { useApp, useConfig } from "./context.ts";
import {
  cardClaim,
  cardInner,
  cardMaxRows,
  cardSpanStyle,
  cardLayout,
  cardModel,
  FLASH_STEP_MS,
  FLASH_TIMES,
  OPTION_GUARD_MS,
  optionAt,
  previewIsStop,
  previewRows,
  type CardSegment,
} from "./permission.ts";

export type PermissionCardProps = BlockProps;

export const PermissionCard = (props: PermissionCardProps): JSX.Element => {
  const { store, actions, theme } = useApp();
  const config = useConfig();
  const { keymap, keyMap, controller } = useKeys();
  const padding = () => config().cards.padding;
  let box: BoxRenderable | undefined;

  const record = () => {
    const id = store.session.openPermissionId;
    const item = id ? store.session.items[id] : undefined;
    return item?.kind === "permission_record" ? item : undefined;
  };
  const model = createMemo(() => {
    const r = record();
    if (!r) return null;
    const tool = store.session.items[`tool:${r.toolCallId}`];
    return cardModel(r, tool?.kind === "tool_call" ? tool : undefined);
  });

  const focused = () => store.ui.focus === "card" && model() !== null;
  const [selected, setSelected] = createSignal(0);
  // The focus stop within the card; the preview counts only while it does not fit (`stop()`).
  const [stopSignal, setStop] = createSignal<"preview" | "answer">("answer");
  // The preview's first row shown, and whether the card is grown.
  const [offset, setOffset] = createSignal(0);
  const [grown, setGrown] = createSignal(false);
  const [flash, setFlash] = createSignal(false);
  let flashTimer: ReturnType<typeof setInterval> | undefined;
  let appearedAt = 0;

  const stopFlash = () => {
    if (flashTimer) clearInterval(flashTimer);
    flashTimer = undefined;
    setFlash(false);
  };
  const startFlash = () => {
    stopFlash();
    let steps = FLASH_TIMES * 2;
    setFlash(true);
    flashTimer = setInterval(() => {
      steps -= 1;
      if (steps <= 0) stopFlash();
      else setFlash((f) => !f);
    }, FLASH_STEP_MS);
  };
  onCleanup(stopFlash);

  createEffect(
    on(
      () => store.session.openPermissionId,
      (id, previous) => {
        if (id && id !== previous) {
          appearedAt = Date.now();
          setSelected(0);
          setOffset(0);
          setGrown(false);
          // Focus enters at the first stop, if it enters now (the layout is not drawn yet, so the
          // preview's own rows decide; `stop()` falls back to the answer row if it then fits).
          setStop(preview().length > 0 ? "preview" : "answer");
          if (store.ui.promptEmpty) store.setFocus("card");
          else startFlash();
        } else if (!id) {
          stopFlash();
          if (store.ui.focus === "card") store.setFocus("prompt");
        }
      },
    ),
  );

  const preview = createMemo(() => {
    const r = record();
    if (!r) return [];
    const tool = store.session.items[`tool:${r.toolCallId}`];
    return previewRows(tool?.kind === "tool_call" ? tool : undefined, cardInner(props.width, padding().columns));
  });
  // What the card's content claims before spacing gives way (the screen's spacing reads it).
  createEffect(() => {
    const m = model();
    props.onClaim({ rows: m ? cardClaim(m, props.width, preview(), padding().columns) : 0, padding: padding().rows });
  });
  const layout = createMemo(() => {
    const m = model();
    if (!m) return null;
    // Whether the preview fits does not depend on which stop has focus, so the stop is read from
    // a first layout only through `stop()` below, never here.
    const base = {
      focused: focused(),
      flash: flash(),
      selected: selected(),
      maxRows: cardMaxRows(props.free, grown()),
      preview: { rows: preview(), offset: offset() },
      queued: store.session.turn?.openPermissionToolCallIds.length ?? 1,
      padding: { rows: props.spacing.cardPadding ? padding().rows : 0, columns: padding().columns },
    };
    const plain = cardLayout(m, props.width, base);
    const atPreview = focused() && previewIsStop(plain) && stopSignal() === "preview";
    return cardLayout(m, props.width, { ...base, answer: focused() && !atPreview, previewFocused: atPreview });
  });
  /** The stop with focus (or that focus would enter at): the preview only while it does not fit. */
  const stop = () => (stopSignal() === "preview" && previewIsStop(layout()) ? "preview" : "answer");
  const rows = () => layout()?.rows ?? [];
  // The screen adds the padding rows to what the card reports (`BlockProps.onHeight`).
  createEffect(() => props.onHeight(rows().length - 2 * (layout()?.paddingRows ?? 0)));

  // Typing ahead must not answer: every option key is swallowed for the first OPTION_GUARD_MS.
  const guarded = () => Date.now() - appearedAt < OPTION_GUARD_MS;
  const select = (index: number) => {
    const m = model();
    if (m && index >= 0 && index < m.options.length) setSelected(index);
  };
  /** The answer row takes focus with option `index` selected (its first, unless a digit chose). */
  const toAnswer = (index = 0) => {
    setStop("answer");
    setSelected(index);
  };
  // The focus cycle's view of the card's stops (keys/controller.ts).
  controller.setCardStops({
    enter: () => {
      if (previewIsStop(layout())) setStop("preview");
      else toAnswer();
    },
    advance: () => {
      if (stop() !== "preview") return false;
      toAnswer();
      return true;
    },
  });
  onCleanup(() => controller.setCardStops(null));

  const atAnswer = () => stop() === "answer";
  const handlers: ContextHandlers<"card"> = {
    back: () => controller.back(),
    // Inert in the preview, so the arrows there never touch the options.
    previous: () => void (atAnswer() && !guarded() && select(selected() - 1)),
    next: () => void (atAnswer() && !guarded() && select(selected() + 1)),
    // Enter in the preview does nothing, so a stray Enter never answers.
    confirm: () => {
      const option = model()?.options[selected()];
      if (atAnswer() && !guarded() && option) actions.answerPermission(option.optionId);
    },
  };
  // The digits are a layer of their own with no target (registered below), since they also act from
  // the conversation (task 12.4, Marcus, 11 October 2026): from either stop, or from the conversation
  // while the card is open, a digit selects that option and moves focus to the answer row. With any
  // other focus the key is not the card's, so in the prompt box it is typed into the draft (the
  // typing guard).
  const digits: ContextHandlers<"card"> = {};
  for (let n = 1; n <= 9; n++) {
    digits[`choose${n}` as keyof typeof digits] = () => {
      const focus = store.ui.focus;
      if (!model() || (focus !== "card" && focus !== "conversation")) return false;
      if (guarded()) return true;
      const index = model()?.options.findIndex((o) => o.number === n) ?? -1;
      if (index >= 0) {
        toAnswer(index);
        store.setFocus("card");
      }
      return true;
    };
  }

  // The preview's keys.
  {
    // The offset as shown (the layout clamps it). At the last row the stored offset is "the end",
    // so the preview stays at its end when Ctrl+O changes the card's height.
    const shown = () => layout()?.preview?.offset ?? 0;
    const scrollTo = (next: number) => {
      const window = layout()?.preview;
      if (!window) return false;
      const end = window.total - window.height;
      setOffset(next >= end ? Number.MAX_SAFE_INTEGER : Math.max(0, next));
      return true;
    };
    const page = () => Math.max(1, (layout()?.preview?.height ?? 1) - 1);
    // In the answer row Up and Down move the selection when the options are stacked, and the
    // other keys are not the card's (PgUp and PgDn page the conversation).
    const inPreview = (scroll: () => boolean) => () => (atAnswer() ? false : scroll());
    const stacked = (delta: number) => () => {
      if (!layout()?.stacked) return false;
      if (!guarded()) select(selected() + delta);
      return true;
    };
    handlers.scrollUp = () => (atAnswer() ? stacked(-1)() : scrollTo(shown() - 1));
    handlers.scrollDown = () => (atAnswer() ? stacked(1)() : scrollTo(shown() + 1));
    handlers.pageUp = inPreview(() => scrollTo(shown() - page()));
    handlers.pageDown = inPreview(() => scrollTo(shown() + page()));
    handlers.top = inPreview(() => scrollTo(0));
    handlers.bottom = inPreview(() => scrollTo(Number.MAX_SAFE_INTEGER));
    handlers.grow = () => void setGrown((g) => !g);
  }

  onMount(() => {
    if (!box) return;
    onCleanup(registerContext(keymap, keyMap, "card", handlers, { target: box }));
  });
  // Above the global layer, so the card's digits win over any global binding while they act.
  onCleanup(registerContext(keymap, keyMap, "card", digits, { priority: CONTEXT_PRIORITY }));

  // The selected option on `surface.permission.selected`, or in inverse video under the flat theme.
  const spanStyle = (s: CardSegment) => cardSpanStyle(theme, s);

  // The fill is set only while a request is open. The box stays mounted (the key context is
  // registered on it) and has no rows when idle, but OpenTUI still paints a zero-height box's
  // background as a row, which showed as a warm band on the prompt box's top border (S2, IDE
  // session A2).
  return (
    <box
      ref={(r: BoxRenderable) => (box = r)}
      focusable
      focused={focused()}
      flexDirection="column"
      width="100%"
      backgroundColor={model() ? theme.color("surface.permission") : undefined}
      onMouseDown={(event) => {
        if (!isPrimaryPress(event) || !model() || !box) return;
        // A click on an option gives the answer row focus with that option selected, as its digit
        // would, but answers nothing (task 12.5); elsewhere on the options' rows the answer row, and
        // elsewhere on the card its first stop.
        const answerRow = layout()?.answerRow ?? 0;
        const answerEnd = layout()?.answerEnd ?? 0;
        const option = optionAt(layout(), event.x - box.x, event.y - box.y);
        if (option !== null) toAnswer(option);
        else if (event.y - box.y >= answerRow && event.y - box.y < answerEnd) {
          if (!(store.ui.focus === "card" && atAnswer())) toAnswer();
        } else if (store.ui.focus !== "card") {
          if (previewIsStop(layout())) setStop("preview");
          else toAnswer();
        }
        store.setFocus("card");
      }}
    >
      <For each={rows()}>
        {(row) => (
          // Not selectable: OpenTUI starts its own text selection on a press on selectable text,
          // and a press here is the card's, never the conversation selection's (task 12.5), so no
          // selection starts on the card or paints it.
          <text selectable={false} wrapMode="none" height={1} {...theme.text("text")}>
            <For each={row}>{(s) => <span style={spanStyle(s)}>{s.text}</span>}</For>
          </text>
        )}
      </For>
    </box>
  );
};
