// The terminal signals of mvp-chrome-and-keys group 7 as one piece for `app/run.tsx`: the title
// (title.ts), attention (attention.ts) and the wheel with the mouse off (mouse-off.ts). `install`
// runs once the renderer exists; `restore` is the lifecycle's `finalReset`, written after
// `destroy()` and before the exit text on every exit path, and is empty if `install` never ran.
import { createEffect, createRoot, on } from "solid-js";
import type { CliRenderer } from "@opentui/core";
import type { HarnessActivity } from "../agent/harness-activity.ts";
import type { DebugLogger } from "../log.ts";
import type { ConsoleTitleReader } from "../platform/windows-console-title.ts";
import type { SessionStore } from "../session/store.ts";
import { DEFAULT_ATTENTION, wireAttention, type AttentionRenderer, type AttentionSettings } from "./attention.ts";
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
  /** For tests: runs `run` after `ms` and returns what cancels it (default `setTimeout`, unref'd). */
  readonly schedule?: (run: () => void, ms: number) => () => void;
  /**
   * Reads the console's title (Windows): default `GetConsoleTitleW` through `bun:ffi` when the
   * platform is the real one and Windows, otherwise none; null turns the title watch off (tests).
   */
  readonly consoleTitle?: ConsoleTitleReader | null;
  /** For tests: runs `run` every `ms` and returns what stops it (default `setInterval`, unref'd). */
  readonly every?: (run: () => void, ms: number) => () => void;
}

/** How long a tool call's end waits to set the title again, so a burst of them is one write (ms). */
export const TITLE_REASSERT_DELAY_MS = 200;

/** How often the console's title is read on Windows, to set acp-tui's again if it changed (ms). */
export const TITLE_WATCH_INTERVAL_MS = 500;
/** Writes for one foreign title before the watch leaves it be (a title the console will not take). */
export const TITLE_WATCH_MAX_WRITES = 3;

function defaultEvery(run: () => void, ms: number): () => void {
  const timer = setInterval(run, ms);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** The Win32 reader, required (not imported) so that only Windows loads `bun:ffi`; null when it
 *  cannot be opened, which leaves the moments of `harnessActivity` as the only writes. */
function defaultConsoleTitle(options: TerminalSignalsOptions): ConsoleTitleReader | null {
  if (options.consoleTitle !== undefined) return options.consoleTitle;
  if (options.platform !== undefined || process.platform !== "win32") return null;
  try {
    const module = require("../platform/windows-console-title.ts") as typeof import("../platform/windows-console-title.ts");
    return module.consoleTitleReader();
  } catch (error) {
    options.logger?.log({ event: "title_watch", state: "unavailable", error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

function defaultSchedule(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

export interface TerminalSignals {
  install(renderer: CliRenderer): void;
  /** The restoring output for the final reset. */
  restore(): string;
  /**
   * Sets the title again once a harness has started (windows-support D5): on Windows, npm's `.cmd`
   * shims run `title %COMSPEC%` as the harness starts, which renames the tab to `cmd.exe`. Only on
   * Windows: on Linux and macOS a harness's output is a pipe, never the terminal, so nothing can
   * retitle the tab and writing the same title again would only be noise. A call before `install`
   * (a harness started before the renderer, as `--resume <id>` and `--continue` do) is
   * remembered and acted on as `install` finishes the title.
   */
  reassertTitle(): void;
  /**
   * The same for a moment when a harness may have retitled the console (windows-support D5, the
   * built-in Claude harness sets `claude` as its worker starts, and a command a tool runs can set
   * its own): a session created or opened and a turn that ended set the title at once, a tool
   * call that ended after `TITLE_REASSERT_DELAY_MS`, a burst of them as one write. Windows only,
   * for the reason `reassertTitle` gives; nothing on Linux and macOS. Between these moments the
   * title watch covers the rest: on Windows the console's title is read every
   * `TITLE_WATCH_INTERVAL_MS` and acp-tui's set again when it differs (a harness's process that
   * names the tab after the turn has ended, a shim's `title` before `initialize` is answered).
   */
  harnessActivity(activity: HarnessActivity): void;
}

export function createTerminalSignals(options: TerminalSignalsOptions): TerminalSignals {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const store = options.store;
  const removers: (() => void)[] = [];
  let title: TerminalTitle | null = null;
  let alternate: AlternateScroll | null = null;
  // A harness answered `initialize` before the title existed (Windows only).
  let reassertAfterInstall = false;
  const schedule = options.schedule ?? defaultSchedule;
  let cancelPending: (() => void) | null = null;
  let stopWatch: (() => void) | null = null;
  const reassert = (): void => {
    if (platform !== "win32") return;
    if (title) title.reassert();
    else reassertAfterInstall = true;
  };

  return {
    install(renderer) {
      const write = rendererWrite(renderer, options.logger);
      const given = options.attention ?? DEFAULT_ATTENTION;
      const attentionSettings = typeof given === "function" ? given : () => given;
      const wired = wireAttention(renderer as unknown as AttentionRenderer, store, { settings: given, write, ...(options.now ? { now: options.now } : {}) });
      removers.push(wired.remove);
      const markerOn = (): boolean => attentionSettings().titleMarker !== false;
      const installed = installTerminalTitle(renderer, store, write, {
        ...(options.titleFormat ? { format: options.titleFormat } : {}),
        ...(options.directory !== undefined ? { directory: options.directory } : {}),
        slots: options.titleSlots ?? createTitleSlots({ dir: titleSlotDir(env) }),
        attention: { pending: () => wired.attention.pending, onPending: (listener) => wired.attention.onPending(listener), enabled: markerOn },
      });
      title = installed;
      if (reassertAfterInstall) {
        reassertAfterInstall = false;
        installed.reassert();
      }
      const readTitle = platform === "win32" ? defaultConsoleTitle(options) : null;
      if (readTitle) {
        // The foreign title last seen and how many writes it has had: a console that will not
        // take acp-tui's title (one it rewrites, say) gets a few writes, not one every interval.
        let foreign: { text: string; writes: number } | null = null;
        stopWatch = (options.every ?? defaultEvery)(() => {
          const ours = installed.current();
          const shown = ours === "" ? null : readTitle();
          if (shown === null || shown === ours) {
            foreign = null;
            return;
          }
          if (foreign?.text !== shown) foreign = { text: shown, writes: 0 };
          if (foreign.writes >= TITLE_WATCH_MAX_WRITES) return;
          foreign.writes += 1;
          options.logger?.log({ event: "title_watch", state: "restored", writes: foreign.writes });
          installed.reassert();
        }, TITLE_WATCH_INTERVAL_MS);
      }
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
      // A reload of `attention.title_marker` sets the title again.
      removers.push(
        createRoot((dispose) => {
          createEffect(on(markerOn, () => installed.refresh(), { defer: true }));
          return dispose;
        }),
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
    reassertTitle: reassert,
    harnessActivity(activity) {
      if (platform !== "win32") return;
      if (activity !== "tool") {
        // Covers a title that is already waiting to be set.
        cancelPending?.();
        cancelPending = null;
        reassert();
        return;
      }
      if (cancelPending) return;
      cancelPending = schedule(() => {
        cancelPending = null;
        reassert();
      }, TITLE_REASSERT_DELAY_MS);
    },
    restore() {
      cancelPending?.();
      cancelPending = null;
      stopWatch?.();
      stopWatch = null;
      for (const remove of removers.splice(0)) remove();
      return (title?.restore() ?? "") + (alternate?.restore() ?? "");
    },
  };
}
