// App context: what components need beyond their props. The session store is
// the read side; `actions` is the write side (the controller exists only once
// the agent has started, so components never hold it directly).
import { createContext, useContext, type Accessor } from "solid-js";
import { defaultConfig, type Config } from "../config/schema.ts";
import type { ConfigStore } from "../config/store.ts";
import type { ConversationScrollbar } from "../conversation/scrollbar.ts";
import type { DebugLogger } from "../log.ts";
import type { ClipboardReader } from "../selection/clipboard.ts";
import type { WheelStep } from "../renderer/wheel.ts";
import type { ResolvedTheme } from "../theme/index.ts";
import type { PromptResult, ResourceLinkBlock } from "../session/controller.ts";
import type { SplashLaunch } from "./splash.ts";
import type { AddDirectoryResult } from "../session/switch.ts";
import type { SessionStore } from "../session/store.ts";

export interface AppActions {
  /** Sends a prompt: the text, then a `resource_link` per file mention; `null` while the agent is
   *  still starting. */
  prompt(text: string, links?: readonly ResourceLinkBlock[]): PromptResult | null;
  /** Cancels the running turn (answers an open permission with `cancelled` first). */
  cancel(): void;
  /** Answers the open permission; false if none is open or the id is unknown. */
  answerPermission(optionId: string): boolean;
  /** Exit is detach: shuts the app down through the lifecycle (exit code 0). */
  exit(): void;
  /** Ctrl+L: repaints the whole screen. Until it exists the key controller shows a notice. */
  repaint?(): void;
  /** F2: flips the effective mouse policy between the chosen one and `off` (store and terminal
   *  modes); false when the chosen policy is `off` itself, so there is nothing to flip. */
  toggleMouse?(): boolean;
  /** Sends `session/set_config_option`; resolves once the agent's full list has replaced the
   *  session's (the config pickers, `src/overlay/`). Rejects with the agent's error. */
  setConfigOption?(configId: string, value: string | boolean): Promise<void>;
  /** Sends `session/set_mode` (legacy modes); resolves once the session's mode is `modeId`.
   *  Rejects with the agent's error. */
  setMode?(modeId: string): Promise<void>;
  /** Sends `session/set_model` (the older model state); resolves once the session's current
   *  model is `modelId`. Rejects with the agent's error. */
  setModel?(modelId: string): Promise<void>;
  /** `/add-dir <path>` (session/switch.ts `addDirectory`): resolves with what was done or why not.
   *  `confirm` is asked, with the text of the restart entry, only for a harness that must restart. */
  addDirectory?(path: string, confirm: (restart: string) => Promise<boolean>): Promise<AddDirectoryResult>;
}

export interface AppContextValue {
  readonly store: SessionStore;
  readonly actions: AppActions;
  readonly theme: ResolvedTheme;
  /** The debug log (`ACP_TUI_LOG`); absent in tests that do not need it. */
  readonly logger?: DebugLogger;
  /** Reads the system clipboard for the prompt box's `paste` (Ctrl+V; src/selection/clipboard.ts);
   *  absent in tests that do not need it, where paste says no clipboard could be read. */
  readonly clipboard?: ClipboardReader;
  /** Rows per wheel event for the terminal in use (renderer/wheel.ts); default `DEFAULT_WHEEL`. */
  readonly wheel?: WheelStep;
  /** The conversation's scroll bar (src/conversation/scrollbar.ts), shown while the layout's
   *  `scrollbar` is on; absent in tests that do not need it, where no bar is drawn. */
  readonly scrollbar?: ConversationScrollbar;
  /** The configuration store (src/config/store.ts); absent in tests that do not need it, where
   *  `useConfig()` gives the defaults. */
  readonly config?: ConfigStore;
  /** The harness and directory of the session in use or being started, for the splash's identity
   *  rows before the session reports its own (`splashLaunch`); absent in tests that do not need it. */
  readonly launch?: () => SplashLaunch;
}

export const AppContext = createContext<AppContextValue>();

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp() called outside <App>");
  return value;
}

const DEFAULT_CONFIG: Config = defaultConfig();

/** The effective configuration as a signal: the store's, or the defaults when there is none. */
export function useConfig(): Accessor<Config> {
  const config = useApp().config;
  return config ? config.config : () => DEFAULT_CONFIG;
}
