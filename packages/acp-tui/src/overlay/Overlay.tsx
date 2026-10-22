// The command palette, the slash menu, the config option pickers and key help
// as one overlay (spec tui-palette; design 6.4 "Overlays: palette, pickers";
// mvp-chrome-and-keys D4 and D8; decision 16, parity 7.2), mounted always from
// app/run.tsx through `createPalette`.
//
// What the overlay shows is a list source (`ListSource`): its title, its items
// (reactive: the agent's commands and options update an open list), whether
// it has a filter field, and what choosing an entry does. The palette lists
// the key map's command catalogue (`commandCatalogue`, grouped by context, with
// key labels and current values; src/overlay/palette.ts), and the slash menu
// the agent's own commands (`agentItems`); the palette's `Choose the model`
// (and mode, thinking level) entries, the `pickModel`, `pickMode` and
// `pickThoughtLevel` actions (the prompt box's pills) open a picker over that config option, searchable above five
// choices, which applies the choice with `session/set_config_option` (the full
// list the agent returns replaces the session's, `config_options_replaced`) or,
// for legacy modes, `session/set_mode`. Key help (`keyHelp`, F1, and a palette
// entry) lists every binding (src/overlay/help.ts); `Configuration problems`
// (`configProblems`, a palette entry with no default key; mvp-configuration
// task 8.4) lists the configuration's problems (src/overlay/problems.ts), one
// row each, with the selected one in full under the list. The overlay takes the
// prompt box's place (Marcus, 11 October 2026; task 12.7): its bottom edge is
// on the prompt box's bottom border row and it is at least as tall as the box,
// which it covers while open and which returns as it was (draft and cursor)
// when it closes; at most `rows - 4` tall. It is drawn on the terminal's own
// background inside the prompt box's frame, in the accent colour, with its key
// hints muted in the bottom border (no fill, no dimmed backdrop, design 6.4);
// an entry with no key shows its route in the key column (`paletteRoutes`), and
// a blank row comes before every group header but the first. Keys (the
// `overlay` context, on the overlay's focus box): Up, Down, PgUp, PgDn, Home,
// End, Enter, Esc, Ctrl+U; other printable keys type into the filter,
// Backspace deletes. Choosing a command closes the overlay, gives focus to the
// region that owns the command (the conversation for `First item`) and runs it
// with `keymap.runCommand`.
//
// Two lists (Marcus, 11 October 2026; mvp-chrome-and-keys task 12.1, design
// D8). `?` (the `prompt` context's `palette` action) at the start of an empty
// prompt box, and Ctrl+P (the global `palette` action) from any focus, open the
// command palette: acp-tui's own commands, grouped, with their keys. `/` (the
// `prompt` context's `agentCommands`; Marcus, 3 October 2026, for Zed, which
// keeps Ctrl+P) opens only the agent's commands, with a line naming `?` while
// the agent has sent none. Both openers act only while the prompt box has focus
// and is empty; in a draft they are text, so `src/app` and `why?` still type.
// The opening character is consumed (the filter starts empty), and Esc closes
// the list, returns focus to where it was and, when the prompt box is still
// empty, puts that character in it as text: `/`, Esc, `s7`, Enter sends `/s7`.
// Pasted text never opens a list. The layer is registered without a target,
// guarded by `store.ui.focus` and the prompt box's draft read at the key
// (`controller.composer().empty()`, since `store.ui.promptEmpty` can lag the
// keys of one read). Enter on an agent command always puts it in the prompt box
// as `/<name> `, with the input hint as its placeholder when the harness sent one,
// and sends nothing, since a missing hint does not mean the command takes no
// arguments (Marcus, 22 October 2026); acp-tui's own entries keep their actions.
// The `slash` context's `complete` (Tab) does the same for any entry of the slash
// menu, acp-tui's own included (`completionOf`).
//
// Shift+Tab (`cycleMode`) and Ctrl+T (`cycleThoughtLevel`) step the mode and
// the thinking level to the next value and apply it as the picker would, with a
// notice naming it (spec tui-keymap "Mode and effort keys"); neither acts while
// an overlay has focus, and without such an option they say so.
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, For, Show, type JSX } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { TextAttributes, type BoxRenderable, type KeyEvent } from "@opentui/core";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { useApp } from "../app/context.ts";
import { DEFAULT_MODEL_LIST_SETTINGS, type ModelListSettings } from "../layout/provider-groups.ts";
import { cardModel } from "../app/permission.ts";
import { typedText } from "../card/elicitation.tsx";
import { clean } from "../card/elicitation-form.ts";
import { homeDirectory } from "../config/sources.ts";
import { shortenHome, type Segment } from "../layout/segments.ts";
import { OVERLAY_BOTTOM } from "../layout/layout.ts";
import type { Focus } from "../layout/view.ts";
import { useKeys } from "../keys/context.ts";
import { actionLabel, keysFor, type KeyContext } from "../keys/keymap.ts";
import { commandCatalogue, CONTEXT_PRIORITY, registerContext, type CatalogueEntry, type ContextHandlers } from "../keys/register.ts";
import { spanStyle as toSpan } from "../theme/index.ts";
import { testHooks } from "../renderer/test-hooks.ts";
import { helpItems } from "./help.ts";
import { problemDetail, problemItems } from "./problems.ts";
import { filterItems, firstActive, moveSelection, overlayLayout, pageSelection, PICKER_FILTER_ABOVE, type ListItem, type OverlaySegment } from "./list.ts";
import { listPointer } from "./pointer.ts";
import {
  agentCommandNames,
  agentItems,
  configFor,
  currentName,
  LEGACY_MODE_ID,
  LEGACY_MODEL_ID,
  nextChoice,
  noOptionNotice,
  paletteItems,
  paletteRoutes,
  PICKER_CATEGORIES,
  pickerItems,
  pickerOptions,
  rankSlashMatches,
  slashStart,
  completionOf,
  enterCompletes,
  slashItems,
  typedAddDirectory,
  typedSlashCommand,
  type PaletteFacts,
  type PaletteItem,
  type SlashState,
} from "./palette.ts";

/** The `ui.overlay` name of the palette, the pickers and key help. */
export const PALETTE_OVERLAY = "palette";

/** What the overlay shows. */
export interface ListSource {
  /** The title in the top border. */
  title(): string;
  /** The entries, in order; read reactively, so an open list follows the session. */
  items(): readonly ListItem[];
  /** Whether the list has a filter field (typing filters it). */
  filter(): boolean;
  readonly placeholder: string;
  /** Group headers while the filter is empty. */
  readonly grouped: boolean;
  /** Mark the current value (pickers). */
  readonly marks: boolean;
  /** The Enter hint's verb (`run`, `apply`), or null for a list Enter does nothing in. */
  readonly enter: string | null;
  /** A muted line under the filter field that is not an entry (the slash menu of an agent with no
   *  commands). */
  note?(): string | null;
  /** The entry selected when the list opens (by index into `items()`). */
  initial?(items: readonly ListItem[]): number;
  /** Puts the entries that match the filter in the order shown (the slash menu's name matches
   *  first); omitted, they stay in the order of `items()`. */
  rank?(matches: readonly ListItem[], query: string): ListItem[];
  /** Where the selection starts after each change of the filter, over the entries shown; omitted,
   *  the first entry that can run. */
  start?(shown: readonly ListItem[], query: string, skip: (index: number) => boolean): number;
  /** Enter on an entry. */
  choose(item: ListItem): void;
  /** The line shown while the list has no entries at all (before any filter), instead of
   *  `no matches`. */
  empty?(): string | null;
  /** What the selected entry's row may cut, wrapped under the list when it does (`OverlayView.detail`),
   *  for lists whose one row per entry cuts what matters (the configuration's problems). */
  detail?(item: ListItem): string | null;
}

/** What the overlay shows: the command palette or the agent's commands, with the character that
 *  opened it (put back in the prompt box by Esc; null from Ctrl+P), a picker, key help, or the
 *  configuration's problems. */
type Mode =
  | { readonly kind: "palette"; readonly typed: string | null }
  | { readonly kind: "agent"; readonly typed: string | null }
  | { readonly kind: "picker"; readonly configId: string }
  | { readonly kind: "help" }
  | { readonly kind: "problems" }
  | { readonly kind: "restart"; readonly text: string };

export interface Palette {
  /** Rendered over the screen (the palette, pickers and key help). */
  readonly overlay: () => JSX.Element;
}

/** How long a config option change may go unanswered before a notice says acp-tui is waiting. */
export const CHANGE_WAIT_NOTICE_MS = 3000;
/** How long a config option change may go unanswered before a warning says it has not applied. */
export const CHANGE_TIMEOUT_MS = 30000;
/** How long that warning stays. */
export const CHANGE_TIMEOUT_NOTICE_MS = 8000;

export function createPalette(): Palette {
  return { overlay: () => <PaletteOverlay /> };
}

export function PaletteOverlay(): JSX.Element {
  const { store, actions, theme, config } = useApp();
  const { keymap, keyMap, controller } = useKeys();
  const dims = useTerminalDimensions();

  const [mode, setMode] = createSignal<Mode | null>(null);
  const [filter, setFilter] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [catalogue, setCatalogue] = createSignal<CatalogueEntry[]>([]);
  let returnFocus: Focus = "prompt";
  let lastOffset = 0;
  // What a selection and the focus were when the list opened, for the entries that need them
  // (`PaletteFacts`); the selection cannot change under an open list.
  const [opened, setOpened] = createSignal({ selection: false, promptSelection: false, fromConversation: false });

  // The agent's options, with legacy modes as a `mode` option when it offers no other.
  const modelSettings = (): ModelListSettings => {
    const models = config?.config().models;
    return models ? { groupByProvider: models.group_by_provider, separator: models.provider_separator } : DEFAULT_MODEL_LIST_SETTINGS;
  };
  const options = createMemo(() => pickerOptions({ configOptions: store.session.configOptions, modes: store.session.modes, models: store.session.models }));

  const permissionOptions = () => {
    const id = store.session.openPermissionId;
    const record = id ? store.session.items[id] : undefined;
    if (record?.kind !== "permission_record") return [];
    const tool = store.session.items[`tool:${record.toolCallId}`];
    return cardModel(record, tool?.kind === "tool_call" ? tool : undefined).options.map((o) => o.label);
  };

  const pickerOption = (configId: string) => {
    const option = options().find((o) => o.id === configId);
    return option?.type === "select" ? option : null;
  };

  /** The character an opener types: its first key that is one printable character (`?`, `/`), or
   *  null when it is bound only to a key that types nothing (Esc then leaves nothing). */
  const typedBy = (action: "palette" | "agentCommands"): string | null =>
    keysFor(keyMap, "prompt", action).find((key) => [...key].length === 1 && key !== " ") ?? null;

  const focusFor = (context: KeyContext): Focus =>
    context === "conversation" ? "conversation" : context === "card" ? "card" : context === "prompt" ? "prompt" : returnFocus;

  const paletteSource: ListSource = {
    title: () => "Commands",
    items: () =>
      paletteItems(catalogue(), {
        configOptions: options(),
        mouse: store.ui.mouse,
        permissionOptions: permissionOptions(),
        directories: store.session.additionalDirectories?.length ?? 0,
        routes: paletteRoutes(keyMap, { interrupt: controller.interrupt, mouse: store.ui.mouse }),
        // Whether a turn runs is read live, the rest as the palette opened (task 13.12).
        facts: { ...opened(), idle: store.session.state === "idle" } satisfies PaletteFacts,
      }),
    filter: () => true,
    placeholder: "type to filter commands",
    grouped: true,
    marks: false,
    enter: "run",
    choose: (item) => choosePaletteItem(item as PaletteItem),
  };

  // What decides acp-tui's slash commands: the registered commands, the agent's options and the
  // names the agent advertises (its entry wins).
  const slashState = (): SlashState => ({
    configOptions: options(),
    agentCommands: agentCommandNames(store.session.commands),
    routes: paletteRoutes(keyMap, { interrupt: controller.interrupt, mouse: store.ui.mouse }),
  });

  // The slash menu (`/`): the agent's commands first, under no header (the title says what they
  // are), then acp-tui's under their own (tui-palette "acp-tui commands in the slash menu").
  const noAgentCommands = (): string => {
    const key = actionLabel(keyMap, "prompt", "palette") ?? actionLabel(keyMap, "global", "palette");
    return key ? `the harness offers no commands; ${key} opens acp-tui's commands` : "the harness offers no commands";
  };
  const agentSource: ListSource = {
    title: () => "Slash commands",
    items: () => [...agentItems(store.session.commands).map((item) => ({ ...item, group: null })), ...slashItems(catalogue(), slashState())],
    filter: () => true,
    placeholder: "type to filter the commands",
    grouped: true,
    marks: false,
    enter: "run",
    choose: (item) => choosePaletteItem(item as PaletteItem),
    rank: rankSlashMatches,
    start: slashStart,
    note: () => (store.session.commands.length === 0 ? noAgentCommands() : null),
    empty: noAgentCommands,
  };

  const pickerSource = (configId: string): ListSource => ({
    title: () => {
      const option = pickerOption(configId);
      return option ? clean(option.name) : "";
    },
    items: () => {
      const option = pickerOption(configId);
      return option ? pickerItems(option, modelSettings()) : [];
    },
    filter: () => items().length > PICKER_FILTER_ABOVE,
    placeholder: "type to search",
    grouped: true,
    marks: true,
    enter: "apply",
    initial: (items) => Math.max(0, items.findIndex((item) => item.current)),
    choose: (item) => {
      close();
      if (!item.current) apply(configId, item.id);
    },
  });

  const helpSource: ListSource = {
    title: () => "Keys",
    items: () => helpItems(keyMap, dims().width - 4),
    filter: () => true,
    placeholder: "type to filter keys",
    grouped: true,
    marks: false,
    enter: null,
    choose: () => {},
  };

  // The configuration's problems (mvp-configuration task 8.4; spec tui-config "Configuration
  // problems are visible"): every problem, grouped by file, each with its line, column and setting,
  // and what is wrong; read from the store, so the list follows a reload while it is open.
  const problemsSource: ListSource = {
    title: () => "Configuration problems",
    items: () => problemItems(config?.problems() ?? []),
    filter: () => true,
    placeholder: "type to filter problems",
    grouped: true,
    marks: false,
    enter: null,
    choose: () => {},
    empty: () => "no configuration problems",
    // The selected problem's message under the list, only when its row cuts it (IDE check 12.5:
    // a kept-key warning's routes come after the part one row shows).
    detail: problemDetail,
  };

  // `/add-dir` for a harness that must restart: two entries in the overlay's place, answered
  // through `decideRestart` (Esc and any other way of closing the list answer no).
  let decideRestart: ((yes: boolean) => void) | null = null;
  const answerRestart = (yes: boolean): void => {
    const decide = decideRestart;
    decideRestart = null;
    decide?.(yes);
  };
  const restartSource: ListSource = {
    title: () => "Add a directory",
    items: () => {
      const m = mode();
      return [
        { id: "restart", group: null, title: m?.kind === "restart" ? m.text : "", search: "" },
        { id: "cancel", group: null, title: "Cancel", search: "" },
      ];
    },
    filter: () => false,
    placeholder: "",
    grouped: false,
    marks: false,
    enter: "choose",
    choose: (item) => {
      answerRestart(item.id === "restart");
      close();
    },
  };

  const source = createMemo((): ListSource | null => {
    const m = mode();
    if (!m) return null;
    if (m.kind === "restart") return restartSource;
    if (m.kind === "palette") return paletteSource;
    if (m.kind === "agent") return agentSource;
    if (m.kind === "picker") return pickerSource(m.configId);
    if (m.kind === "problems") return problemsSource;
    return helpSource;
  });
  const items = createMemo((): readonly ListItem[] => source()?.items() ?? []);
  const filterable = () => source()?.filter() ?? false;
  const shown = createMemo(() => {
    const query = filterable() ? filter() : "";
    const matches = filterItems(items(), query);
    return source()?.rank?.(matches, query) ?? matches;
  });

  /** Item `index` of the shown list is muted: not available now (`ListItem.muted`). */
  const isMuted = (index: number): boolean => shown()[index]?.muted === true;
  /** The selection a list starts at, or returns to when its filter changes: the first entry that can run. */
  const resetSelection = () => {
    const start = source()?.start;
    setSelected(start ? start(shown(), filterable() ? filter() : "", isMuted) : firstActive(shown().length, isMuted));
  };

  const open = (next: Mode) => {
    if (store.ui.focus !== "overlay") returnFocus = store.ui.focus;
    lastOffset = 0;
    const promptSelection = controller.composer()?.hasSelection?.() ?? false;
    batch(() => {
      setOpened({ selection: promptSelection || controller.hasConversationSelection(), promptSelection, fromConversation: returnFocus === "conversation" });
      setCatalogue(commandCatalogue(keymap, keyMap));
      setMode(next);
      setFilter("");
      resetSelection();
      const initial = source()?.initial;
      if (initial) setSelected(initial(shown()));
      // mvp-sessions: the overlay slot is the palette's now (the session list closes itself).
      store.setOverlay(PALETTE_OVERLAY);
      store.setFocus("overlay");
    });
  };

  const close = (focus?: Focus) => {
    setMode(null);
    if (store.ui.overlay !== PALETTE_OVERLAY) return;
    store.setOverlay(null);
    if (store.ui.focus !== "overlay") return;
    let next = focus ?? returnFocus;
    if (next === "card" && store.session.openPermissionId === null) next = "prompt";
    store.setFocus(next);
  };

  // Focus taken elsewhere (a click on the prompt box) closes the overlay.
  createEffect(
    on(
      () => store.ui.focus,
      (focus) => {
        if (focus !== "overlay" && mode() !== null) {
          setMode(null);
          if (store.ui.overlay === PALETTE_OVERLAY) store.setOverlay(null);
        }
      },
      { defer: true },
    ),
  );
  // Another overlay (the session list, mvp-sessions) took the slot: the palette closes, leaving
  // the focus to it.
  createEffect(
    on(
      () => store.ui.overlay,
      (overlay) => {
        if (overlay !== PALETTE_OVERLAY && mode() !== null) setMode(null);
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      () => mode()?.kind === "restart",
      (restarting) => {
        if (!restarting) answerRestart(false);
      },
      { defer: true },
    ),
  );
  // A list that shrank under the selection (the agent replaced its commands) keeps it in range.
  createEffect(() => {
    const count = shown().length;
    if (selected() >= count && count > 0) setSelected(count - 1);
  });

  const openPicker = (category: string) => {
    const option = configFor(options(), category);
    if (!option || option.type !== "select") {
      close();
      controller.notify(noOptionNotice(category), "muted");
      return;
    }
    open({ kind: "picker", configId: option.id });
  };

  // `short-change-timeout` (renderer/test-hooks.ts) shortens both waits for the PTY tests.
  const short = testHooks().has("short-change-timeout");
  const waitNoticeMs = short ? 300 : CHANGE_WAIT_NOTICE_MS;
  const timeoutMs = short ? 2000 : CHANGE_TIMEOUT_MS;
  // The timers of changes the harness has not answered yet, cleared with the overlay.
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  onCleanup(() => {
    for (const timer of pendingTimers) clearTimeout(timer);
    pendingTimers.clear();
  });

  /** Applies a value as the picker does: `session/set_config_option` (or `session/set_mode` for a
   *  legacy mode, `session/set_model` for a legacy model: the synthesised options are never sent
   *  to the agent as config options), then a notice naming the new value, or the agent's error. */
  const apply = (configId: string, value: string | boolean) => {
    const option = options().find((o) => o.id === configId);
    const name = option ? clean(option.name) : clean(configId);
    const sent =
      configId === LEGACY_MODE_ID
        ? typeof value === "string"
          ? actions.setMode?.(value)
          : undefined
        : configId === LEGACY_MODEL_ID
          ? typeof value === "string"
            ? actions.setModel?.(value)
            : undefined
          : actions.setConfigOption?.(configId, value);
    if (!sent) {
      controller.notify(`cannot change ${name} here`, "muted");
      return;
    }
    // A harness that is slow to answer, or never does (OpenCode 1.19.3 whose plugin's child process
    // read the request off the harness's stdin), is shown as such rather than as nothing: a notice
    // while it is awaited, and a warning that the value is unchanged when it has not answered in time.
    const harness = store.session.agent?.title ?? store.session.agent?.name ?? "the harness";
    let waiting: number | null = null;
    const dismissWaiting = () => {
      if (waiting !== null) store.dismissNotice(waiting);
      waiting = null;
    };
    const waitTimer = setTimeout(() => {
      waiting = store.notify(`waiting for ${harness} to change ${name}…`, "muted");
    }, waitNoticeMs);
    const timeoutTimer = setTimeout(() => {
      dismissWaiting();
      const still = options().find((o) => o.id === configId);
      controller.notify(`${harness} has not answered the change of ${name}; it is still ${still ? currentName(still, modelSettings()) : "unchanged"}`, "warning", CHANGE_TIMEOUT_NOTICE_MS);
    }, timeoutMs);
    pendingTimers.add(waitTimer);
    pendingTimers.add(timeoutTimer);
    const settle = () => {
      clearTimeout(waitTimer);
      clearTimeout(timeoutTimer);
      pendingTimers.delete(waitTimer);
      pendingTimers.delete(timeoutTimer);
      dismissWaiting();
    };
    sent.then(
      () => {
        settle();
        const updated = options().find((o) => o.id === configId);
        controller.notify(`${name}: ${updated ? currentName(updated, modelSettings()) : clean(String(value))}`, "muted");
      },
      (error: unknown) => {
        settle();
        controller.notify(`could not change ${name}: ${clean(error instanceof Error ? error.message : String(error))}`, "warning");
      },
    );
  };

  /** Shift+Tab and Ctrl+T: the option of `category` to its next value. */
  const cycle = (category: string): boolean => {
    if (store.ui.focus === "overlay") return false;
    const option = configFor(options(), category);
    if (!option || option.type !== "select") {
      controller.notify(noOptionNotice(category), "muted");
      return true;
    }
    const next = nextChoice(option as Extract<SessionConfigOption, { type: "select" }>);
    if (!next) {
      controller.notify(`${clean(option.name)}: ${currentName(option, modelSettings())} (the only value)`, "muted");
      return true;
    }
    apply(option.id, next.value);
    return true;
  };

  /** An agent command chosen: put in the prompt box as `/<name> ` (the input hint as its
   *  placeholder when there is one), never sent from here: a harness that sends no hint may still
   *  take arguments, so a second Enter in the prompt box sends it. */
  const runAgentCommand = (name: string, inputHint: string | null) => {
    close("prompt");
    controller.composer()?.insertCommand?.(`/${name} `, inputHint);
  };

  /** Asks whether to restart the harness for `/add-dir`: the overlay's two entries; resolves false
   *  when the list is closed any other way. */
  const confirmRestart = (text: string): Promise<boolean> =>
    new Promise((resolve) => {
      answerRestart(false);
      decideRestart = resolve;
      open({ kind: "restart", text });
    });

  /** `/add-dir <path>`: adds the directory through the session switcher and says what happened. */
  const runAddDirectory = (path: string): void => {
    const add = actions.addDirectory;
    if (!add) {
      controller.notify("cannot add a directory here", "muted");
      return;
    }
    void add(path, confirmRestart).then(
      (result) => {
        if (result.ok) controller.notify(`added ${shortenHome(result.directory, homeDirectory())} to the session`, "muted");
        else if (result.cancelled !== true) controller.notify(clean(result.message), "warning");
      },
      (error: unknown) => controller.notify(`could not add the directory: ${clean(error instanceof Error ? error.message : String(error))}`, "warning"),
    );
  };

  /** The palette's `Add a directory…` and `/add-dir` alone: `/add-dir ` in the prompt box, for the path. */
  const insertAddDirectory = (): boolean => {
    close("prompt");
    store.setFocus("prompt");
    controller.composer()?.insertCommand?.("/add-dir ", null);
    return true;
  };

  /** A sent prompt that is exactly one of acp-tui's slash commands, with the agent advertising no
   *  command of that name: runs the command as choosing it from the menu does (the prompt box has
   *  cleared its draft); false for anything else, which is sent as text. */
  const runTypedSlash = (text: string): boolean => {
    const catalogueNow = commandCatalogue(keymap, keyMap);
    const directory = typedAddDirectory(text, catalogueNow, slashState());
    if (directory !== null) {
      runAddDirectory(directory);
      return true;
    }
    const command = typedSlashCommand(text, commandCatalogue(keymap, keyMap), slashState());
    if (!command) return false;
    // A conversation command is registered for the conversation's focus.
    if (command.context === "conversation") store.setFocus("conversation");
    choosePaletteItem({
      id: `slash:${command.name}`,
      group: null,
      title: `/${command.name}`,
      action: { kind: "command", name: command.command, context: command.context },
    });
    return true;
  };
  controller.setSlashRunner(runTypedSlash);
  onCleanup(() => controller.setSlashRunner(null));

  const choosePaletteItem = (item: PaletteItem) => {
    const action = item.action;
    if (action.kind === "agent") return runAgentCommand(action.name, action.inputHint);
    if (action.kind === "picker") return open({ kind: "picker", configId: action.configId });
    if (action.kind === "switch") {
      close();
      return apply(action.configId, action.value);
    }
    if (action.name === "global.keyHelp") return open({ kind: "help" });
    if (action.name === "global.configProblems") return open({ kind: "problems" });
    const pick = action.context === "global" ? PICKER_CATEGORIES[action.name.slice("global.".length)] : undefined;
    if (pick) return openPicker(pick);
    close(focusFor(action.context));
    // After the focus change has reached the renderer, so a focus-scoped command is active.
    setTimeout(() => {
      const result = keymap.runCommand(action.name);
      if (!result.ok) controller.notify(`not available now: ${item.title}`, "muted");
    }, 0);
  };

  // Ctrl+P, the picker commands, key help and the cycle keys: a global layer of their own. Ctrl+P
  // from the agent's commands shows the command palette in their place.
  const toggle = (kind: "palette" | "help" | "problems") => (mode()?.kind === kind ? close() : open(kind === "palette" ? { kind, typed: null } : { kind }));
  const removeGlobal = registerContext(keymap, keyMap, "global", {
    palette: () => toggle("palette"),
    pickModel: () => openPicker(PICKER_CATEGORIES["pickModel"]!),
    pickMode: () => openPicker(PICKER_CATEGORIES["pickMode"]!),
    pickThoughtLevel: () => openPicker(PICKER_CATEGORIES["pickThoughtLevel"]!),
    keyHelp: () => toggle("help"),
    configProblems: () => toggle("problems"),
    addDirectory: insertAddDirectory,
    cycleMode: () => cycle("mode"),
    cycleThoughtLevel: () => cycle("thought_level"),
  });
  onCleanup(removeGlobal);
  // `?` and `/` in the empty prompt box. Not scoped to the prompt box's textarea (which this module
  // cannot reach): the guard reads the focus instead, and anywhere else the key goes on as text.
  const promptEmpty = () => controller.composer()?.empty?.() ?? store.ui.promptEmpty;
  const opener = (kind: "palette" | "agent", action: "palette" | "agentCommands") => () => {
    if (store.ui.focus !== "prompt" || !promptEmpty() || mode() !== null) return false;
    open({ kind, typed: typedBy(action) });
  };
  const removeOpeners = registerContext(
    keymap,
    keyMap,
    "prompt",
    { palette: opener("palette", "palette"), agentCommands: opener("agent", "agentCommands") },
    { priority: CONTEXT_PRIORITY },
  );
  onCleanup(removeOpeners);

  const layout = createMemo(() => {
    const m = mode();
    const src = source();
    const enter = actionLabel(keyMap, "overlay", "choose");
    const complete = m?.kind === "agent" ? actionLabel(keyMap, "slash", "complete") : null;
    const clear = actionLabel(keyMap, "overlay", "clear");
    const esc = actionLabel(keyMap, "overlay", "close");
    // Opened by `?` or `/`: Esc leaves that character as text (an agent command the list does not
    // know, a question), last, so a narrow border drops it first.
    const typed = m?.kind === "palette" || m?.kind === "agent" ? m.typed : null;
    // The slash menu's Enter word follows the selected entry: it completes an agent command and
    // `/add-dir`, and runs the rest of acp-tui's.
    const selectedItem = shown()[selected()];
    const enterWord = m?.kind === "agent" && selectedItem && enterCompletes(selectedItem as PaletteItem) ? "complete" : src?.enter;
    const bypass = esc && typed ? `${esc} types ${typed}` : null;
    const hints: Segment[] = [
      { text: src?.enter === null ? "↑↓ scroll" : "↑↓ select", token: "muted" },
      ...(enter && src?.enter ? [{ text: " · ", token: "muted" as const, breakBefore: true }, { text: `${enter} ${enterWord}`, token: "muted" as const }] : []),
      ...(complete ? [{ text: " · ", token: "muted" as const, breakBefore: true }, { text: `${complete} complete`, token: "muted" as const }] : []),
      ...(clear && filterable() ? [{ text: " · ", token: "muted" as const, breakBefore: true }, { text: `${clear} clear`, token: "muted" as const }] : []),
      ...(bypass ? [{ text: " · ", token: "muted" as const, breakBefore: true }, { text: bypass, token: "muted" as const }] : []),
    ];
    // In the prompt box's place (task 12.7): the bottom edge on its bottom border's row, at least as
    // tall as the box so it covers it, and never on the screen's first row. Above the status row
    // (`OVERLAY_BOTTOM`) only while the prompt box has not been laid out.
    const rows = dims().height;
    const frame = controller.composer()?.frame?.() ?? null;
    const place = frame && frame.bottom < rows ? { bottom: rows - 1 - frame.bottom, minRows: frame.bottom - frame.top + 1, maxRows: frame.bottom } : null;
    const result = overlayLayout({
      title: src?.title() ?? "",
      filter: filterable() ? filter() : null,
      placeholder: src?.placeholder ?? "",
      items: shown(),
      grouped: src?.grouped ?? true,
      selected: selected(),
      offset: lastOffset,
      width: dims().width,
      rows,
      closeLabel: esc,
      hints,
      marks: src?.marks ?? false,
      ...(place ? { minRows: place.minRows, maxRows: place.maxRows } : {}),
      ...(items().length === 0 && src?.empty ? { empty: src.empty() ?? undefined } : {}),
      ...(src?.note?.() ? { note: src.note()! } : {}),
      ...(src?.detail && shown()[selected()] ? { detail: src.detail(shown()[selected()]!) } : {}),
    });
    lastOffset = result.offset;
    return { ...result, bottom: place?.bottom ?? OVERLAY_BOTTOM };
  });

  /** The slash context's `complete` (Tab): the selected entry of the slash menu into the prompt box.
   *  False outside the slash menu, so Tab reaches the `overlay` context (the session list's scope),
   *  and with no entry to complete. */
  const completeSelected = (): boolean => {
    if (mode()?.kind !== "agent") return false;
    const item = shown()[selected()];
    const completion = item && !item.muted ? completionOf(item as PaletteItem) : null;
    if (!completion) return false;
    close("prompt");
    store.setFocus("prompt");
    controller.composer()?.insertCommand?.(completion.text, completion.hint);
    return true;
  };

  const moveBy = (move: number | "first" | "last") => void setSelected((s) => moveSelection(shown().length, s, move, isMuted));
  const handlers: ContextHandlers<"overlay"> = {
    up: () => moveBy(-1),
    down: () => moveBy(1),
    // A page counted in rows, headers and the blank rows before them included (task 12.7).
    pageUp: () => void setSelected((s) => pageSelection(layout().rows, s, layout().listHeight, -1, isMuted)),
    pageDown: () => void setSelected((s) => pageSelection(layout().rows, s, layout().listHeight, 1, isMuted)),
    first: () => moveBy("first"),
    last: () => moveBy("last"),
    choose: () => {
      const item = shown()[selected()];
      // A muted entry (not available now) is run by neither Enter nor a click (task 13.12).
      if (item && !item.muted) source()?.choose(item);
    },
    close: () => {
      const m = mode();
      const typed = m?.kind === "palette" || m?.kind === "agent" ? m.typed : null;
      close();
      // Esc after `?` or `/`: the character goes into the prompt box as text.
      if (typed && store.ui.focus === "prompt" && promptEmpty()) controller.composer()?.insertCommand?.(typed, null);
    },
    clear: () => {
      setFilter("");
      resetSelection();
    },
  };

  const onKeyDown = (key: KeyEvent) => {
    if (!filterable()) return;
    if (key.name === "backspace") {
      setFilter((f) => [...f].slice(0, -1).join(""));
      resetSelection();
      key.preventDefault();
      return;
    }
    const typed = typedText(key);
    if (typed !== null) {
      setFilter((f) => f + typed);
      resetSelection();
      key.preventDefault();
    }
  };

  const spanStyle = (s: OverlaySegment) => {
    const base = theme.text(s.token);
    const attributes = base.attributes | (s.bold ? TextAttributes.BOLD : 0);
    if (s.cursor) return toSpan({ ...base, attributes: attributes | TextAttributes.INVERSE });
    if (!s.selected) return toSpan({ ...base, attributes });
    return toSpan(theme.flat ? { ...base, attributes: attributes | TextAttributes.INVERSE } : { ...base, attributes, bg: theme.color("surface.cursor") });
  };

  function Panel(): JSX.Element {
    let box: BoxRenderable | undefined;
    onMount(() => {
      if (!box) return;
      onCleanup(registerContext(keymap, keyMap, "overlay", handlers, { target: box }));
      // Above `overlay` on the same box, so Tab completes in the slash menu and falls through to
      // `overlay.toggleScope` anywhere else.
      onCleanup(registerContext(keymap, keyMap, "slash", { complete: completeSelected }, { target: box, priority: CONTEXT_PRIORITY + 1 }));
    });
    return (
      <box
        ref={(r: BoxRenderable) => (box = r)}
        position="absolute"
        left={0}
        bottom={layout().bottom}
        zIndex={100}
        width={dims().width}
        height={layout().lines.length}
        flexDirection="column"
        focusable
        focused={store.ui.focus === "overlay"}
        // The terminal's own background, opaque so the prompt box under it does not show through
        // (task 12.7: on a fill, the key hints in the bottom border read as one more entry).
        backgroundColor={theme.background()}
        onKeyDown={onKeyDown}
        {...listPointer({
          box: () => box,
          itemAt: () => layout().itemAt,
          // The pointer selects as the keyboard does; a click does what Enter does (task 13.6).
          // A muted entry is neither selected by the pointer nor run by a click, and a click on it
          // stops there like a click on a header (task 13.12).
          select: (index) => void (isMuted(index) || setSelected(index)),
          choose: (index) => {
            if (isMuted(index)) return;
            setSelected(index);
            handlers.choose?.();
          },
        })}
      >
        <For each={layout().lines}>
          {(row) => (
            <text wrapMode="none" height={1} {...theme.text("text")}>
              <For each={row}>{(s) => <span style={spanStyle(s)}>{s.text}</span>}</For>
            </text>
          )}
        </For>
      </box>
    );
  }

  return (
    <Show when={mode() !== null}>
      <Panel />
    </Show>
  );
}
