// Opening links (mvp-rendering task 6.3; spec tui-rendering "Opening links").
// Mounted by app/run.tsx: `createLinks()` gives the mouse hook (ahead of the
// selection's, behind the policy check, so only `--mouse full` reports a
// click) and a component in the App's overlay slot.
//
// - A click on a link opens it: a primary press and its release on the same
//   cell, with no modifier held (Ctrl, Alt or Shift in the press's SGR report:
//   such a click is the terminal's; review C9) and no drag report leaving that
//   cell in between. In a terminal that detects URLs by itself (the capability
//   `detectsUrls`: the JetBrains terminals), a click whose cell lies in text
//   the terminal's URL patterns match on that row opens nothing here, since the
//   terminal opens that text (detect.ts); when the text is a label that differs
//   from the target (`https://bank.example` linking to `evil.example`), a
//   toast names the real target. A drag over a link
//   is the selection's (select.tsx) and opens nothing; the second press of a
//   double click selects a word and opens nothing. The press and the release
//   are always handed on, so the click still moves the conversation cursor.
// - The `openLink` action (context `conversation`, `o`; design open question
//   6) opens the only link of the item under the conversation cursor, or opens
//   a chooser over the links when it has several: a small overlay drawn like
//   the session list (overlay/list.ts), Up and Down to choose, Enter to open,
//   Esc to close. With no link, a notice says so.
// - Opening is open.ts: the opener with the target as its one argument, or a
//   copy over SSH, or a refusal; a notice in the prompt box's top border names
//   the host either way. Before the opener starts, the compositor is asked for
//   an xdg-activation token (activation.ts, review C7; at most
//   `ACTIVATION_TIMEOUT_MS`), passed in `XDG_ACTIVATION_TOKEN`; without one the
//   opener starts all the same. Debug log: `link_open` (`action`: `open`,
//   `copy`, `refuse` or `defer` (the terminal opens it); `kind`,
//   `trigger`, and for `open` `activation`: `token`, `no-wayland`,
//   `no-activation`, `timeout` or `failed`; never the target or the token).
// - The session's working directory, which relative link targets resolve
//   against, is handed to the link rules here (`setLinkBase`) from the store.
import { TextAttributes, type BoxRenderable, type CliRenderer } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { useApp } from "../app/context.ts";
import { linkBase, setLinkBase } from "../conversation/markdown/links.ts";
import type { LinkTarget } from "../conversation/markdown/types.ts";
import { OVERLAY_BOTTOM } from "../layout/layout.ts";
import type { Focus } from "../layout/view.ts";
import { useKeys } from "../keys/context.ts";
import { actionLabel } from "../keys/keymap.ts";
import { registerContext, type ContextHandlers } from "../keys/register.ts";
import type { MouseIntercept, MouseReport } from "../renderer/mouse.ts";
import { copyToast, createCopier, type ClipboardModeSource, type Copier, type CopierOptions } from "../selection/clipboard.ts";
import { conversationBoxFinder } from "../selection/cells.ts";
import { moveSelection, overlayLayout, type OverlaySegment } from "../overlay/list.ts";
import { listPointer } from "../overlay/pointer.ts";
import { spanStyle as toSpan } from "../theme/index.ts";
import { itemLinks, linkAt, type ItemLink } from "./hit.ts";
import { activationToken, openerEnv, type Activation } from "./activation.ts";
import { detectedUrlOnScreen, opensTarget, type DetectedUrl } from "./detect.ts";
import { planOpen, spawnOpener, targetName, type Env } from "./open.ts";

/** The `ui.overlay` name of the link chooser. */
export const LINK_CHOOSER_OVERLAY = "links";

/** A second press this soon on the same cell is a double click: it opens nothing. */
const DOUBLE_CLICK_MS = 400;

export interface LinksOptions {
  /** `--clipboard`, for the copy over SSH; default `auto`. */
  readonly clipboard?: ClipboardModeSource;
  /** The environment the opener and the SSH check read; default `process.env`. */
  readonly env?: Env;
  /** Replaces the clipboard (in-process tests). */
  readonly copier?: (options: CopierOptions) => Copier;
  /** Replaces starting the opener (in-process tests); `env` holds `XDG_ACTIVATION_TOKEN` when a
   *  token was had. */
  readonly spawn?: (argv: readonly string[], env: Record<string, string | undefined>) => void;
  /** Whether the terminal opens URL-like text itself on a plain click (the capability table's
   *  `detectsUrls`); default false. */
  readonly detectsUrls?: boolean;
  /** Replaces the compositor's token request (in-process tests); default activation.ts's. */
  readonly activation?: (env: Env) => Promise<Activation>;
}

export interface LinksMount {
  readonly intercept: MouseIntercept;
  readonly overlay: () => JSX.Element;
}

export function createLinks(options: LinksOptions = {}): LinksMount {
  let handler: MouseIntercept | null = null;
  return {
    intercept: (report, dispatch) => (handler ? handler(report, dispatch) : dispatch(report)),
    overlay: () => <LinkLayer bind={(h) => (handler = h)} options={options} />,
  };
}

function LinkLayer(props: { bind: (handler: MouseIntercept | null) => void; options: LinksOptions }): JSX.Element {
  const renderer = useRenderer() as CliRenderer;
  const { store, theme, logger } = useApp();
  const { keymap, keyMap, controller } = useKeys();
  const dims = useTerminalDimensions();
  const env = props.options.env ?? process.env;
  const copier = (props.options.copier ?? createCopier)({ renderer, logger, mode: props.options.clipboard ?? "auto", env });
  const conversationBox = conversationBoxFinder(renderer);

  // The session's directory for the link rules (a switch may open a session elsewhere).
  createEffect(() => setLinkBase(store.session.cwd ?? null));
  onCleanup(() => setLinkBase(null));

  // -- Opening --------------------------------------------------------------------------------

  function open(link: LinkTarget, trigger: "click" | "key"): void {
    const plan = planOpen(link, linkBase(), env);
    // Logged once the token request is over when the opener is started (with `activation`).
    if (plan.action !== "open") logger?.log({ event: "link_open", action: plan.action, kind: link.kind, trigger });
    if (plan.action === "refuse") {
      controller.notify(plan.toast, "warning");
      return;
    }
    if (plan.action === "copy") {
      void copier.copy(plan.text, "link").then((outcome) => {
        const how = copyToast(Array.from(plan.text).length, outcome, copier.display);
        controller.notify(
          how.ok ? `SSH session: copied the link to ${plan.toast} instead of opening it (${how.text})` : `SSH session: the link to ${plan.toast} was not opened, and ${how.text}`,
          how.ok ? "muted" : "warning",
        );
      });
      return;
    }
    // An activation token first (a short wait at most), so the browser may come forward (C7).
    void (props.options.activation ?? activationToken)(env).then((activation) => {
      logger?.log({ event: "link_open", action: plan.action, kind: link.kind, trigger, activation: activation.token === null ? activation.reason : "token" });
      const openerEnvironment = openerEnv(env, activation.token);
      try {
        if (props.options.spawn) props.options.spawn(plan.argv, openerEnvironment);
        else spawnOpener(plan.argv, openerEnvironment);
        controller.notify(plan.toast, "muted");
      } catch (error) {
        controller.notify(`could not open ${plan.toast.replace(/^opening /, "")}: ${plan.argv[0]} did not start (${(error as Error).message})`, "warning");
      }
    });
  }

  // -- Mouse: a click without a drag ----------------------------------------------------------

  /** A click the terminal opens itself: nothing is opened here; a label that is not the target
   *  gets a toast naming the real one. */
  function deferToTerminal(link: LinkTarget, detected: DetectedUrl): void {
    logger?.log({ event: "link_open", action: "defer", kind: link.kind, trigger: "click" });
    if (!opensTarget(detected.text, link)) controller.notify(`the terminal opens the text it shows; this link goes to ${targetName(link)}`, "warning");
  }

  let press: { x: number; y: number; moved: boolean; second: boolean; modified: boolean } | null = null;
  let lastClick: { x: number; y: number; at: number } | null = null;
  const onMouse: MouseIntercept = (report: MouseReport, dispatch) => {
    if (report.type === "down" && report.button === 0) {
      const now = Date.now();
      const second = lastClick !== null && lastClick.x === report.x && lastClick.y === report.y && now - lastClick.at < DOUBLE_CLICK_MS;
      const m = report.modifiers;
      press = { x: report.x, y: report.y, moved: false, second, modified: m.ctrl || m.alt || m.shift };
      lastClick = { x: report.x, y: report.y, at: now };
    } else if (report.type === "drag" && press && (report.x !== press.x || report.y !== press.y)) {
      press.moved = true;
    } else if (report.type === "up" && report.button === 0 && press) {
      const click = !press.moved && !press.second && !press.modified && report.x === press.x && report.y === press.y;
      press = null;
      const box = click ? conversationBox() : null;
      const link = box ? linkAt(box, report.x, report.y) : null;
      const detected = link && props.options.detectsUrls ? detectedUrlOnScreen(renderer, report.x, report.y) : null;
      if (link && detected) deferToTerminal(link, detected);
      else if (link) open(link, "click");
    }
    return dispatch(report);
  };
  props.bind(onMouse);

  // -- The chooser ----------------------------------------------------------------------------

  const [choices, setChoices] = createSignal<readonly ItemLink[] | null>(null);
  const [selected, setSelected] = createSignal(0);
  let returnFocus: Focus = "conversation";
  let lastOffset = 0;
  const chooserOpen = () => choices() !== null;

  function openChooser(links: readonly ItemLink[]): void {
    if (store.ui.focus !== "overlay") returnFocus = store.ui.focus;
    lastOffset = 0;
    batch(() => {
      setChoices(links);
      setSelected(0);
      store.setOverlay(LINK_CHOOSER_OVERLAY);
      store.setFocus("overlay");
    });
  }

  function closeChooser(): void {
    if (!chooserOpen()) return;
    const mine = store.ui.overlay === LINK_CHOOSER_OVERLAY;
    batch(() => {
      setChoices(null);
      if (mine) {
        store.setOverlay(null);
        if (store.ui.focus === "overlay") store.setFocus(returnFocus);
      }
    });
  }

  // Another overlay took the slot, or focus went elsewhere: the chooser closes.
  createEffect(() => {
    const overlay = store.ui.overlay;
    const focus = store.ui.focus;
    if (chooserOpen() && (overlay !== LINK_CHOOSER_OVERLAY || focus !== "overlay")) setChoices(null);
  });

  const layout = createMemo(() => {
    const list = choices() ?? [];
    const enter = actionLabel(keyMap, "overlay", "choose");
    const result = overlayLayout({
      title: "Links",
      filter: null,
      placeholder: "",
      items: list.map((c, i) => ({ id: `${i}`, group: null, title: c.label === "" ? c.link.shown : c.label, details: [c.link.shown] })),
      grouped: false,
      selected: selected(),
      offset: lastOffset,
      width: dims().width,
      rows: dims().height,
      closeLabel: actionLabel(keyMap, "overlay", "close"),
      hints: [{ text: "↑↓ select", token: "muted" }, ...(enter ? [{ text: " · ", token: "muted" as const, breakBefore: true }, { text: `${enter} open`, token: "muted" as const }] : [])],
      marks: false,
    });
    lastOffset = result.offset;
    return result;
  });

  const moveBy = (move: number | "first" | "last") => void setSelected((n) => moveSelection(choices()?.length ?? 0, n, move));
  const handlers: ContextHandlers<"overlay"> = {
    up: () => moveBy(-1),
    down: () => moveBy(1),
    pageUp: () => moveBy(-Math.max(1, layout().listHeight - 1)),
    pageDown: () => moveBy(Math.max(1, layout().listHeight - 1)),
    first: () => moveBy("first"),
    last: () => moveBy("last"),
    choose: () => {
      const chosen = choices()?.[selected()];
      closeChooser();
      if (chosen) open(chosen.link, "key");
    },
    close: closeChooser,
  };

  // -- The `openLink` action ------------------------------------------------------------------

  onCleanup(
    registerContext(keymap, keyMap, "conversation", {
      openLink: () => {
        if (store.ui.focus !== "conversation") return false;
        const id = store.conversation.cursor();
        const item = id ? store.snapshot().items.get(id) : undefined;
        const links = item ? itemLinks(item) : [];
        if (links.length === 0) controller.notify("no link in the item under the cursor", "muted");
        else if (links.length === 1) open(links[0]!.link, "key");
        else openChooser(links);
        return true;
      },
    }),
  );

  onCleanup(() => {
    props.bind(null);
    void copier.dispose();
  });

  const spanStyle = (s: OverlaySegment) => {
    const base = theme.text(s.token);
    if (!s.selected) return toSpan(base);
    return toSpan(theme.flat ? { ...base, attributes: base.attributes | TextAttributes.INVERSE } : { ...base, bg: theme.color("surface.cursor") });
  };

  function Panel(): JSX.Element {
    let box: BoxRenderable | undefined;
    onMount(() => {
      if (box) onCleanup(registerContext(keymap, keyMap, "overlay", handlers, { target: box }));
    });
    return (
      <box
        ref={(r: BoxRenderable) => (box = r)}
        position="absolute"
        left={0}
        bottom={OVERLAY_BOTTOM}
        zIndex={100}
        width={dims().width}
        height={layout().lines.length}
        flexDirection="column"
        focusable
        focused={store.ui.focus === "overlay"}
        backgroundColor={theme.color("surface.overlay")}
        {...listPointer({
          box: () => box,
          itemAt: () => layout().itemAt,
          select: (index) => void setSelected(index),
          choose: (index) => {
            setSelected(index);
            handlers.choose?.();
          },
        })}
      >
        <For each={layout().lines}>
          {(row) => (
            <text wrapMode="none" height={1} {...theme.text("text")}>
              <For each={row}>{(s) => <span style={spanStyle(s)}>{s.text}</span>}</For>
            </text>
          )}
        </For>
      </box>
    );
  }

  return (
    <Show when={chooserOpen()}>
      <Panel />
    </Show>
  );
}
