// The prompt box (spec tui-layout "Prompt box", tui-agent-session "Prompt
// turns"; design 6.4, D7). A rounded frame around a multiline input that
// rests at the row budget's height (`promptRows` from the screen: 3, 2 or 1
// text rows, mvp-chrome-and-keys design D1), grows with its content up to
// `floor(rows / 3)` rows, then scrolls inside the textarea, which keeps the
// cursor line in view.
// One blank padding row sits inside the frame below the text rows, above the bottom border
// with its pills (day-one-feedback; `PROMPT_PADDING_ROWS`, counted in the row budget), while the
// screen's spacing keeps it (`BlockProps.spacing.promptPadding`: in a short pane it gives way
// before content, spec tui-layout "Spacing gives way before content").
// The bottom border shows the agent's mode and model and the context used and
// size, fitted with the bars' width policy; the top border shows, left to
// right, the busy indicator (a segment sweeping over the border's line while a
// turn runs, standing still in the warning colour while it waits for the user;
// mvp-chrome-and-keys design D3), the newest notice in the middle, and the
// clickable `↓ N new` indicator while entries have been added below a reader
// who scrolled up (mvp-conversation). The frame is drawn in `accent` while the
// prompt box has focus.
//
// Bracketed paste is inserted as-is (newlines included, CR and CRLF read as
// newlines) and never submits; so is the clipboard's text read by `paste`
// (Ctrl+V and the palette, mvp-chrome-and-keys task 3.2). Every way into the
// box (paste, clipboard, palette commands, mentions) goes through one rule
// that removes escape sequences and drops control characters other than tab
// and newline (./prompt-input.ts; opentui-0-6 design D5). Enter submits through `actions.prompt`; while
// a turn is running, or while a session is being opened by load or resume
// (mvp-sessions task 5.5), the controller refuses, the text stays and a notice
// says so. Keys come from the key map's `prompt` context, registered on the
// textarea (focus-scoped, so it outranks the textarea's own bindings). An agent
// command chosen in the slash menu is inserted through the composer handle's
// `insertCommand`, its input hint drawn muted after it while the draft is
// exactly the command (mvp-chrome-and-keys task 6.4).
//
// day-two-feedback: the cursor's shape follows `prompt.cursor` and the terminal's focus reports
// (./prompt-cursor.ts), and the textarea's selection is drawn, selected by the `select*` actions,
// cut and copied through the selection layer's use of the composer handle (./prompt-selection.ts).
//
// `@` typed at the start of the draft or after whitespace opens the file
// picker above the box (mvp-chrome-and-keys task 6.6, src/overlay/FilePicker.tsx;
// never a pasted `@`); the text typed after it filters the list, and the
// picker's keys outrank the prompt context's while it is open. A chosen file
// becomes a mention, drawn in the accent colour and tracked as a range of the
// draft (task 6.7); on send each intact mention follows the text as a
// `resource_link` (./mention-draft.ts).
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { CliRenderEvents, decodePasteBytes, type BoxRenderable, type MouseEvent, type OptimizedBuffer, type PasteEvent, type TextareaRenderable, type TextRenderable } from "@opentui/core";
import { bottomBorder, busyTiming, newBelowSpan, pillAt, PROMPT_FRAME, topBorder, type BusyState } from "../layout/border.ts";
import type { PillCategory } from "../layout/view.ts";
import { PROMPT_FRAME_ROWS, type BlockComponent, type BlockProps } from "../layout/Screen.tsx";
import { displayWidth, truncateEnd, type Segment } from "../layout/segments.ts";
import { useKeys } from "../keys/context.ts";
import { actionLabel, commandName, type KeyAction } from "../keys/keymap.ts";
import { CONTEXT_PRIORITY, registerContext } from "../keys/register.ts";
import { LIVE_CHROME_GLYPHS } from "../conversation/live-glyphs.ts";
import { isPrimaryPress } from "../renderer/mouse.ts";
import { rendererWrite } from "../renderer/write-out.ts";
import { NO_CLIPBOARD_REASON, pasteNotice } from "../selection/clipboard.ts";
import { spanStyle, type TokenName } from "../theme/index.ts";
import { useApp, useConfig } from "./context.ts";
import { createMentionDraft } from "./mention-draft.ts";
import { createCursorFocus, cursorAtEnd, cursorShapeSequence, promptCursorStyle } from "./prompt-cursor.ts";
import { promptInput } from "./prompt-input.ts";
import { FLAT_SELECTION_MARK, paintFlatSelection } from "./prompt-selection.ts";
import { createPromptUndo } from "./prompt-undo.ts";

/** The notice for Enter while a session is being opened (spec tui-sessions "Submit during load"). */
export const HISTORY_LOADING_NOTICE = "the history is still loading; prompt kept";

/** The picker each pill opens (the palette's config pickers, `src/overlay/`). */
export const PILL_PICKERS: Record<PillCategory, KeyAction<"global">> = { mode: "pickMode", model: "pickModel", thought_level: "pickThoughtLevel" };

/** The input's maximum height in text rows: a third of the screen (at least one row). */
export function promptMaxRows(screenRows: number): number {
  return Math.max(1, Math.floor(screenRows / 3));
}

/** Pasted text as inserted: the prompt box's one input rule (./prompt-input.ts). */
export const normalisePaste = promptInput;

function Row(props: { segments: Segment[]; onMouseDown?: (event: MouseEvent, column: number) => void }) {
  const { theme } = useApp();
  let row: TextRenderable | undefined;
  return (
    <text
      ref={(r: TextRenderable) => (row = r)}
      onMouseDown={props.onMouseDown ? (event) => props.onMouseDown!(event, event.x - (row?.x ?? 0)) : undefined}
      wrapMode="none"
      height={1}
      flexShrink={0}
      {...theme.text("text")}
    >
      <For each={props.segments}>
        {(s) => <span style={s.fill && !theme.flat ? spanStyle({ ...theme.text(s.token), bg: theme.color(s.fill) }) : theme.text(s.token)}>{s.text}</span>}
      </For>
    </text>
  );
}

export const PromptBox: BlockComponent = (props: BlockProps) => {
  const { store, actions, theme, clipboard, logger, launch } = useApp();
  const config = useConfig();
  const { keymap, keyMap, controller } = useKeys();
  const renderer = useRenderer();
  let input: TextareaRenderable | undefined;

  const [lines, setLines] = createSignal(1);
  // An agent command from the slash menu and its input hint, shown muted after it as the
  // placeholder while the draft is exactly the command (tui-palette "Agent commands in the slash
  // menu").
  const [commandHint, setCommandHint] = createSignal<{ readonly text: string; readonly hint: string } | null>(null);
  // The cursor's shape (spec tui-layout "Prompt box cursor"): `prompt.cursor`, and for
  // `block_at_end` whether the cursor is after the end of the text.
  const [atEnd, setAtEnd] = createSignal(true);
  let syncedOffset = -1;
  const syncCursor = () => {
    if (!input || input.isDestroyed) return;
    syncedOffset = input.cursorOffset;
    setAtEnd(cursorAtEnd(input.plainText, syncedOffset));
  };
  // OpenTUI reports only the cursor moves it makes through the edit buffer (keys, edits). A mouse
  // click or drag moves it through the editor view's selection, an undo or a programmatic edit
  // after the content event, none of which raise `onCursorChange`: so each frame checks whether
  // the cursor is where the shape was last set for (task 12.1; spec tui-layout "Prompt box cursor").
  const onCursorFrame = () => {
    if (input && !input.isDestroyed && input.cursorOffset !== syncedOffset) syncCursor();
  };
  renderer.on(CliRenderEvents.FRAME, onCursorFrame);
  onCleanup(() => renderer.off(CliRenderEvents.FRAME, onCursorFrame));
  const cursorStyle = createMemo(() => promptCursorStyle(config().prompt.cursor, atEnd()));
  const measure = () => {
    if (!input) return;
    // `virtualLineCount` counts only the rows in the viewport; the total includes wrapped rows.
    setLines(Math.max(1, input.editorView.getTotalVirtualLineCount()));
    store.setPromptEmpty(input.plainText === "");
    syncCursor();
    if (commandHint() !== null && input.plainText !== commandHint()!.text) setCommandHint(null);
  };
  // At rest the row budget's height; a taller draft grows the box, taking rows from the
  // conversation (spec tui-layout "Margins and row budget").
  const inputRows = () => Math.max(props.promptRows, Math.min(lines(), promptMaxRows(props.rows)));
  // The frame's two borders; the screen adds the padding row while it is drawn (spec tui-layout
  // "Prompt box").
  createEffect(() => props.onHeight(inputRows() + PROMPT_FRAME_ROWS));

  const focused = () => store.ui.focus === "prompt";
  const frameToken = (): TokenName => (focused() ? "accent" : "muted");
  const notice = () => store.ui.notices.at(-1);
  // The busy indicator (design D3): one frame every `busyInterval()` while the turn runs, which
  // moves the segment the same distance each time (day-two-feedback design D4), standing still
  // while it waits for the user. The interval follows the width, `busy.track_percent`, `busy.style`
  // and the glyph set, and the timer restarts when it changes. Only this row reads the frame, so
  // only it redraws.
  const [busyFrame, setBusyFrame] = createSignal(0);
  const busyInterval = createMemo(() => Math.round(busyTiming(props.width, config().busy.track_percent, config().busy.style, LIVE_CHROME_GLYPHS.busy).interval));
  createEffect(() => {
    if (store.session.state !== "running") return;
    const timer = setInterval(() => setBusyFrame((f) => f + 1), busyInterval());
    onCleanup(() => clearInterval(timer));
  });
  const busy = (): BusyState | null =>
    store.session.state === "idle"
      ? null
      : { frame: busyFrame(), waiting: store.session.state === "requires_action", percent: config().busy.track_percent, style: config().busy.style };
  const top = createMemo(() => {
    const n = notice();
    return topBorder(n ? { text: n.text, token: n.token, ...(n.more ? { more: n.more } : {}), ...(n.short ? { short: n.short } : {}) } : null, props.width, frameToken(), store.ui.scroll.newBelow, busy());
  });
  // A click on the `↓ N new` indicator resumes following (it does not move focus).
  const topClick = (event: MouseEvent, column: number) => {
    const n = store.ui.scroll.newBelow;
    if (!isPrimaryPress(event) || n <= 0) return;
    const span = newBelowSpan(n, props.width);
    if (column < span.start || column >= span.end) return;
    event.stopPropagation();
    controller.conversation()?.toBottom();
  };
  const bottom = createMemo(() => bottomBorder(props.view, props.width, frameToken(), props.layout?.prompt));
  // A primary click on a pill opens its option's picker (spec tui-layout "Config option pills");
  // focus is not moved to the prompt box, so the picker hands it back to where it was.
  const bottomClick = (event: MouseEvent, column: number) => {
    const pill = isPrimaryPress(event) ? pillAt(bottom(), column) : null;
    if (pill === null) return;
    event.stopPropagation();
    keymap.runCommand(commandName("global", PILL_PICKERS[pill]));
  };
  const side = (text: string, rows = inputRows()) => <text width={2} height={rows} flexShrink={0} {...theme.text(frameToken())}>{Array(rows).fill(text).join("\n")}</text>;

  // File mentions (tasks 6.6 and 6.7, ./mention-draft.ts).
  // The draft's undo and redo, grouped into steps over the edit buffer's history (spec tui-keymap
  // "Undo and redo in the prompt box", ./prompt-undo.ts); afresh when a prompt is sent and when the
  // session changes.
  const undo = createPromptUndo({
    text: () => input?.plainText ?? "",
    undo: () => input?.undo() ?? false,
    redo: () => input?.redo() ?? false,
    canUndo: () => input?.editBuffer.canUndo() ?? false,
    canRedo: () => input?.editBuffer.canRedo() ?? false,
    clearHistory: () => input?.editBuffer.clearHistory(),
  });
  createEffect(on(() => store.ui.epoch, () => undo.reset(), { defer: true }));
  const mentions = createMentionDraft({
    input: () => input,
    cwd: () => store.session.cwd ?? process.cwd(),
    focused,
    theme,
    atomic: undo.atomic,
    ...(logger ? { logger } : {}),
  });
  // The prompt box's first screen row, above which the picker is drawn, and its last (the bottom
  // border), on which the palette's overlay stands (task 12.7).
  let frame: BoxRenderable | undefined;
  const [frameTop, setFrameTop] = createSignal(0);
  const [frameRows, setFrameRows] = createSignal<{ readonly top: number; readonly bottom: number } | null>(null);
  const onLayout = () => {
    if (!frame || frame.isDestroyed) return;
    if (frame.y !== frameTop()) setFrameTop(frame.y);
    const rows = frameRows();
    const bottom = frame.y + frame.height - 1;
    if (frame.height > 0 && (rows?.top !== frame.y || rows.bottom !== bottom)) setFrameRows({ top: frame.y, bottom });
  };
  renderer.root.on("layout-changed", onLayout);
  onCleanup(() => renderer.root.off("layout-changed", onLayout));

  // The focused window can be told apart (spec tui-layout): where the terminal reports focus, the
  // terminal's default shape (which it draws hollow) while another window has it.
  const cursorFocus = createCursorFocus({ write: rendererWrite(renderer, logger), shape: () => cursorShapeSequence(cursorStyle()), promptFocused: focused });
  const onTerminalBlur = () => cursorFocus.blur();
  const onTerminalFocus = () => cursorFocus.focus();
  renderer.on("blur", onTerminalBlur);
  renderer.on("focus", onTerminalFocus);
  onCleanup(() => {
    renderer.off("blur", onTerminalBlur);
    renderer.off("focus", onTerminalFocus);
  });
  createEffect(on(focused, () => cursorFocus.promptFocusChanged(), { defer: true }));

  // Read at the key, so a key map reloaded from the configuration is named (spec tui-keymap "Key
  // overrides from the configuration").
  const escLabel = () => actionLabel(keyMap, "global", "escape");
  const submit = () => {
    if (!input) return true;
    const text = input.plainText;
    if (text.trim() === "") return true;
    // Exactly one of acp-tui's slash commands (`/exit`, `/model`, ...), which the agent does not
    // advertise, runs instead of being sent (tui-palette "Typed acp-tui commands").
    if (controller.runSlash(text)) {
      input.clear();
      undo.reset();
      return true;
    }
    const result = actions.prompt(text, mentions.links(text));
    if (result === null || (!result.accepted && result.reason === "no_session")) controller.notify(`${launch?.().harness ?? "the harness"} is still starting`, "muted");
    else if (result.accepted) {
      input.clear();
      // A sent prompt is not undone: the history starts afresh (the prompt history's Up recalls it).
      undo.reset();
      // Sending reads as a return to the live end: the new message and the reply stay in view.
      controller.conversation()?.toBottom();
    }
    // The text stays in the box (spec tui-sessions "Input while history loads").
    else if (result.reason === "opening") controller.notify(HISTORY_LOADING_NOTICE, "muted");
    else {
      const esc = escLabel();
      controller.notify(esc ? `a turn is running: ${esc} twice to cancel it` : "a turn is running");
    }
    return true;
  };

  // Ctrl+V and the palette's paste (design D11): the clipboard's text, read through the host
  // backend, arrives as a paste event, so it is inserted exactly as a bracketed paste is (and
  // anything that treats pasted text as text sees it so); an image or no clipboard is a notice.
  const paste = async (): Promise<void> => {
    const read = clipboard ? await clipboard.read("ctrl+v") : ({ kind: "none", reason: NO_CLIPBOARD_REASON } as const);
    if (!input || input.isDestroyed) return;
    if (read.kind !== "text") return controller.notify(pasteNotice(read), read.kind === "image" ? "muted" : "warning");
    const bytes = new TextEncoder().encode(read.text);
    if (store.ui.focus === "prompt") renderer.keyInput.processPaste(bytes);
    else undo.atomic(() => input?.insertText(normalisePaste(read.text)));
  };

  const clearSelection = (): void => {
    if (input && !input.isDestroyed && input.hasSelection()) input.clearSelection();
  };
  const emptyDraft = () => (input?.plainText ?? "") === "";
  const jump = (to: "first" | "last"): boolean => {
    const conversation = controller.conversation();
    if (!conversation) return false;
    conversation[to]();
    return true;
  };

  onMount(() => {
    if (!input) return;
    const remove = registerContext(
      keymap,
      keyMap,
      "prompt",
      {
        submit,
        newline: () => void input?.newLine(),
        lineUp: () => void input?.moveCursorUp(),
        lineDown: () => void input?.moveCursorDown(),
        // Home and End from an empty prompt box move the conversation (PgUp and PgDn do from any
        // draft); with text in the box they stay the textarea's line start and end. A selection is
        // cleared first, so that one press moves as it does in an editor: OpenTUI's own Home and
        // End would only collapse the selection to its edge and need a second press (task 12.2).
        first: () => (clearSelection(), emptyDraft() && jump("first")),
        last: () => (clearSelection(), emptyDraft() && jump("last")),
        paste: () => void paste(),
        // The prompt box's selection keys (tui-keymap "Prompt box selection keys"): the textarea's
        // own selecting moves, as data. Cut is the selection layer's, which owns the clipboard.
        selectLeft: () => void input?.moveCursorLeft({ select: true }),
        selectRight: () => void input?.moveCursorRight({ select: true }),
        selectUp: () => void input?.moveCursorUp({ select: true }),
        selectDown: () => void input?.moveCursorDown({ select: true }),
        selectHome: () => void input?.gotoBufferHome({ select: true }),
        selectEnd: () => void input?.gotoBufferEnd({ select: true }),
        selectWordLeft: () => void input?.moveWordBackward({ select: true }),
        selectWordRight: () => void input?.moveWordForward({ select: true }),
        // Ctrl+A (task 13.3): the whole draft, only while the prompt box has focus; Home is the line start.
        selectAll: () => (store.ui.focus !== "prompt" ? false : (input?.selectAll(), true)),
        // Undo and redo (tui-keymap "Undo and redo in the prompt box"): always consumed, so Ctrl+Z
        // is never anything else (acp-tui runs in raw mode and never suspends).
        undo: () => (undo.undo(), true),
        redo: () => (undo.redo(), true),
      },
      { target: input },
    );
    // The file picker's keys, above the prompt context's while it is open.
    const removePicker = registerContext(keymap, keyMap, "overlay", mentions.picker.handlers, { target: input, priority: CONTEXT_PRIORITY + 1 });
    onCleanup(removePicker);
    controller.setComposer({
      clear: () => input?.clear(),
      empty: () => (input?.plainText ?? "") === "",
      insertCommand: (text, hint) => {
        if (!input) return;
        const empty = input.plainText === "";
        const inserted = promptInput(text);
        undo.atomic(() => input?.insertText(inserted));
        if (hint && empty) setCommandHint({ text: inserted, hint });
      },
      frame: frameRows,
      hasSelection: () => input !== undefined && !input.isDestroyed && input.hasSelection(),
      selectedText: () => (input !== undefined && !input.isDestroyed && input.hasSelection() ? input.getSelectedText() : ""),
      clearSelection: () => input !== undefined && !input.isDestroyed && input.clearSelection(),
      cutSelection: () => {
        if (!input || input.isDestroyed || !input.hasSelection()) return "";
        const text = input.getSelectedText();
        undo.atomic(() => input?.deleteSelection());
        return text;
      },
    });
    // Under the flat theme the selection is a marked colour that becomes inverse video here (see
    // ./prompt-selection.ts); with fills the textarea draws `surface.selection` itself.
    const paintSelection = (buffer: OptimizedBuffer) => {
      if (!theme.flat || !input || input.isDestroyed || !input.hasSelection()) return;
      paintFlatSelection(buffer, { x: Math.trunc(input.x), y: Math.trunc(input.y), width: input.width, height: input.height });
    };
    renderer.addPostProcessFn(paintSelection);
    onCleanup(() => {
      renderer.removePostProcessFn(paintSelection);
      remove();
      controller.setComposer(null);
    });
    // A focused textarea sets the terminal cursor colour (OSC 12) as RGB. Use the terminal's own
    // cursor colour when it reports one, so the cursor looks as it did before acp-tui started.
    renderer
      .getPalette({ timeout: 500 })
      .then((palette) => {
        const cursor = palette.cursorColor;
        if (input && !input.isDestroyed && cursor && /^#[0-9a-f]{6}$/i.test(cursor)) input.cursorColor = cursor;
      })
      .catch(() => {});
  });

  const onPaste = (event: PasteEvent) => {
    event.preventDefault();
    undo.atomic(() => input?.insertText(normalisePaste(decodePasteBytes(event.bytes))));
  };

  return (
    <box
      ref={(r: BoxRenderable) => (frame = r)}
      flexDirection="column"
      width="100%"
      onMouseDown={(event) => {
        if (!isPrimaryPress(event)) return;
        store.setFocus("prompt");
        // A click may move the cursor: the run of typing ends.
        undo.boundary();
      }}
    >
      <mentions.picker.View top={frameTop()} />
      <Row segments={top()} onMouseDown={topClick} />
      <box flexDirection="row" height={inputRows()} flexShrink={0}>
        {side(`${PROMPT_FRAME.vertical} `)}
        <textarea
          ref={(r: TextareaRenderable) => (input = r)}
          focused={focused()}
          // Exactly the columns between the frame's sides. With the default `auto` basis Yoga
          // takes the textarea's measured content width (and its explicit height makes OpenTUI
          // set flexShrink 0), so a wrapped draft made it wider than that space: it drew over
          // the right side and wrapped beyond the visible columns, hiding a character at each
          // wrap point (S7).
          flexBasis={0}
          flexGrow={1}
          flexShrink={1}
          height={inputRows()}
          wrapMode="word"
          onContentChange={() => {
            undo.sync();
            measure();
            mentions.contentChanged();
          }}
          cursorStyle={cursorStyle()}
          onCursorChange={() => {
            syncCursor();
            mentions.cursorChanged();
          }}
          onKeyDown={(key) => {
            // Before the textarea handles it: what the keys before it did is one edit by now.
            undo.keyDown(key);
            mentions.keyDown(key);
          }}
          syntaxStyle={mentions.syntaxStyle}
          onSizeChange={measure}
          onPaste={onPaste}
          selectionBg={theme.flat ? FLAT_SELECTION_MARK : theme.color("surface.selection")}
          textColor={theme.color("text")}
          focusedTextColor={theme.color("text")}
          placeholderColor={theme.color("muted")}
          cursorColor={theme.color("text")}
        />
        {side(` ${PROMPT_FRAME.vertical}`)}
        <Show when={commandHint()} keyed>
          {(h: { readonly text: string; readonly hint: string }) => {
            const at = displayWidth(h.text);
            const room = () => props.width - 4 - at;
            return (
              <Show when={room() > 1}>
                <text position="absolute" left={2 + at} top={0} zIndex={1} height={1} wrapMode="none" {...theme.text("muted")}>
                  {truncateEnd(h.hint, room())}
                </text>
              </Show>
            );
          }}
        </Show>
      </box>
      {/* The padding row (day-one-feedback, Marcus 14 October 2026): the frame's sides around a blank row, so the
          text does not sit directly on the pills; given way in a short pane (`spacing.promptPadding`). */}
      <Show when={props.spacing.promptPadding}>
        <box flexDirection="row" height={1} flexShrink={0}>
          {side(`${PROMPT_FRAME.vertical} `, 1)}
          <box flexBasis={0} flexGrow={1} flexShrink={1} height={1} />
          {side(` ${PROMPT_FRAME.vertical}`, 1)}
        </box>
      </Show>
      <Row segments={bottom()} onMouseDown={bottomClick} />
    </box>
  );
};
