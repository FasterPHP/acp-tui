// The indexing question (auggie-1x-support design D16; specs tui-agent-session "Auggie's indexing
// line becomes a question", "Allowing Auggie to index", "Declining Auggie's indexing" and "Other
// indexing lines from Auggie", tui-layout "Indexing question card"). acp-tui's own question, drawn as
// the elicitation card is (its fill, frame and marker, the header word `Question`), with
// `from acp-tui` after the header word so it is never taken for the agent's.
//
// The host lasts for the run: the client handler of every harness with the `auggie-1` profile gives it
// the lines it takes (src/agent/indexing.ts). It collects the directories not yet answered; the card
// (docked by src/card/ChromeCard.tsx) shows them once no turn runs and no other card is open, and a
// line that arrives while it is open joins its list. Allow restarts the harness once with
// `--allow-indexing` (src/session/switch.ts `allowIndexing`); not now (or Esc) remembers the
// directories for the run. A directory whose line comes again after an allowing restart has a
// stored deny rule: a warning notice says so, and it is not asked about again. The file-limit and
// home-directory lines are warning notices, once each per run.
import { createEffect, createMemo, createSignal, onCleanup, onMount, For, type Accessor, type JSX } from "solid-js";
import type { BoxRenderable } from "@opentui/core";
import { sanitise } from "acp-model";
import type { IndexingLine, IndexingSink } from "../agent/indexing.ts";
import { useApp, useConfig } from "../app/context.ts";
import { cardMaxRows, cardSpanStyle, OPTION_GUARD_MS, type CardSegment } from "../app/permission.ts";
import { homeDirectory } from "../config/sources.ts";
import type { BlockProps } from "../layout/Screen.tsx";
import { shortenHome, type Segment } from "../layout/segments.ts";
import { useKeys } from "../keys/context.ts";
import { actionLabel, type KeyMap } from "../keys/keymap.ts";
import { registerContext, type ContextHandlers } from "../keys/register.ts";
import type { DebugLogger } from "../log.ts";
import { clean, elicitationRows, type CardPage, type ClientParagraph } from "./elicitation-form.ts";

/** The card's options, in order: `1 allow indexing` and `2 not now`. */
export const INDEXING_OPTIONS = ["allow indexing", "not now"] as const;

/** The muted words after the header word `Question`. */
export const FROM_ACP_TUI = "from acp-tui";

/** Where Auggie keeps its indexing rules. */
const SETTINGS = "~/.augment/settings.json";

/** The warning notice for a directory Auggie refused again after an allowing restart. */
export function deniedNotice(directory: string): string {
  return `Auggie has a rule never to index ${directory}; remove it in auggie or from indexingDenyDirs in ${SETTINGS}`;
}

/** A directory as the card and the notices name it: sanitised, the home directory as `~`. */
export function shownDirectory(directory: string, home: string | null = homeDirectory()): string {
  const text = clean(directory);
  return home ? shortenHome(text, home) : text;
}

/** The card's paragraphs for `directories` (already shown): one directory in the first sentence,
 *  several one to a row; then what allowing does, and that Auggie keeps it. */
export function indexingParagraphs(directories: readonly string[]): ClientParagraph[] {
  const lead: ClientParagraph[] =
    directories.length === 1
      ? [{ text: `Auggie is not indexing ${directories[0]}.`, token: "text" }]
      : [{ text: "Auggie is not indexing these directories:", token: "text" }, ...directories.map((d) => ({ text: d, token: "accent" as const, indent: 2 }))];
  return [...lead, { text: "Allow restarts with --allow-indexing; Auggie remembers your choice.", token: "text" }];
}

// -- Host -----------------------------------------------------------------------------------------

export interface IndexingQuestion {
  /** The directories asked about, in the order their lines arrived, as received. */
  readonly directories: readonly string[];
}

export interface IndexingHostOptions {
  /** Shows a warning notice. */
  notify(text: string): void;
  /** Allow: restarts the harness with `--allow-indexing` and reopens or starts the session;
   *  resolves with null once done, else with the failure (already shown). */
  allow(): Promise<string | null>;
  /** Whether allowing would start a new session (no answered prompt yet). */
  fresh(): boolean;
  readonly logger?: DebugLogger;
  /** For the shown directories; default the user's home. */
  readonly home?: string | null;
}

export interface IndexingHost extends IndexingSink {
  /** The open question, or null when no directory waits for an answer. */
  readonly current: Accessor<IndexingQuestion | null>;
  /** Answer `1 allow indexing`. */
  allow(): void;
  /** Answer `2 not now` (or Esc): the directories are remembered for the run. */
  decline(): void;
  readonly fresh: () => boolean;
  readonly home: string | null;
}

export function createIndexingHost(options: IndexingHostOptions): IndexingHost {
  const [pending, setPending] = createSignal<readonly string[]>([]);
  // Answered not now (or an allow that failed): dropped silently for the rest of the run.
  const declined = new Set<string>();
  // Answered allow: a line that comes again means a stored deny rule.
  const allowed = new Set<string>();
  // Told about a deny rule, or the file-limit or home-directory text: not again in the run.
  const settled = new Set<string>();
  const noticed = new Set<string>();
  const home = options.home === undefined ? homeDirectory() : options.home;

  const take = (line: IndexingLine): boolean => {
    options.logger?.log({ event: "indexing_line", kind: line.kind });
    if (line.kind !== "disabled") {
      if (!noticed.has(line.text)) {
        noticed.add(line.text);
        options.notify(sanitise(line.text, "approval"));
      }
      return true;
    }
    const dir = line.directory;
    if (declined.has(dir) || settled.has(dir) || pending().includes(dir)) return true;
    if (allowed.has(dir)) {
      settled.add(dir);
      options.notify(deniedNotice(shownDirectory(dir, home)));
      return true;
    }
    setPending((list) => [...list, dir]);
    return true;
  };

  return {
    take,
    current: () => (pending().length > 0 ? { directories: pending() } : null),
    allow() {
      const dirs = pending();
      if (dirs.length === 0) return;
      options.logger?.log({ event: "indexing_answered", answer: "allow", directories: dirs.length });
      for (const d of dirs) allowed.add(d);
      setPending([]);
      void options.allow().then(
        (failure) => {
          if (failure === null) return;
          // Nothing was allowed: not asked again in the run, and a later line is no deny rule.
          for (const d of dirs) {
            allowed.delete(d);
            declined.add(d);
          }
        },
        () => {
          for (const d of dirs) {
            allowed.delete(d);
            declined.add(d);
          }
        },
      );
    },
    decline() {
      const dirs = pending();
      if (dirs.length === 0) return;
      options.logger?.log({ event: "indexing_answered", answer: "not_now", directories: dirs.length });
      for (const d of dirs) declined.add(d);
      setPending([]);
    },
    fresh: options.fresh,
    home,
  };
}

// -- Card -----------------------------------------------------------------------------------------

function hintsFor(keyMap: KeyMap, selected: boolean): Segment[] {
  const enter = selected ? actionLabel(keyMap, "elicitation", "confirm") : actionLabel(keyMap, "elicitation", "down") ? "up/down" : null;
  const esc = actionLabel(keyMap, "elicitation", "back");
  return [
    ...(enter ? [{ text: `${enter} ${selected ? "choose" : "select"}`, token: "muted" as const }] : []),
    ...(esc ? [...(enter ? [{ text: " · ", token: "muted" as const, breakBefore: true }] : []), { text: `${esc} not now`, token: "muted" as const }] : []),
  ];
}

export interface IndexingCardProps extends BlockProps {
  readonly host: IndexingHost;
}

/** The docked indexing card for the host's open question (ChromeCard shows it only while one is). */
export function IndexingCard(props: IndexingCardProps): JSX.Element {
  const { store, theme } = useApp();
  const config = useConfig();
  const { keymap, keyMap, controller } = useKeys();
  let box: BoxRenderable | undefined;
  const appearedAt = Date.now();
  const guarded = () => Date.now() - appearedAt < OPTION_GUARD_MS;
  // Nothing is selected when the card opens: it appears just after the session starts, while the
  // user may already be typing, so a stray Enter must never allow Auggie to upload the code. Enter
  // does nothing until an arrow key has chosen an option; a digit answers at once.
  const [cursor, setCursor] = createSignal<number | null>(null);
  const focused = () => store.ui.focus === "card";

  onMount(() => {
    if (store.ui.promptEmpty) store.setFocus("card");
    else controller.notify(`acp-tui is asking something: ${actionLabel(keyMap, "global", "toggleFocus") ?? "tab"} to answer`);
  });
  onCleanup(() => {
    if (store.ui.focus === "card" && store.session.openPermissionId === null) store.setFocus("prompt");
  });

  const page = createMemo((): CardPage => {
    // Read again when the session changes (a prompt answered makes allowing reopen it).
    void store.session.state;
    const directories = (props.host.current()?.directories ?? []).map((d) => shownDirectory(d, props.host.home));
    return { kind: "client", subtitle: FROM_ACP_TUI, paragraphs: indexingParagraphs(directories), options: INDEXING_OPTIONS, cursor: cursor() };
  });

  const padding = () => config().cards.padding;
  const padRows = () => (props.spacing.cardPadding ? padding().rows : 0);
  // Never cut (spec tui-layout "Indexing question card"): the card takes the rows its text needs,
  // from the conversation if it must.
  const whole = createMemo(() => elicitationRows(page(), props.width, { focused: false, maxRows: Number.MAX_SAFE_INTEGER, hints: hintsFor(keyMap, cursor() !== null), padding: { rows: 0, columns: padding().columns } }).length);
  const rows = createMemo(() =>
    elicitationRows(page(), props.width, {
      focused: focused(),
      maxRows: Math.max(cardMaxRows(props.free, false), Math.min(whole(), Math.max(3, props.free))),
      hints: hintsFor(keyMap, cursor() !== null),
      padding: { rows: padRows(), columns: padding().columns },
    }),
  );
  createEffect(() => props.onClaim({ rows: whole(), padding: padding().rows }));
  createEffect(() => props.onHeight(rows().length - 2 * padRows()));

  const choose = (i: number): boolean => {
    if (i === 0) props.host.allow();
    else props.host.decline();
    return true;
  };
  const handlers: ContextHandlers<"elicitation"> = {
    up: () => (setCursor((c) => (c === null ? INDEXING_OPTIONS.length - 1 : Math.max(0, c - 1))), true),
    down: () => (setCursor((c) => (c === null ? 0 : Math.min(INDEXING_OPTIONS.length - 1, c + 1))), true),
    toggle: () => true,
    confirm: () => {
      const at = cursor();
      return guarded() || at === null ? true : choose(at);
    },
    back: () => choose(1),
  };
  for (let n = 1; n <= 9; n++) {
    handlers[`choose${n}` as keyof typeof handlers] = () => {
      if (n > INDEXING_OPTIONS.length || guarded()) return true;
      return choose(n - 1);
    };
  }
  onMount(() => {
    if (!box) return;
    onCleanup(registerContext(keymap, keyMap, "elicitation", handlers, { target: box }));
  });

  const spanStyle = (s: CardSegment) => cardSpanStyle(theme, s);
  return (
    <box ref={(r: BoxRenderable) => (box = r)} focusable focused={focused()} flexDirection="column" width="100%" backgroundColor={theme.color("surface.permission")}>
      <For each={rows()}>
        {(row) => (
          <text selectable={false} wrapMode="none" height={1} {...theme.text("text")}>
            <For each={row}>{(s) => <span style={spanStyle(s)}>{s.text}</span>}</For>
          </text>
        )}
      </For>
    </box>
  );
}
