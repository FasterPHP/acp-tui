// The terminal signals of mvp-chrome-and-keys group 7 as one piece for `app/run.tsx`: the title
// (title.ts), attention (attention.ts) and the wheel with the mouse off (mouse-off.ts). `install`
// runs once the renderer exists; `restore` is the lifecycle's `finalReset`, written after
// `destroy()` and before the exit text on every exit path, and is empty if `install` never ran.
import { createEffect, createRoot, on } from "solid-js";
import type { CliRenderer } from "@opentui/core";
import type { DebugLogger } from "../log.ts";
import type { SessionStore } from "../session/store.ts";
import { DEFAULT_ATTENTION, installAttention, type AttentionSettings } from "./attention.ts";
import { ALTERNATE_SCROLL_QUERY, createAlternateScroll, installNotchFilter, type AlternateScroll } from "./mouse-off.ts";
import { installTerminalTitle, type TerminalTitle } from "./title.ts";
import { createTitleSlots, titleSlotDir, type TitleSlots } from "./title-slot.ts";
import { rendererWrite } from "./write-out.ts";

export interface TerminalSignalsOptions {
  readonly store: Pick<SessionStore, "snapshot" | "onChange" | "ui">;
  /** The attention settings, or a function reading them at each signal (`attention.*`); default
   *  `DEFAULT_ATTENTION`. */
  readonly attention?: AttentionSettings | (() => AttentionSettings);
  /** `title.format`, read at each change (default: the title's default format). */
  readonly titleFormat?: () => string;
  /** The directory the session starts in, for the title until the session reports its own. */
  readonly directory?: string | null;
  /** For tests: the title's instance slots (default: the files under the state directory). */
  readonly titleSlots?: TitleSlots;
  /** For tests: the clock of turn lengths. */
  readonly now?: () => number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Default `process.platform` (tests). */
  readonly platform?: NodeJS.Platform;
  /** Where a dropped write is logged (write-out.ts). */
  readonly logger?: DebugLogger;
}

export interface TerminalSignals {
  install(renderer: CliRenderer): void;
  /** The restoring output for the final reset. */
  restore(): string;
  /**
   * Sets the title again once a harness has started (windows-support D5): on Windows, npm's `.cmd`
   * shims run `title %COMSPEC%` as the harness starts, which renames the tab to `cmd.exe`. Only on
   * Windows: on Linux and macOS a harness's output is a pipe, never the terminal, so nothing can
   * retitle the tab and writing the same title again would only be noise. Nothing until `install`
   * has run.
   */
  reassertTitle(): void;
}

export function createTerminalSignals(options: TerminalSignalsOptions): TerminalSignals {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const store = options.store;
  const removers: (() => void)[] = [];
  let title: TerminalTitle | null = null;
  let alternate: AlternateScroll | null = null;

  return {
    install(renderer) {
      const write = rendererWrite(renderer, options.logger);
      const installed = installTerminalTitle(renderer, store, write, {
        ...(options.titleFormat ? { format: options.titleFormat } : {}),
        ...(options.directory !== undefined ? { directory: options.directory } : {}),
        slots: options.titleSlots ?? createTitleSlots({ dir: titleSlotDir(env) }),
      });
      title = installed;
      // A reload of `title.format` sets the title again.
      if (options.titleFormat) {
        const format = options.titleFormat;
        removers.push(
          createRoot((dispose) => {
            createEffect(on(format, () => installed.refresh(), { defer: true }));
            return dispose;
          }),
        );
      }
      removers.push(
        installAttention(renderer, store, { settings: options.attention ?? DEFAULT_ATTENTION, write, ...(options.now ? { now: options.now } : {}) }),
      );
      removers.push(installNotchFilter(renderer, () => store.ui.mouse));
      if (env["TERM_PROGRAM"] === "zed") {
        const scroll = createAlternateScroll(write);
        alternate = scroll;
        // The reply to the query below is taken before OpenTUI's parser sees it.
        renderer.prependInputHandler((sequence) => scroll.reply(sequence));
        write(ALTERNATE_SCROLL_QUERY);
        removers.push(
          createRoot((dispose) => {
            createEffect(on(() => store.ui.mouse, (policy) => scroll.policy(policy)));
            return dispose;
          }),
        );
      }
    },
    reassertTitle() {
      if (platform === "win32") title?.reassert();
    },
    restore() {
      for (const remove of removers.splice(0)) remove();
      return (title?.restore() ?? "") + (alternate?.restore() ?? "");
    },
  };
}
