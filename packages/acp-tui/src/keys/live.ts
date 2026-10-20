// The key map in use as a live object (mvp-configuration design D6 and D10):
// a `KeyMap` whose contexts are read from a Solid signal, so a reload of the
// configuration's `keys` swaps the whole map at once. Readers need not change:
// `keysFor`, `actionLabel` and the hint rules read the current map, and inside
// a reactive scope (a memo, a JSX expression) they re-run on a swap; the
// layers registered with `registerContext` (register.ts) subscribe and are
// re-registered with the new bindings, in their original order, so their
// relative precedence is kept. Kept apart from keymap.ts, which the
// configuration schema imports and which must not load Solid.
import { createSignal } from "solid-js";
import { KEY_CONTEXTS, type KeyContext, type KeyMap } from "./keymap.ts";

const LIVE = Symbol("acp-tui.liveKeyMap");

export interface LiveKeyMapControl {
  /** The map in use, read without tracking. */
  current(): KeyMap;
  /** Swaps the map in use; listeners run in the order they subscribed. */
  set(map: KeyMap): void;
  /** Called after each swap with the new map; returns the unsubscribe. */
  subscribe(listener: (map: KeyMap) => void): () => void;
}

export type LiveKeyMap = KeyMap & { readonly [LIVE]: LiveKeyMapControl };

/** A live key map starting as `initial`. */
export function createLiveKeyMap(initial: KeyMap): LiveKeyMap {
  const [map, setMap] = createSignal<KeyMap>(initial, { equals: false });
  let plain = initial;
  const listeners = new Set<(map: KeyMap) => void>();
  const control: LiveKeyMapControl = {
    current: () => plain,
    set(next) {
      plain = next;
      setMap(next);
      for (const listener of [...listeners]) listener(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const live = { [LIVE]: control } as Record<PropertyKey, unknown>;
  for (const context of KEY_CONTEXTS) {
    Object.defineProperty(live, context, { enumerable: true, get: () => map()[context as KeyContext] });
  }
  return live as unknown as LiveKeyMap;
}

/** The control of a live key map, or null for a plain one. */
export function liveControl(map: KeyMap): LiveKeyMapControl | null {
  return (map as Partial<LiveKeyMap>)[LIVE] ?? null;
}
