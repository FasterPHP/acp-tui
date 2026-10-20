// The key map (design D8, 6.6; spec tui-keymap "Bindings are data"): a plain
// object `{ context: { key: action } }`. Pure: no OpenTUI here. Keys are
// normalised (case, modifier order and aliases) so that two spellings of one
// key in one context are caught as a conflict when the map is loaded.

// Contexts (spec tui-keymap "Bindings are data"): `global` works from any focus; `prompt`,
// `conversation` and `card` are scoped to the region that has focus and outrank `global`.
// `overlay` (the command palette, pickers, key help and the session list) and `elicitation` (the
// elicitation card) are scoped to their component; `selection` (a global layer above the others
// while text is selected) and `find` (the find bar) are always mounted.
export const KEY_CONTEXTS = ["global", "prompt", "conversation", "card", "overlay", "elicitation", "selection", "find"] as const;
export type KeyContext = (typeof KEY_CONTEXTS)[number];

/**
 * What a group heading says about where a context's keys work (day-two-feedback task 13.11; spec
 * tui-palette "Group headings say where keys work"): the palette and key help print it after the
 * group's name, `Conversation (shortcuts apply while selected)`, instead of a place after each
 * key. Null for the contexts whose keys work from any focus (`global`, and `selection`, a global
 * layer above the others), whose headings carry no hint. The words are short enough for the longest
 * group name to fit the 59 inner columns of a 63-column pane (a test holds them to it).
 */
export const KEY_SCOPES: { readonly [C in KeyContext]: string | null } = {
  global: null,
  prompt: "shortcuts apply while selected",
  conversation: "shortcuts apply while selected",
  card: "shortcuts apply while it is open",
  overlay: "shortcuts apply while one is open",
  elicitation: "shortcuts apply while it is open",
  selection: null,
  find: "shortcuts apply while it is open",
};

/** The actions each context offers. Handlers live with the code that owns the context. */
export const KEY_ACTIONS = {
  // Esc (`escape`) arms interrupt while a turn runs and cancels on a second press; `interrupt`
  // cancels the turn at once and has no default key (the palette's `Interrupt the turn`;
  // mvp-chrome-and-keys design D11: Ctrl+C is the selection's `copy` and nothing else); F2
  // (`toggleMouse`) flips the mouse policy.
  // `palette` (Ctrl+P), the three config pickers (no key: the pills and the palette), the mode and
  // effort cycles and key help are handled by src/overlay/Overlay.tsx.
  // `find` (Ctrl+F), `findNext` (F3) and `findPrevious` (Shift+F3) are handled by src/find/.
  // mvp-sessions (task 7.2): `sessions` opens the session list (src/overlay/SessionList.tsx); it
  // has no default key (mvp-chrome-and-keys Open Question 8), so it is reached from the palette.
  // mvp-chrome-and-keys (task 3.7, design D16): `cycleMode` (Shift+Tab) and `cycleThoughtLevel`
  // (Ctrl+T) step the mode and the effort (task 3.6), `keyHelp` (F1) opens key help (task 6.8),
  // and `configProblems` (no key) lists the configuration's problems (mvp-configuration task 8.4:
  // the palette's `Configuration problems`, handled by src/overlay/Overlay.tsx).
  global: [
    "escape",
    "interrupt",
    "detach",
    "toggleFocus",
    "toggleTool",
    "repaint",
    "toggleMouse",
    "pageUp",
    "pageDown",
    "palette",
    "pickModel",
    "pickMode",
    "pickThoughtLevel",
    "find",
    "findNext",
    "findPrevious",
    "sessions",
    "cycleMode",
    "cycleThoughtLevel",
    "keyHelp",
    "configProblems",
  ],
  // Marcus, 11 October 2026 (mvp-chrome-and-keys task 12.1, design D8): `palette` (`?` at the start
  // of an empty prompt box) opens the command palette, as Ctrl+P does, and `agentCommands` (`/` in an
  // empty prompt box) the agent's own commands (src/overlay/Overlay.tsx); in a draft both are text.
  // mvp-rendering (task 14.3, review C20): `first` and `last` (Home and End) move the conversation to
  // its first and last item from an empty prompt box, as PgUp and PgDn page it from there; in a
  // draft the textarea keeps them as line start and end.
  // mvp-chrome-and-keys (task 3.2, design D11): `paste` (Ctrl+V, and a palette command) reads text
  // from the system clipboard and inserts it as a bracketed paste would (src/selection/clipboard.ts);
  // Ctrl+Shift+V is its named key and Alt+V its route where an IDE keeps both (task 12.2).
  // day-two-feedback (task groups 8 and 9; spec tui-keymap "Prompt box selection keys" and "Undo and
  // redo in the prompt box"): the `select*` actions extend the prompt box's selection (Shift with the
  // arrows, Home and End, Ctrl+Shift or Alt+Shift with Left and Right by word; keystroke-only),
  // `selectAll` (Ctrl+A, replacing OpenTUI's line-start binding; day-two-feedback task 13.3) selects the
  // whole draft, `cut` (Ctrl+X) copies it and removes it (src/selection/select.tsx owns the clipboard), and
  // `undo` (Ctrl+Z, Cmd+Z) and `redo` (Ctrl+Y, Ctrl+Shift+Z, Cmd+Shift+Z) step the draft's edit
  // history (src/app/prompt-undo.ts).
  prompt: [
    "submit",
    "newline",
    "lineUp",
    "lineDown",
    "palette",
    "agentCommands",
    "first",
    "last",
    "paste",
    "selectLeft",
    "selectRight",
    "selectUp",
    "selectDown",
    "selectHome",
    "selectEnd",
    "selectWordLeft",
    "selectWordRight",
    "selectAll",
    "cut",
    "undo",
    "redo",
  ],
  // The conversation while it has focus (spec tui-keymap "Conversation keys"): the cursor moves
  // by item, `last` also resumes following, Enter toggles the item under the cursor, Esc returns
  // to the prompt box. `copyItem` (`y`) and `copyItemMarkdown` (`Y`) copy the item under the
  // cursor; `export` (`e`) writes the conversation as Markdown to a file. mvp-conversation:
  // `cycleDensity` (`v`) switches the density (day-two-feedback task 13.7: the three single-density
  // actions are gone, since naming the values in the cycle entry does not scale);
  // `previousPrompt`, `nextPrompt` (`{`, `}`), `previousTool` and `nextTool` (`[`, `]`) jump the
  // cursor over the whole session. mvp-rendering (task 6.3): `openLink` (`o`, design open question
  // 6) opens the link of the item under the cursor, or lists its links (src/links/).
  // mvp-rendering (task 9.3): `expandOutput` (`a`, "all", design open
  // question 6) shows the tool call under the cursor's output in full, or as a snippet again.
  conversation: [
    "up",
    "down",
    "first",
    "last",
    "toggle",
    "back",
    "copyItem",
    "copyItemMarkdown",
    "export",
    "cycleDensity",
    "previousPrompt",
    "nextPrompt",
    "previousTool",
    "nextTool",
    "openLink",
    "expandOutput",
  ],
  // The permission card: a digit selects an option, Left and Right move the selection, Enter
  // answers with the selected option (decision 1 by Marcus before apply); Esc returns to the
  // prompt box.
  card: [
    "choose1",
    "choose2",
    "choose3",
    "choose4",
    "choose5",
    "choose6",
    "choose7",
    "choose8",
    "choose9",
    "previous",
    "next",
    "confirm",
    "back",
    // The preview's scrolling and Ctrl+O grow (mvp-chrome-and-keys task 5.1).
    "scrollUp",
    "scrollDown",
    "pageUp",
    "pageDown",
    "top",
    "bottom",
    "grow",
  ],
  // The palette, pickers and key help (src/overlay/Overlay.tsx). The filter field has focus;
  // Up, Down, PgUp, PgDn, Home and End move the selection, Enter chooses, Esc closes, Ctrl+U
  // clears the filter.
  // mvp-sessions (task 7.1): `toggleScope` (Tab) switches the session list between the session
  // directory and all directories; the palette and pickers have no handler for it.
  overlay: ["up", "down", "pageUp", "pageDown", "first", "last", "choose", "close", "clear", "toggleScope"],
  // The elicitation card (src/card/elicitation.tsx). Up and Down move
  // between choices, a digit picks one, Space ticks one of several, Enter goes to the next
  // question (or submits the review), Esc skips an optional question or declines.
  elicitation: [
    "up",
    "down",
    "choose1",
    "choose2",
    "choose3",
    "choose4",
    "choose5",
    "choose6",
    "choose7",
    "choose8",
    "choose9",
    "toggle",
    "confirm",
    "back",
  ],
  // A global layer above the others (src/selection/select.tsx): Ctrl+C (`copy`) copies the
  // selection, else the item under the conversation cursor while the conversation has focus, else
  // nothing, and is always consumed (mvp-conversation design D7); Ctrl+Shift+C (`copyRich`)
  // copies a selection as plain text too, else the cursor item's Markdown (in the legacy encoding
  // both IDEs send it as Ctrl+C's byte, so it acts as Ctrl+C there); Esc clears a selection, and
  // with nothing selected goes on to its usual action.
  selection: ["copy", "copyRich", "clear"],
  // The find bar (src/find/). Enter and Shift+Enter go to the next and
  // previous hit (Shift+Enter in all three encodings: `shift+return`, `meta+return` from
  // JetBrains, and `linefeed`, the bare `\n` Zed sends; the layer is scoped to the bar, so the
  // prompt box's `linefeed` newline is untouched), Esc closes it and returns to the previous
  // position, Tab closes it and moves focus to the conversation at the hit, Ctrl+U clears the
  // query; other printable keys type.
  find: ["next", "previous", "close", "conversation", "clear"],
} as const satisfies Record<KeyContext, readonly string[]>;

export type KeyAction<C extends KeyContext = KeyContext> = (typeof KEY_ACTIONS)[C][number];

/**
 * The command catalogue's titles: every action once, as `<context>.<action>` (`commandName`).
 * register.ts registers each as an `@opentui/keymap` command with these fields, so the command
 * palette (task 13.2) and the help card list them with their keys from the key map in use.
 */
export const COMMAND_TITLES: { readonly [C in KeyContext]: Readonly<Record<KeyAction<C>, string>> } = {
  global: {
    escape: "Interrupt the running turn (press twice)",
    interrupt: "Interrupt the turn",
    detach: "Detach and exit",
    toggleFocus: "Move focus to the next region",
    toggleTool: "Expand or collapse the latest tool call",
    repaint: "Repaint the screen",
    toggleMouse: "Turn mouse reporting off or on",
    pageUp: "Scroll the conversation up a page",
    pageDown: "Scroll the conversation down a page",
    palette: "Open the command palette",
    pickModel: "Choose the model",
    pickMode: "Choose the mode",
    pickThoughtLevel: "Choose the thinking level",
    find: "Find in the conversation",
    findNext: "Find the next hit",
    findPrevious: "Find the previous hit",
    sessions: "Open the session list",
    cycleMode: "Next mode",
    cycleThoughtLevel: "Next thinking level",
    keyHelp: "Key help",
    configProblems: "Configuration problems",
  },
  prompt: {
    submit: "Send the prompt",
    newline: "Insert a newline",
    lineUp: "Move to the line above",
    lineDown: "Move to the line below",
    palette: "Open the command palette (in an empty prompt box)",
    agentCommands: "Open the slash commands (in an empty prompt box)",
    first: "First item of the conversation (in an empty prompt box)",
    last: "Last item of the conversation, following it (in an empty prompt box)",
    paste: "Paste from the clipboard",
    selectLeft: "Select a character to the left",
    selectRight: "Select a character to the right",
    selectUp: "Select up a line",
    selectDown: "Select down a line",
    selectHome: "Select to the start of the draft",
    selectEnd: "Select to the end of the draft",
    selectWordLeft: "Select a word to the left",
    selectWordRight: "Select a word to the right",
    selectAll: "Select all",
    cut: "Cut the selection",
    undo: "Undo the last edit",
    redo: "Redo the edit",
  },
  conversation: {
    up: "Previous item",
    down: "Next item",
    first: "First item",
    last: "Last item, following the conversation",
    toggle: "Expand or collapse the item",
    back: "Back to the prompt box",
    copyItem: "Copy the item as plain text",
    copyItemMarkdown: "Copy the item as Markdown",
    export: "Export the conversation as Markdown to a file",
    cycleDensity: "Cycle the density",
    previousPrompt: "Previous prompt",
    nextPrompt: "Next prompt",
    previousTool: "Previous tool call",
    nextTool: "Next tool call",
    openLink: "Open the item's link, or choose one of its links",
    expandOutput: "Show the tool call's whole output, or its snippet",
  },
  card: {
    choose1: "Select option 1",
    choose2: "Select option 2",
    choose3: "Select option 3",
    choose4: "Select option 4",
    choose5: "Select option 5",
    choose6: "Select option 6",
    choose7: "Select option 7",
    choose8: "Select option 8",
    choose9: "Select option 9",
    previous: "Previous option",
    next: "Next option",
    confirm: "Answer with the selected option",
    back: "Back to the prompt box",
    scrollUp: "Scroll the preview up a line",
    scrollDown: "Scroll the preview down a line",
    pageUp: "Scroll the preview up a page",
    pageDown: "Scroll the preview down a page",
    top: "Preview: first line",
    bottom: "Preview: last line",
    grow: "Grow the permission card, or return it to its size",
  },
  overlay: {
    up: "Previous entry",
    down: "Next entry",
    pageUp: "Up a page",
    pageDown: "Down a page",
    first: "First entry",
    last: "Last entry",
    choose: "Run or apply the selected entry",
    close: "Close",
    clear: "Clear the filter",
    toggleScope: "Sessions of this directory or of all directories",
  },
  elicitation: {
    up: "Previous choice",
    down: "Next choice",
    choose1: "Choose 1",
    choose2: "Choose 2",
    choose3: "Choose 3",
    choose4: "Choose 4",
    choose5: "Choose 5",
    choose6: "Choose 6",
    choose7: "Choose 7",
    choose8: "Choose 8",
    choose9: "Choose 9",
    toggle: "Tick or untick the choice",
    confirm: "Next question, or submit the answers",
    back: "Skip the question, or decline",
  },
  selection: {
    copy: "Copy the selection, or the item under the cursor",
    copyRich: "Copy the item under the cursor as Markdown (a selection as plain text)",
    clear: "Clear the selection",
  },
  find: {
    next: "Next hit",
    previous: "Previous hit",
    close: "Close find and return to where you were",
    conversation: "Close find and move to the conversation at the hit",
    clear: "Clear the query",
  },
};

/** The command name of an action in the catalogue: `global.repaint`, `card.confirm`. */
export function commandName<C extends KeyContext>(context: C, action: KeyAction<C>): string {
  return `${context}.${action}`;
}

/** A key map as written (for example in a config file): any spelling of a key; `null` unbinds a
 *  default key (so an action can be bound to another key instead). */
export type KeyMapInput = { readonly [C in KeyContext]?: Readonly<Record<string, string | null>> };

/** A validated key map: normalised keys, known actions, no conflicts. */
export type KeyMap = { readonly [C in KeyContext]: Readonly<Record<string, KeyAction<C>>> };

/**
 * Defaults (design 6.6). Shift+Enter arrives as `shift+return` (kitty `CSI 13;2u` and xterm
 * modifyOtherKeys `CSI 27;2;13~`) or as `meta+return` (JetBrains `ESC CR`); Ctrl+J as `linefeed`
 * (legacy `\n`) or `ctrl+j` (kitty); Ctrl+Enter as `linefeed` or `ctrl+return`. See docs/phase-0-notes/keys.md.
 */
export const DEFAULT_KEY_MAP_INPUT = {
  global: {
    escape: "escape",
    "ctrl+d": "detach",
    tab: "toggleFocus",
    "ctrl+o": "toggleTool",
    "ctrl+l": "repaint",
    f2: "toggleMouse",
    pageup: "pageUp",
    pagedown: "pageDown",
    "ctrl+p": "palette",
    "ctrl+f": "find",
    f3: "findNext",
    "shift+f3": "findPrevious",
    "shift+tab": "cycleMode",
    "ctrl+t": "cycleThoughtLevel",
    f1: "keyHelp",
  },
  prompt: {
    return: "submit",
    "shift+return": "newline",
    "meta+return": "newline",
    // Ctrl+Enter: a line feed (`linefeed`, as Ctrl+J) in Windows Terminal 1.24 and older, and
    // `CSI 13;5u` (`ctrl+return`) from 1.25 and in any terminal with the kitty keyboard protocol
    // (windows-support design D7). IntelliJ and PhpStorm send a plain `\r` for it, which submits.
    "ctrl+return": "newline",
    linefeed: "newline",
    "ctrl+j": "newline",
    up: "lineUp",
    down: "lineDown",
    "?": "palette",
    "/": "agentCommands",
    home: "first",
    end: "last",
    "ctrl+v": "paste",
    "ctrl+shift+v": "paste",
    "meta+v": "paste",
    "shift+left": "selectLeft",
    "shift+right": "selectRight",
    "shift+up": "selectUp",
    "shift+down": "selectDown",
    "shift+home": "selectHome",
    "shift+end": "selectEnd",
    "ctrl+shift+left": "selectWordLeft",
    "ctrl+shift+right": "selectWordRight",
    "ctrl+a": "selectAll",
    "meta+shift+left": "selectWordLeft",
    "meta+shift+right": "selectWordRight",
    "ctrl+x": "cut",
    "ctrl+z": "undo",
    "super+z": "undo",
    "ctrl+y": "redo",
    "ctrl+shift+z": "redo",
    "super+shift+z": "redo",
  },
  conversation: {
    up: "up",
    k: "up",
    down: "down",
    j: "down",
    home: "first",
    g: "first",
    end: "last",
    "shift+g": "last",
    return: "toggle",
    escape: "back",
    y: "copyItem",
    "shift+y": "copyItemMarkdown",
    e: "export",
    v: "cycleDensity",
    "{": "previousPrompt",
    "}": "nextPrompt",
    "[": "previousTool",
    "]": "nextTool",
    o: "openLink",
    a: "expandOutput",
  },
  card: {
    "1": "choose1",
    "2": "choose2",
    "3": "choose3",
    "4": "choose4",
    "5": "choose5",
    "6": "choose6",
    "7": "choose7",
    "8": "choose8",
    "9": "choose9",
    left: "previous",
    right: "next",
    return: "confirm",
    escape: "back",
    up: "scrollUp",
    down: "scrollDown",
    pageup: "pageUp",
    pagedown: "pageDown",
    home: "top",
    end: "bottom",
    "ctrl+o": "grow",
  },
  overlay: {
    up: "up",
    down: "down",
    pageup: "pageUp",
    pagedown: "pageDown",
    home: "first",
    end: "last",
    return: "choose",
    escape: "close",
    "ctrl+u": "clear",
    tab: "toggleScope",
  },
  elicitation: {
    up: "up",
    down: "down",
    "1": "choose1",
    "2": "choose2",
    "3": "choose3",
    "4": "choose4",
    "5": "choose5",
    "6": "choose6",
    "7": "choose7",
    "8": "choose8",
    "9": "choose9",
    space: "toggle",
    return: "confirm",
    escape: "back",
  },
  selection: {
    "ctrl+c": "copy",
    "ctrl+shift+c": "copyRich",
    escape: "clear",
  },
  find: {
    return: "next",
    "shift+return": "previous",
    "meta+return": "previous",
    // Ctrl+Enter as in the prompt box: `linefeed` in Windows Terminal 1.24 and older, `ctrl+return`
    // from 1.25 (kitty keyboard protocol), where Shift+Enter does not arrive in 1.24.
    "ctrl+return": "previous",
    linefeed: "previous",
    escape: "close",
    tab: "conversation",
    "ctrl+u": "clear",
  },
} as const satisfies KeyMapInput;

export class KeyMapError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`invalid key map:\n  ${problems.join("\n  ")}`);
    this.name = "KeyMapError";
  }
}

const MODIFIER_ALIASES: Record<string, "ctrl" | "meta" | "shift" | "super"> = {
  ctrl: "ctrl",
  control: "ctrl",
  meta: "meta",
  alt: "meta",
  option: "meta",
  opt: "meta",
  shift: "shift",
  super: "super",
  cmd: "super",
};
const MODIFIER_ORDER = ["ctrl", "meta", "shift", "super"] as const;

const NAME_ALIASES: Record<string, string> = {
  enter: "return",
  esc: "escape",
  del: "delete",
  pgup: "pageup",
  pgdn: "pagedown",
  pgdown: "pagedown",
  spacebar: "space",
};

/** Canonical form of a key: lower case, modifiers as `ctrl+meta+shift+super+name`. Throws on nonsense. */
export function normaliseKey(key: string): string {
  const parts = key.trim().toLowerCase().split("+");
  // A trailing "+" names the plus key itself ("ctrl++").
  if (parts.length > 1 && parts.at(-1) === "" && parts.at(-2) === "") parts.splice(-2, 2, "+");
  const last = parts.pop()!.trim();
  if (last === "") throw new Error(`'${key}' is not a key`);
  const mods = new Set<string>();
  for (const raw of parts) {
    const mod = MODIFIER_ALIASES[raw.trim()];
    if (!mod) throw new Error(`'${key}': '${raw.trim()}' is not a modifier`);
    mods.add(mod);
  }
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), NAME_ALIASES[last] ?? last].join("+");
}

function isAction<C extends KeyContext>(context: C, action: string): action is KeyAction<C> {
  return (KEY_ACTIONS[context] as readonly string[]).includes(action);
}

interface Validated {
  map: KeyMap;
  /** Keys bound to `null` in each context. */
  unbound: Record<KeyContext, Set<string>>;
}

function validate(input: KeyMapInput): Validated {
  const problems: string[] = [];
  const out = Object.fromEntries(KEY_CONTEXTS.map((c) => [c, {}])) as Record<KeyContext, Record<string, string>>;
  const unbound = Object.fromEntries(KEY_CONTEXTS.map((c) => [c, new Set<string>()])) as Record<KeyContext, Set<string>>;
  for (const [context, bindings] of Object.entries(input)) {
    if (!(KEY_CONTEXTS as readonly string[]).includes(context)) {
      problems.push(`unknown context '${context}' (expected one of ${KEY_CONTEXTS.join(", ")})`);
      continue;
    }
    const ctx = context as KeyContext;
    const seen = new Map<string, { key: string; action: string | null }>();
    for (const [key, action] of Object.entries(bindings ?? {})) {
      let norm: string;
      try {
        norm = normaliseKey(key);
      } catch (error) {
        problems.push(`${ctx}: ${(error as Error).message}`);
        continue;
      }
      const previous = seen.get(norm);
      if (previous && previous.action !== action) {
        const name = (a: string | null) => (a === null ? "nothing (null)" : `'${a}'`);
        problems.push(`${ctx}: conflict on ${norm}: bound to both ${name(previous.action)} and ${name(action)}`);
        continue;
      }
      seen.set(norm, { key, action });
      if (action === null) {
        unbound[ctx].add(norm);
        continue;
      }
      if (!isAction(ctx, action)) {
        problems.push(`${ctx}: unknown action '${action}' for ${norm} (expected one of ${KEY_ACTIONS[ctx].join(", ")})`);
        continue;
      }
      out[ctx][norm] = action;
    }
  }
  if (problems.length > 0) throw new KeyMapError(problems);
  return { map: out as KeyMap, unbound };
}

/**
 * Validates one key map object: known contexts and actions, parsable keys, and no key bound to
 * two different actions in one context (two spellings of the same key count as the same key).
 * Every problem is collected; throws `KeyMapError` naming each. Keys bound to `null` are left out.
 */
export function validateKeyMap(input: KeyMapInput): KeyMap {
  return validate(input).map;
}

/**
 * Loads a key map: validates `overrides` on its own (so conflicts inside it are reported), then
 * lays it over the defaults. An override replaces the default binding of the same key, and
 * `null` removes it; an action may keep several keys. Binding detach to Ctrl+Q instead of Ctrl+D
 * is `{ global: { "ctrl+q": "detach", "ctrl+d": null } }`.
 */
export function loadKeyMap(overrides: KeyMapInput = {}, base: KeyMapInput = DEFAULT_KEY_MAP_INPUT): KeyMap {
  const defaults = validateKeyMap(base);
  const user = validate(overrides);
  const merged = {} as Record<KeyContext, Record<string, string>>;
  for (const context of KEY_CONTEXTS) {
    merged[context] = { ...defaults[context], ...user.map[context] };
    for (const key of user.unbound[context]) delete merged[context][key];
  }
  return merged as KeyMap;
}

export const DEFAULT_KEY_MAP: KeyMap = loadKeyMap();

/** Keys bound to `action` in `context`, in map order. */
export function keysFor<C extends KeyContext>(map: KeyMap, context: C, action: KeyAction<C>): string[] {
  return Object.entries(map[context])
    .filter(([, a]) => a === action)
    .map(([key]) => key);
}

const MODIFIER_LABELS: Record<string, string> = { meta: "alt" };
const NAME_LABELS: Record<string, string> = {
  return: "enter",
  escape: "esc",
  linefeed: "ctrl+j",
  pageup: "pgup",
  pagedown: "pgdn",
};

/**
 * Display label for a key, the one source of every key acp-tui shows: fully lower case (Marcus,
 * 11 October 2026; mvp-chrome-and-keys task 12.8), `ctrl+c` -> `ctrl+c`, `shift+return` ->
 * `shift+enter`, `meta+v` -> `alt+v`, `escape` -> `esc`, `pageup` -> `pgup`. Prose in the docs
 * keeps `Ctrl+C`; only what is drawn is lower case.
 */
export function keyLabel(key: string): string {
  const parts = normaliseKey(key).split("+");
  const name = parts.pop()!;
  return [...parts.map((m) => MODIFIER_LABELS[m] ?? m), NAME_LABELS[name] ?? name].join("+");
}

/** Label of the first key bound to `action`, or null when it has none. */
export function actionLabel<C extends KeyContext>(map: KeyMap, context: C, action: KeyAction<C>): string | null {
  const key = keysFor(map, context, action)[0];
  return key === undefined ? null : keyLabel(key);
}
