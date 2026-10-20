// The elicitation card (design 6.4 "Elicitation card"; decision 13,
// research/full-screen-synthesis.md 2.10), promoted from S6 (Phase 1a) by
// mvp-chrome-and-keys task 5.6 (design D7): mounted unconditionally (app/run.tsx,
// through src/card/ChromeCard.tsx), and acp-tui always advertises
// `clientCapabilities.elicitation` and answers `elicitation/create`.
//
// The host queues the agent's requests; the card shows the first in the
// docked card position, in the permission card's fill, warning frame and
// marker. Form mode asks one question at a time (`Question 1 of 3`): Up and
// Down move between choices, a digit picks one, Space ticks one of several,
// text is typed in place (Backspace deletes), Enter goes on, Esc skips an
// optional question (on a required one, Esc twice declines); then a review of
// the answers, where a digit returns to that question, Enter submits
// (`accept`) and Esc declines. URL mode shows the message and the whole
// sanitised URL with `1 open`, `2 copy`, `3 accept` and `4 decline` (Esc
// cancels): open starts the system opener with the URL as its one argument and
// accepts (over SSH it copies instead and says so; src/card/url.ts), copy puts
// the URL on the clipboard under the selection's clipboard rules and answers
// nothing; after accept the card waits for `elicitation/complete`, still
// offering open and copy. The header word is always `Question`, never
// `Permission`. Enter and digits are ignored for 300 ms after the card
// appears, as on the permission card.
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, For, Show, type Accessor, type JSX } from "solid-js";
import type { BoxRenderable, CliRenderer, KeyEvent } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import type { CompleteElicitationNotification, CreateElicitationRequest, CreateElicitationResponse, ElicitationContentValue } from "@agentclientprotocol/sdk";
import type { ElicitationHandler } from "../agent/client-handler.ts";
import { useApp, useConfig } from "../app/context.ts";
import { cardMaxRows, cardSpanStyle, OPTION_GUARD_MS, type CardSegment } from "../app/permission.ts";
import type { BlockProps } from "../layout/Screen.tsx";
import type { Segment } from "../layout/segments.ts";
import { useKeys } from "../keys/context.ts";
import { actionLabel, type KeyMap } from "../keys/keymap.ts";
import { registerContext, type ContextHandlers } from "../keys/register.ts";
import { spawnOpener, type Env } from "../links/open.ts";
import { copyToast, createCopier, type ClipboardModeSource, type Copier, type CopierOptions } from "../selection/clipboard.ts";
import { planUrlOpen } from "./url.ts";
import {
  clean,
  draftAnswer,
  elicitationRows,
  formContent,
  formQuestions,
  initialAnswers,
  requestKind,
  URL_OPTIONS,
  URL_WAITING_OPTIONS,
  validateAnswer,
  type CardPage,
  type Question,
} from "./elicitation-form.ts";

// -- Host -----------------------------------------------------------------------------------------

export interface ElicitationEntry {
  readonly id: number;
  readonly request: CreateElicitationRequest;
  /** `waiting`: a URL request the user accepted, until the agent reports it complete. */
  readonly stage: "open" | "waiting";
}

export interface ElicitationHost extends ElicitationHandler {
  /** The request the card shows (the first queued), or null. */
  readonly current: Accessor<ElicitationEntry | null>;
  /** Answers `entry`; an accepted URL request then waits for `elicitation/complete`. */
  answer(entry: ElicitationEntry, response: CreateElicitationResponse): void;
  /** Drops a waiting URL request from the card (it was already answered). */
  dismiss(entry: ElicitationEntry): void;
  /** Answers every open request with `cancel` and clears the card (the turn was cancelled). */
  cancelAll(): void;
}

export function createElicitationHost(): ElicitationHost {
  const [entries, setEntries] = createSignal<readonly ElicitationEntry[]>([]);
  const resolvers = new Map<number, (response: CreateElicitationResponse) => void>();
  let nextId = 1;
  const remove = (id: number) => setEntries((list) => list.filter((e) => e.id !== id));
  return {
    current: () => entries()[0] ?? null,
    create(request) {
      // A mode acp-tui does not know is declined at once (the capability names form and url only).
      if (requestKind(request) === "unknown") return Promise.resolve({ action: "decline" });
      return new Promise<CreateElicitationResponse>((resolve) => {
        const id = nextId++;
        resolvers.set(id, resolve);
        setEntries((list) => [...list, { id, request, stage: "open" }]);
      });
    },
    complete(notification: CompleteElicitationNotification) {
      setEntries((list) =>
        list.filter((e) => !(e.request.mode === "url" && "elicitationId" in e.request && e.request.elicitationId === notification.elicitationId)),
      );
    },
    answer(entry, response) {
      const resolve = resolvers.get(entry.id);
      resolvers.delete(entry.id);
      resolve?.(response);
      if (entry.request.mode === "url" && response.action === "accept") {
        setEntries((list) => list.map((e) => (e.id === entry.id ? { ...e, stage: "waiting" } : e)));
      } else {
        remove(entry.id);
      }
    },
    dismiss(entry) {
      remove(entry.id);
    },
    cancelAll() {
      for (const resolve of resolvers.values()) resolve({ action: "cancel" });
      resolvers.clear();
      setEntries([]);
    },
  };
}

// -- Card -----------------------------------------------------------------------------------------

/** Printable text from a key press, or null (control keys, chords). */
export function typedText(key: KeyEvent): string | null {
  if (key.ctrl || key.meta || !key.sequence) return null;
  if (["return", "enter", "tab", "escape", "backspace", "delete", "linefeed"].includes(key.name)) return null;
  return [...key.sequence].every((ch) => ch >= " " && ch !== "\x7f") ? key.sequence : null;
}

function hint(label: string | null, text: string, first = false): Segment[] {
  if (!label) return [];
  return [...(first ? [] : [{ text: " · ", token: "muted" as const, breakBefore: true }]), { text: `${label} ${text}`, token: "muted" as const }];
}

function hintsFor(page: CardPage, keyMap: KeyMap): Segment[] {
  const enter = actionLabel(keyMap, "elicitation", "confirm");
  const esc = actionLabel(keyMap, "elicitation", "back");
  const space = actionLabel(keyMap, "elicitation", "toggle");
  if (page.kind === "review") return [...hint(enter, "submit", true), ...hint(esc, "decline"), ...hint("1-9", "change")];
  if (page.kind === "url") return page.waiting ? [...hint(enter, "choose", true), ...hint(esc, "close")] : [...hint(enter, "choose", true), ...hint(esc, "cancel")];
  const q = page.question;
  const last = page.index === page.count - 1;
  return [
    ...hint(enter, last ? "review" : "next", true),
    ...(q.kind === "multi" ? hint(space, "tick") : []),
    ...hint(esc, q.required ? "twice: decline" : "skip"),
  ];
}

/** How the card opens and copies a URL (tests replace the opener and the clipboard). */
export interface UrlActionOptions {
  /** `--clipboard`; default `auto`. */
  readonly clipboard?: ClipboardModeSource;
  /** For the opener, SSH detection and the clipboard; default `process.env`. */
  readonly env?: Env;
  /** Replaces `Bun.spawn` of the opener. */
  readonly spawn?: (argv: readonly string[]) => void;
  /** Replaces the copier. */
  readonly copier?: (options: CopierOptions) => Copier;
}

export interface ElicitationCardProps extends BlockProps {
  readonly host: ElicitationHost;
  readonly urlActions?: UrlActionOptions;
}

/** The docked card for the host's current request; reports 0 rows when there is none. */
export function ElicitationCard(props: ElicitationCardProps): JSX.Element {
  // Keyed by request, so a URL request that moves to `waiting` keeps its card.
  const id = createMemo(() => props.host.current()?.id ?? null);
  return (
    <Show when={id()} keyed fallback={<Empty onHeight={props.onHeight} onClaim={props.onClaim} />}>
      {(_id: number) => {
        const first = props.host.current()!;
        return <RequestCard {...props} entry={() => props.host.current() ?? first} />;
      }}
    </Show>
  );
}

function Empty(props: { onHeight: (rows: number) => void; onClaim: BlockProps["onClaim"] }): JSX.Element {
  createEffect(() => {
    props.onHeight(0);
    props.onClaim({ rows: 0, padding: 0 });
  });
  return null;
}

function RequestCard(props: ElicitationCardProps & { entry: Accessor<ElicitationEntry> }): JSX.Element {
  const { store, theme, logger } = useApp();
  const config = useConfig();
  const { keymap, keyMap, controller } = useKeys();
  let box: BoxRenderable | undefined;
  const request = props.entry().request;
  const isForm = requestKind(request) === "form";
  const form = isForm ? (request as Extract<CreateElicitationRequest, { mode: "form" }>) : null;
  const questions: Question[] = form ? formQuestions(form.requestedSchema) : [];
  const formTitle = form ? clean(form.requestedSchema.title) : "";
  const message = clean(request.message);
  const url = request.mode === "url" && "url" in request ? clean(request.url) : "";
  // The URL as sent, opened only when it is exactly what the card shows.
  const rawUrl = request.mode === "url" && "url" in request && typeof request.url === "string" ? request.url : "";
  const env = props.urlActions?.env ?? process.env;
  const renderer = useRenderer() as CliRenderer;
  const copier = (props.urlActions?.copier ?? createCopier)({ renderer, mode: props.urlActions?.clipboard ?? "auto", env, ...(logger ? { logger } : {}) });
  onCleanup(() => void copier.dispose());
  const appearedAt = Date.now();
  const guarded = () => Date.now() - appearedAt < OPTION_GUARD_MS;

  const [step, setStep] = createSignal(0);
  const [cursor, setCursor] = createSignal(0);
  const [answers, setAnswers] = createSignal<Record<string, ElicitationContentValue | undefined>>(initialAnswers(questions));
  const [draft, setDraft] = createSignal("");
  const [ticked, setTicked] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [declineArmed, setDeclineArmed] = createSignal(false);

  const focused = () => store.ui.focus === "card";
  const question = () => questions[step()];
  const onReview = () => isForm && step() >= questions.length;

  /** Enters question `i` with its current answer loaded into the cursor, ticks or draft. */
  const enter = (i: number) => {
    batch(() => {
      setStep(i);
      setError(null);
      setDeclineArmed(false);
      const q = questions[i];
      if (!q) return;
      const value = answers()[q.key];
      setTicked(Array.isArray(value) ? [...value] : []);
      setDraft(value === undefined || Array.isArray(value) || q.kind === "boolean" || q.kind === "single" ? "" : String(value));
      const current = q.kind === "boolean" ? (value === undefined ? -1 : q.choices.findIndex((c) => c.value === String(value))) : q.choices.findIndex((c) => c.value === value);
      setCursor(Math.max(0, current));
    });
  };
  if (isForm) enter(0);

  // Focus: as the permission card, the card takes focus when the prompt box is empty.
  onMount(() => {
    if (store.ui.promptEmpty) store.setFocus("card");
    else controller.notify(`the agent is asking something: ${actionLabel(keyMap, "global", "toggleFocus") ?? "tab"} to answer`);
  });
  onCleanup(() => {
    if (store.ui.focus === "card" && store.session.openPermissionId === null) store.setFocus("prompt");
  });

  const page = createMemo((): CardPage => {
    if (!isForm) return { kind: "url", message, url, cursor: cursor(), waiting: props.entry().stage === "waiting" };
    const q = question();
    if (!q) return { kind: "review", formTitle, questions, answers: answers(), error: error() };
    const value = answers()[q.key];
    const chosen =
      q.kind === "multi" ? ticked() : q.kind === "single" && value !== undefined ? [String(value)] : q.kind === "boolean" && value !== undefined ? [String(value)] : [];
    return { kind: "question", index: step(), count: questions.length, formTitle, message, question: q, cursor: cursor(), chosen, draft: draft(), error: error() };
  });

  // The cards' padding (day-one-feedback): columns always, padding rows while the screen's spacing
  // keeps them; the claim is the card's whole content, so the spacing gives way before it.
  const padding = () => config().cards.padding;
  const padRows = () => (props.spacing.cardPadding ? padding().rows : 0);
  const rows = createMemo(() =>
    elicitationRows(page(), props.width, {
      focused: focused(),
      maxRows: cardMaxRows(props.free, false),
      hints: hintsFor(page(), keyMap),
      padding: { rows: padRows(), columns: padding().columns },
    }),
  );
  createEffect(() => {
    const claim = elicitationRows(page(), props.width, { focused: false, maxRows: Number.MAX_SAFE_INTEGER, hints: hintsFor(page(), keyMap), padding: { rows: 0, columns: padding().columns } }).length;
    props.onClaim({ rows: claim, padding: padding().rows });
  });
  createEffect(() => props.onHeight(rows().length - 2 * padRows()));

  const respond = (response: CreateElicitationResponse) => props.host.answer(props.entry(), response);

  /** Commits the current question's answer and moves on; false (with the problem shown) if invalid. */
  const commit = () => {
    const q = question();
    if (!q) return;
    let value: ElicitationContentValue | undefined;
    let problem: string | null;
    if (q.kind === "text" || q.kind === "number") {
      ({ value, error: problem } = draftAnswer(q, draft()));
    } else if (q.kind === "multi") {
      value = ticked();
      problem = validateAnswer(q, value);
    } else {
      const choice = q.choices[cursor()];
      value = choice === undefined ? undefined : q.kind === "boolean" ? choice.value === "true" : choice.value;
      problem = validateAnswer(q, value);
    }
    if (problem) {
      setError(problem);
      return;
    }
    setAnswers((a) => ({ ...a, [q.key]: value }));
    enter(step() + 1);
  };

  const urlOptions = () => (props.entry().stage === "waiting" ? URL_WAITING_OPTIONS : URL_OPTIONS);
  // Accepted: the waiting card offers open and copy, from the first.
  createEffect(on(() => props.entry().stage, (stage, previous) => void (stage === "waiting" && previous !== "waiting" && setCursor(0)), { defer: true }));

  /** Copies the URL under the clipboard rules; the notice names the path used. */
  const copyUrl = (why: "copy" | "ssh", host: string) => {
    void copier.copy(url, "elicitation").then((outcome) => {
      const how = copyToast(Array.from(url).length, outcome, copier.display);
      const text = why === "ssh" ? (how.ok ? `SSH session: copied the link to ${host} instead of opening it (${how.text})` : `SSH session: the link to ${host} was not opened, and ${how.text}`) : how.text;
      controller.notify(text, how.ok ? "muted" : "warning");
    });
  };
  /** Opens the URL with the system opener (or copies it over SSH); false when it was refused. */
  const openUrl = (): boolean => {
    const plan = rawUrl === url ? planUrlOpen(rawUrl, env) : { action: "refuse" as const, reason: "the link holds characters that are not shown" };
    logger?.log({ event: "elicitation_url", action: plan.action });
    if (plan.action === "refuse") {
      controller.notify(`not opened: ${plan.reason}`, "warning");
      return false;
    }
    if (plan.action === "copy") {
      copyUrl("ssh", plan.host);
      return true;
    }
    try {
      if (props.urlActions?.spawn) props.urlActions.spawn(plan.argv);
      else spawnOpener(plan.argv);
      controller.notify(`opening ${plan.host}`, "muted");
      return true;
    } catch (error) {
      controller.notify(`could not open ${plan.host}: ${plan.argv[0]} did not start (${(error as Error).message})`, "warning");
      return false;
    }
  };
  /** Runs the URL action under the cursor. */
  const runUrlAction = () => {
    const action = urlOptions()[cursor()];
    const waiting = props.entry().stage === "waiting";
    if (action === "open") {
      if (openUrl() && !waiting) respond({ action: "accept" });
    } else if (action === "copy") {
      copyUrl("copy", "");
    } else if (action === "accept") {
      respond({ action: "accept" });
    } else if (action === "decline") {
      respond({ action: "decline" });
    }
  };

  const move = (delta: number) => {
    const q = question();
    if (!isForm) {
      setCursor((c) => Math.max(0, Math.min(urlOptions().length - 1, c + delta)));
      return true;
    }
    if (!q || q.choices.length === 0) return false;
    setCursor((c) => Math.max(0, Math.min(q.choices.length - 1, c + delta)));
    return true;
  };

  const handlers: ContextHandlers<"elicitation"> = {
    up: () => move(-1),
    down: () => move(1),
    toggle: () => {
      const q = question();
      if (!q || q.kind !== "multi") return q?.kind === "text" || q?.kind === "number" ? false : true;
      const value = q.choices[cursor()]?.value;
      if (value !== undefined) setTicked((t) => (t.includes(value) ? t.filter((v) => v !== value) : [...t, value]));
      return true;
    },
    confirm: () => {
      if (guarded()) return true;
      if (!isForm) {
        runUrlAction();
        return true;
      }
      if (onReview()) {
        // Required answers are checked again: a default could have been invalid.
        const missing = questions.find((q) => validateAnswer(q, answers()[q.key]) !== null);
        if (missing) {
          setError(`${missing.title}: ${validateAnswer(missing, answers()[missing.key])}`);
          return true;
        }
        respond({ action: "accept", content: formContent(questions, answers()) });
        return true;
      }
      commit();
      return true;
    },
    back: () => {
      if (!isForm) {
        if (props.entry().stage === "waiting") props.host.dismiss(props.entry());
        else respond({ action: "cancel" });
        return true;
      }
      const q = question();
      if (!q) {
        respond({ action: "decline" });
        return true;
      }
      if (!q.required) {
        setAnswers((a) => ({ ...a, [q.key]: undefined }));
        enter(step() + 1);
        return true;
      }
      if (declineArmed()) respond({ action: "decline" });
      else {
        setDeclineArmed(true);
        setError(`${actionLabel(keyMap, "elicitation", "back") ?? "esc"} again declines the whole form`);
      }
      return true;
    },
  };
  for (let n = 1; n <= 9; n++) {
    handlers[`choose${n}` as keyof typeof handlers] = () => {
      if (!isForm) {
        if (n > urlOptions().length) return true;
        if (!guarded()) setCursor(n - 1);
        return true;
      }
      if (onReview()) {
        if (n <= questions.length) enter(n - 1);
        return true;
      }
      const q = question();
      if (!q || q.kind === "text" || q.kind === "number") return false;
      if (guarded() || n > q.choices.length) return true;
      setCursor(n - 1);
      if (q.kind === "multi") {
        const value = q.choices[n - 1]!.value;
        setTicked((t) => (t.includes(value) ? t.filter((v) => v !== value) : [...t, value]));
      }
      return true;
    };
  }

  // Typing into a text or number question (keys the layer did not take reach the focused box).
  const onKeyDown = (key: KeyEvent) => {
    const q = question();
    if (!q || (q.kind !== "text" && q.kind !== "number")) return;
    if (key.name === "backspace") {
      setDraft((d) => [...d].slice(0, -1).join(""));
      setError(null);
      key.preventDefault();
      return;
    }
    const typed = typedText(key);
    if (typed !== null) {
      setDraft((d) => d + typed);
      setError(null);
      setDeclineArmed(false);
      key.preventDefault();
    }
  };

  onMount(() => {
    if (!box) return;
    onCleanup(registerContext(keymap, keyMap, "elicitation", handlers, { target: box }));
  });

  // Selected rows: `surface.permission.selected` (the card fill stepped towards the foreground),
  // or inverse video under the flat theme.
  const spanStyle = (s: CardSegment) => cardSpanStyle(theme, s);

  return (
    <box
      ref={(r: BoxRenderable) => (box = r)}
      focusable
      focused={focused()}
      flexDirection="column"
      width="100%"
      backgroundColor={theme.color("surface.permission")}
      onKeyDown={onKeyDown}
    >
      <For each={rows()}>
        {(row) => (
          // Not selectable, as the permission card's rows (task 12.5): no text selection starts on
          // the docked card or paints it.
          <text selectable={false} wrapMode="none" height={1} {...theme.text("text")}>
            <For each={row}>{(s) => <span style={spanStyle(s)}>{s.text}</span>}</For>
          </text>
        )}
      </For>
    </box>
  );
}
