// The App root: provides the app context and the key map, and fills the
// alternate screen with the screen layout (design D7): by default the
// conversation, the activity bar, the docked permission card, the prompt box
// and the status row, with the session view from the store.
import { createEffect, createMemo, on, onCleanup, Show, untrack, type JSX } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { Screen, type BlockComponent } from "../layout/Screen.tsx";
import type { BlockName, ResolvedLayout } from "../layout/layout.ts";
import { ActivityBar } from "../layout/ActivityBar.tsx";
import { KeysContext, type KeysContextValue } from "../keys/context.ts";
import { createKeyController } from "../keys/controller.ts";
import { DEFAULT_KEY_MAP, type KeyMap } from "../keys/keymap.ts";
import { hintsForKeyMap } from "../keys/hints.ts";
import { createLiveKeyMap, liveControl } from "../keys/live.ts";
import { KEYS_PROBLEM_CHANNEL, keysFromConfig } from "../keys/from-config.ts";
import type { InterruptSetting } from "../keys/settings.ts";
import type { HintRule } from "../layout/modules.ts";
import { installGlobalKeys } from "../keys/register.ts";
import { WindowedConversation } from "../conversation/window/WindowedConversation.tsx";
import { AppContext, type AppContextValue } from "./context.ts";
import { PermissionCard } from "./PermissionCard.tsx";
import { PromptBox } from "./PromptBox.tsx";
import { Splash } from "./Splash.tsx";

/** The app's block for each region of the layout. */
export const APP_BLOCKS: Record<BlockName, BlockComponent> = {
  conversation: (p) => <WindowedConversation scrollbar={p.layout.scrollbar} />,
  activity: ActivityBar,
  card: PermissionCard,
  prompt: PromptBox,
  // The find bar is mounted by `createFind` (src/find/); without it the block shows nothing.
  find: () => null,
};

export interface AppProps {
  context: AppContextValue;
  layout: ResolvedLayout;
  /** Replaces blocks (tests); merged over `APP_BLOCKS`. */
  blocks?: Partial<Record<BlockName, BlockComponent>>;
  /** A validated key map (`loadKeyMap`, tests); read once at mount, and then the configuration's
   *  `keys` are not applied. Without it the key map is the configuration's `keys` over the
   *  built-in map (`DEFAULT_KEY_MAP` without a configuration store), rebuilt on each reload. */
  keyMap?: KeyMap;
  /** Overrides the `interrupt` setting (tests); without it the configuration's is read at each
   *  Esc (live on a reload), or `double` without a configuration store. */
  interrupt?: InterruptSetting;
  /** Drawn over the screen, inside the app's contexts (the session list, the palette, selection,
   *  find and links). */
  overlay?: () => JSX.Element;
  /** More hint rules for the key map in use, after the app's (tests). */
  hints?: (keyMap: KeyMap) => readonly HintRule[];
}

export function App(props: AppProps): JSX.Element {
  // The conversation block is mounted afresh for each session a switch attaches (`ui.epoch`,
  // mvp-sessions task 7.4), so no scroll, height or mount state of the previous one survives,
  // and no component of the previous session outlives the items it reads: `store.replace`
  // removes them in the same batch as it moves the epoch on, and Solid disposes the old block
  // before its computations run again. The child must take the key: a keyed <Show> calls only a
  // function child with a parameter, and hands any other back unchanged, so with `() => ...`
  // nothing was remounted and the windowed list read removed items (IDE check 10.2).
  const blocks = createMemo(() => {
    const merged = { ...APP_BLOCKS, ...props.blocks };
    const Conversation = merged.conversation;
    // The splash is drawn over the conversation region while the session has no items
    // (mvp-chrome-and-keys task 4.7).
    const conversation: BlockComponent = (p) => (
      <>
        <Show when={props.context.store.ui.epoch + 1} keyed>
          {(_epoch: number) => <Conversation {...p} />}
        </Show>
        <Splash view={p.view} />
      </>
    );
    return { ...merged, conversation };
  });
  // Keys: one keymap per renderer; the global layer here, the prompt box and permission card
  // layers in their components.
  // The key map (mvp-configuration task 8.1): the configuration's `keys` merged over the built-in
  // map, as a live map (keys/live.ts) that a reload of `keys` swaps whole: every layer is then
  // registered again, hints and labels follow, and an armed two-press state is disarmed
  // (register.ts `installGlobalKeys`). The problems go into the store's `keys` channel before the
  // load notice reads them, and on a reload before the reload's problems are read (the effect runs
  // inside the store's signal write).
  const config = props.context.config;
  const fromConfig = () => {
    const store = config!;
    const result = keysFromConfig(store.config().keys, store.files());
    store.setProblems(KEYS_PROBLEM_CHANNEL, result.problems);
    return result.map;
  };
  const keyMap: KeyMap = props.keyMap ?? (config ? createLiveKeyMap(untrack(fromConfig)) : DEFAULT_KEY_MAP);
  const live = props.keyMap ? null : liveControl(keyMap);
  if (live && config) {
    // A memo, so that the swap runs only when the `keys` section itself changed: the store
    // notifies on a reload of any section (sections that did not change keep their objects), and
    // a swap disarms an armed two-press state (task 3.5).
    const keysSection = createMemo(() => config.config().keys);
    createEffect(on(keysSection, () => live.set(fromConfig()), { defer: true }));
  }
  const keymap = createDefaultOpenTuiKeymap(useRenderer());
  const controller = createKeyController({
    store: props.context.store,
    actions: props.context.actions,
    keyMap,
    ...(props.interrupt ? { interrupt: props.interrupt } : config ? { interrupt: () => config.config().interrupt } : {}),
    logger: props.context.logger,
  });
  const keys: KeysContextValue = { keymap, keyMap, controller };
  // Hints name the keys of the key map in use and the presses of the `interrupt` setting in use
  // (spec tui-keymap "Bindings are data"). A memo: a reloaded key map (a live one) or setting
  // re-runs it.
  const hints = createMemo(() => [...hintsForKeyMap(keyMap, controller.interrupt), ...(props.hints?.(keyMap) ?? [])]);
  // The `config` module's count (mvp-configuration task 3.4).
  const configProblems = () => config?.problems().length ?? 0;
  const removeGlobal = installGlobalKeys(keymap, keyMap, controller);
  // Once a load or resume has finished, the conversation shows the end of the history
  // (spec tui-sessions "Batched history replay"), even if it was scrolled while loading.
  const removeLoaded = props.context.store.onChange((change) => {
    if (change.previous.opening !== null && change.session.opening === null) controller.conversation()?.toBottom();
  });
  onCleanup(() => {
    removeGlobal();
    removeLoaded();
    controller.dispose();
  });
  return (
    <AppContext.Provider value={props.context}>
      <KeysContext.Provider value={keys}>
        <Screen layout={props.layout} view={{ ...props.context.store.view(), hints: hints(), configProblems: configProblems() }} theme={props.context.theme} blocks={blocks()} />
        {props.overlay?.()}
      </KeysContext.Provider>
    </AppContext.Provider>
  );
}
