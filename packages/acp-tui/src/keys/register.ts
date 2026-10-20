// Registration of the key map with @opentui/keymap (design D8). Each context
// becomes one layer: `global` has no target; `prompt`, `conversation` and
// `card` are scoped to the focused renderable and outrank the global layer.
// Every action with a handler is registered once as a command in the
// keymap's command catalogue (`<context>.<action>`, with its title from
// COMMAND_TITLES), and each of its keys is a binding naming that command, so
// the command palette (task 13.2) and the help card read one catalogue.
// A matched binding calls preventDefault and stopPropagation, so the
// Textarea's own bindings (Enter newline, Meta+Return submit, Ctrl+D delete)
// never see a key we handle. A handler that returns false leaves the key
// unhandled, and it reaches the focused component as usual.
import type { KeyEvent, Renderable } from "@opentui/core";
import type { Binding, Command, Keymap } from "@opentui/keymap";
import type { KeyController } from "./controller.ts";
import { COMMAND_TITLES, commandName, keyLabel, keysFor, type KeyAction, type KeyContext, type KeyMap } from "./keymap.ts";
import { liveControl } from "./live.ts";

export type OpenTuiKeymap = Keymap<Renderable, KeyEvent>;

/** Handler for an action: false means "not handled, let the key through". */
export type ActionHandler = () => boolean | void;

export type ContextHandlers<C extends KeyContext> = Partial<Record<KeyAction<C>, ActionHandler>>;

/** Context layers outrank the global layer. */
export const CONTEXT_PRIORITY = 10;
export const GLOBAL_PRIORITY = 0;

/** A command in the catalogue: the keymap's command plus the fields acp-tui adds. */
export interface CatalogueCommand extends Command<Renderable, KeyEvent> {
  readonly context: KeyContext;
  readonly action: string;
  readonly title: string;
}

/** The commands and bindings of one context; actions without a handler are skipped. */
export function layerFor<C extends KeyContext>(
  keyMap: KeyMap,
  context: C,
  handlers: ContextHandlers<C>,
): { commands: CatalogueCommand[]; bindings: Binding<Renderable, KeyEvent>[] } {
  const commands: CatalogueCommand[] = [];
  const bindings: Binding<Renderable, KeyEvent>[] = [];
  const titles = COMMAND_TITLES[context] as Record<string, string>;
  for (const [action, handler] of Object.entries(handlers) as [KeyAction<C>, ActionHandler | undefined][]) {
    if (!handler) continue;
    const name = commandName(context, action);
    // A handler that returns false rejects the command, so the key reaches the focused component.
    commands.push({ name, context, action, title: titles[action] ?? action, run: () => handler() !== false });
  }
  const named = new Set(commands.map((c) => c.name));
  for (const [key, action] of Object.entries(keyMap[context]) as [string, KeyAction<C>][]) {
    const name = commandName(context, action);
    if (named.has(name)) bindings.push({ key, cmd: name });
  }
  return { commands, bindings };
}

/** One entry of the command catalogue as the palette lists it. */
export interface CatalogueEntry {
  readonly name: string;
  readonly context: KeyContext;
  readonly action: string;
  readonly title: string;
  /** Labels of the keys bound to it in the key map in use, in map order. */
  readonly keys: readonly string[];
}

/** Every command registered in `keymap` (whatever has focus), with its keys from `keyMap`. */
export function commandCatalogue(keymap: OpenTuiKeymap, keyMap: KeyMap): CatalogueEntry[] {
  return keymap
    .getCommands({ visibility: "registered" })
    .filter((c): c is CatalogueCommand => typeof c["context"] === "string" && typeof c["action"] === "string")
    .map((c) => ({
      name: c.name,
      context: c.context,
      action: c.action,
      title: c.title,
      keys: keysFor(keyMap, c.context, c.action as never).map(keyLabel),
    }));
}

export interface LayerOptions {
  /** Scope the layer to this renderable having focus; omit for a global layer. */
  target?: Renderable;
  /** `focus` (default): the target itself has focus; `focus-within`: it or a descendant has. */
  targetMode?: "focus" | "focus-within";
  priority?: number;
}

export function registerContext<C extends KeyContext>(
  keymap: OpenTuiKeymap,
  keyMap: KeyMap,
  context: C,
  handlers: ContextHandlers<C>,
  options: LayerOptions = {},
): () => void {
  const register = (map: KeyMap): (() => void) => {
    const { commands, bindings } = layerFor(map, context, handlers);
    if (options.target) {
      return keymap.registerLayer({
        target: options.target,
        targetMode: options.targetMode ?? "focus",
        priority: options.priority ?? CONTEXT_PRIORITY,
        commands,
        bindings,
      });
    }
    return keymap.registerLayer({ priority: options.priority ?? GLOBAL_PRIORITY, commands, bindings });
  };
  const live = liveControl(keyMap);
  if (!live) return register(keyMap);
  // A live key map (live.ts): the layer is registered again with each new map (a configuration
  // reload, mvp-configuration task 8.1). Every live layer does so in the order it first registered,
  // so layers of one priority keep their order.
  let remove = register(live.current());
  const unsubscribe = live.subscribe((map) => {
    remove();
    remove = register(map);
  });
  return () => {
    unsubscribe();
    remove();
  };
}

/**
 * Registers the global layer and the "any other key disarms" hook: every key press that is not
 * bound to `escape` or `detach` disarms a pending interrupt or detach confirmation (those keys
 * step the state machine themselves). With a live key map the exit keys follow each new map, and a
 * swap disarms what is armed (design D6: the key that would complete it may have changed).
 */
export function installGlobalKeys(keymap: OpenTuiKeymap, keyMap: KeyMap, controller: KeyController): () => void {
  const removeLayer = registerContext(keymap, keyMap, "global", controller.handlers);
  const matchers = (map: KeyMap) =>
    Object.entries(map.global)
      .filter(([, action]) => action === "escape" || action === "detach")
      .map(([key]) => keymap.createKeyMatcher(key));
  const live = liveControl(keyMap);
  let exitKeys = matchers(live ? live.current() : keyMap);
  const unsubscribe = live?.subscribe((map) => {
    exitKeys = matchers(map);
    controller.otherKey();
  });
  const removeIntercept = keymap.intercept("key", ({ event }) => {
    if (!exitKeys.some((matches) => matches(event))) controller.otherKey();
  });
  return () => {
    unsubscribe?.();
    removeIntercept();
    removeLayer();
  };
}
