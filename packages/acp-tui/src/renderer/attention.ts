// Attention signals (mvp-chrome-and-keys task 7.2, design D13; spec tui-screen "Attention
// signals"). acp-tui emits a signal of its own, never agent-supplied bytes, when the session
// enters `requires_action` and when a turn ends after running for at least the long-turn
// threshold. Nothing is emitted while the pane has focus: OpenTUI enables focus reporting
// (`CSI ? 1004 h`) and emits `focus` and `blur` for `CSI I` and `CSI O`; a terminal that never
// reports counts as unfocused, so a missing report errs towards a signal.
//
// The signal kind and the threshold are the settings `attention.signal` and
// `attention.long_turn_seconds` (mvp-configuration task 4.7), read at each signal through a
// function `app/run.tsx` gives (`attentionFromConfig`), so a reload applies at once; tests pass
// their own `AttentionSettings` to `createAttention`.
import type { Session } from "acp-model";
import type { CliRenderer } from "@opentui/core";

export type AttentionSignal = "bell" | "osc9" | "osc777" | "none";
export const ATTENTION_SIGNALS: readonly AttentionSignal[] = ["bell", "osc9", "osc777", "none"];

export interface AttentionSettings {
  /** What is written: BEL, an OSC 9 or OSC 777 desktop notification, or nothing. */
  readonly signal: AttentionSignal;
  /** A turn that ends after running at least this long signals (design 6.9: 30 s). */
  readonly longTurnSeconds: number;
}

export const DEFAULT_ATTENTION: AttentionSettings = { signal: "bell", longTurnSeconds: 30 };

/** The settings of the configuration's `attention` section. */
export function attentionFromConfig(attention: { readonly signal: AttentionSignal; readonly long_turn_seconds: number }): AttentionSettings {
  return { signal: attention.signal, longTurnSeconds: attention.long_turn_seconds };
}

/** Why a signal fires; the notification kinds say it in fixed text. */
export type AttentionReason = "requires_action" | "turn_ended";

const MESSAGES: Readonly<Record<AttentionReason, string>> = {
  requires_action: "needs your input",
  turn_ended: "turn finished",
};

/** The bytes of a signal: fixed sequences with fixed text, nothing from the agent. */
export function attentionSequence(signal: AttentionSignal, reason: AttentionReason): string {
  const message = MESSAGES[reason];
  switch (signal) {
    case "bell":
      return "\x07";
    case "osc9":
      return `\x1b]9;acp-tui: ${message}\x07`;
    case "osc777":
      return `\x1b]777;notify;acp-tui;${message}\x07`;
    case "none":
      return "";
  }
}

export interface AttentionOptions {
  /** The settings, or a function reading them at each signal (the configuration's `attention.*`,
   *  live on a reload); default `DEFAULT_ATTENTION`. */
  readonly settings?: AttentionSettings | (() => AttentionSettings);
  /** The escape output path (write-out.ts). */
  readonly write: (data: string) => void;
  /** Clock for turn lengths; default `Date.now`. */
  readonly now?: () => number;
}

export interface Attention {
  /** Focus in (`CSI I`) or out (`CSI O`). */
  setFocused(focused: boolean): void;
  /** One reducer step of the session (the store's `onChange`). */
  observe(session: Session, previous: Session): void;
  readonly focused: boolean;
}

export function createAttention(options: AttentionOptions): Attention {
  const given = options.settings ?? DEFAULT_ATTENTION;
  const settings = typeof given === "function" ? given : () => given;
  const now = options.now ?? Date.now;
  // Until the terminal reports focus in, the pane is taken as unfocused.
  let focused = false;
  let turnStartedAt: number | null = null;

  const emit = (reason: AttentionReason): void => {
    if (focused) return;
    const sequence = attentionSequence(settings().signal, reason);
    if (sequence !== "") options.write(sequence);
  };

  return {
    get focused() {
      return focused;
    },
    setFocused(value) {
      focused = value;
    },
    observe(session, previous) {
      const was = previous.state;
      const is = session.state;
      if (was === is) return;
      if (was === "idle") turnStartedAt = now();
      if (is === "requires_action") emit("requires_action");
      if (is === "idle") {
        const startedAt = turnStartedAt;
        turnStartedAt = null;
        if (startedAt !== null && now() - startedAt >= settings().longTurnSeconds * 1000) emit("turn_ended");
      }
    },
  };
}

/** What attention follows: the store's `onChange`. */
export interface AttentionFeed {
  onChange(listener: (change: { readonly session: Session; readonly previous: Session }) => void): () => void;
}

/** Wires attention to the renderer's focus events and the session; returns a remover. */
export function installAttention(
  renderer: Pick<CliRenderer, "on" | "off">,
  feed: AttentionFeed,
  options: AttentionOptions,
): () => void {
  const attention = createAttention(options);
  const focus = (): void => attention.setFocused(true);
  const blur = (): void => attention.setFocused(false);
  renderer.on("focus", focus);
  renderer.on("blur", blur);
  const stop = feed.onChange(({ session, previous }) => attention.observe(session, previous));
  return () => {
    renderer.off("focus", focus);
    renderer.off("blur", blur);
    stop();
  };
}
