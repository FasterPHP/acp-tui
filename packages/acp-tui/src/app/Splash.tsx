// The splash (mvp-chrome-and-keys design D2; spec tui-layout "Splash screen"):
// drawn over the conversation region while the session has no items, centred
// in it, its rows from `splashLayout` (src/app/splash.ts). It is chrome, not an
// item: copy, find and export never see it, and it goes when the first item
// arrives. Its identity rows are two from the first frame (the launch's harness and directory, and
// `connecting…` beside the shared spinner until the session has started), so nothing moves when the
// session starts; the spinner redraws its own cell only.
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { BoxRenderable } from "@opentui/core";
import pkg from "../../package.json" with { type: "json" };
import { LIVE_CHROME_GLYPHS, LIVE_GLYPHS } from "../conversation/live-glyphs.ts";
import { createSpinner } from "../conversation/items.tsx";
import { useKeys } from "../keys/context.ts";
import type { SessionView } from "../layout/view.ts";
import { SESSION_LIST_OVERLAY } from "../session/store.ts";
import { splashLayout, rowWidth, type SplashLaunch } from "./splash.ts";
import { useApp } from "./context.ts";

/** acp-tui's version, shown beside the wordmark. */
export const VERSION: string = pkg.version;

export function Splash(props: { view: SessionView }): JSX.Element {
  const { store, theme, launch } = useApp();
  const { keyMap, controller } = useKeys();
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  let box: BoxRenderable | undefined;
  const measure = () => {
    if (box && (box.width !== size().width || box.height !== size().height)) setSize({ width: box.width, height: box.height });
  };
  // Until the session has started the store follows no source (`ui.connecting`; the status row's
  // `connection` may say `connected` earlier, once the harness has answered `initialize`).
  const connecting = () => store.ui.connecting;
  const launched = (): SplashLaunch => launch?.() ?? { harness: props.view.agent ?? "harness", directory: props.view.cwd ?? "" };
  const layout = createMemo(() =>
    splashLayout(
      {
        version: VERSION,
        agent: props.view.agent,
        model: props.view.model,
        cwd: props.view.cwd,
        launch: launched(),
        connecting: connecting(),
        spinner: LIVE_GLYPHS.spinner,
        home: props.view.home,
        keyMap,
        interrupt: controller.interrupt,
        glyphs: LIVE_CHROME_GLYPHS,
      },
      size().width,
      size().height,
    ),
  );
  // The spinner's clock runs only while the splash shows `connecting…`; the layout holds the
  // first frame and only the marked cell reads the clock, so the rest of the splash is not redrawn.
  const spinner = createSpinner();
  createEffect(() => {
    if (store.session.order.length === 0 && connecting()) onCleanup(spinner.hold());
  });
  const spinnerGlyph = () => LIVE_GLYPHS.spinner[spinner.frame() % LIVE_GLYPHS.spinner.length] ?? " ";
  return (
    // Not behind the session list, whose panel leaves the rows above it uncovered (the wordmark
    // peeked out above its top border at 80x24 and 63x21; day-two-feedback task 12.8).
    <Show when={store.session.order.length === 0 && store.ui.overlay !== SESSION_LIST_OVERLAY}>
      <box
        ref={(r: BoxRenderable) => {
          box = r;
          queueMicrotask(measure);
        }}
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        flexDirection="column"
        onSizeChange={measure}
      >
        <box height={layout().top} flexShrink={0} />
        <For each={layout().rows}>
          {(row) => (
            <text height={1} flexShrink={0} wrapMode="none" {...theme.text("text")}>
              <span style={theme.text("text")}>{" ".repeat(Math.max(0, Math.floor((size().width - rowWidth(row)) / 2)))}</span>
              <For each={row}>{(s) => <span style={theme.text(s.token)}>{s.spinner ? spinnerGlyph() : s.text}</span>}</For>
            </text>
          )}
        </For>
      </box>
    </Show>
  );
}
