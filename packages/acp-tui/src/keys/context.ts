// Keys context for components: the OpenTUI keymap, the validated key map and
// the key controller. Provided by <App>; the composer and the permission
// prompt register their own focus-scoped layers through it.
import { createContext, useContext } from "solid-js";
import type { KeyController } from "./controller.ts";
import type { KeyMap } from "./keymap.ts";
import type { OpenTuiKeymap } from "./register.ts";

export interface KeysContextValue {
  readonly keymap: OpenTuiKeymap;
  readonly keyMap: KeyMap;
  readonly controller: KeyController;
}

export const KeysContext = createContext<KeysContextValue>();

export function useKeys(): KeysContextValue {
  const value = useContext(KeysContext);
  if (!value) throw new Error("useKeys() called outside <App>");
  return value;
}
