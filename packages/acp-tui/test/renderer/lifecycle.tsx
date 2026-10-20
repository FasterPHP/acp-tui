// Spike app for task 6.1 (Phase 0), moved to the alternate screen by phase-1a
// task 3.5: the real renderer factory and lifecycle, with numbered rows above
// a status bar, READY on the first row once started, then waits: `q`
// exits normally, SIGHUP and SIGTERM go through the lifecycle's handlers.
//
//   bun packages/acp-tui/test/renderer/lifecycle.tsx [rows] [--fail-start] [--mouse] [--destroy-throws]
//                                            [--closed-rejects] [--closed-hangs]
//
// LIFECYCLE_LOG=<file> records the exit hook's call, including whether the
// renderer was already destroyed at that point (it must not be), and each
// SIGUSR2 (`{"theme":true}`). Phase-1a task 4.1: `--mouse` turns mouse
// reporting on once started (the app's mouse policy lands in task group 8),
// and `--destroy-throws` makes `destroy()` throw so the failure path runs.
// opentui-0-6 task 3.2: with `--closed-rejects` and `--closed-hangs`,
// `destroy()` runs but the native session's close is stubbed out, so no
// restoration is written, and `renderer.closed` rejects, or never settles so
// the lifecycle's bound expires; the lifecycle then restores and disposes the
// session itself. As in the app (src/app/run.tsx), the console is captured for
// the run, so OpenTUI's own error logging never reaches the terminal.
import { appendFileSync } from "node:fs";
import { render } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import { Bar, deriveSessionView, resolveBar } from "../../src/layout/index.ts";
import { captureConsole } from "../../src/agent/console-capture.ts";
import { NULL_LOGGER } from "../../src/log.ts";
import { rendererSession } from "../../src/renderer/create.ts";
import { runWithRenderer, type Lifecycle } from "../../src/renderer/index.ts";
import { DEFAULT_THEME, resolveTheme } from "../../src/theme/index.ts";
import { createSession } from "acp-model";

const count = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 40);
const failStart = process.argv.includes("--fail-start");
const mouse = process.argv.includes("--mouse");
const destroyThrows = process.argv.includes("--destroy-throws");
const closedRejects = process.argv.includes("--closed-rejects");
const closedHangs = process.argv.includes("--closed-hangs");
const log = process.env.LIFECYCLE_LOG;
const theme = resolveTheme(DEFAULT_THEME);
const rows = Array.from({ length: count }, (_, i) => `row ${String(i + 1).padStart(3, "0")}`);
let lifecycleRef: Lifecycle | undefined;

const capture = captureConsole(NULL_LOGGER);

await runWithRenderer({
  exit: (code) => {
    capture.restore();
    process.exit(code);
  },
  onExit: (reason) => {
    if (log) {
      const destroyed = lifecycleRef?.renderer?.isDestroyed ?? null;
      appendFileSync(log, `${JSON.stringify({ reason: reason.kind, signal: "signal" in reason ? reason.signal : null, destroyed })}\n`);
    }
  },
  async start(renderer, lifecycle) {
    lifecycleRef = lifecycle;
    if (log) lifecycle.onThemeSignal(() => appendFileSync(log, `${JSON.stringify({ theme: true })}\n`));
    if (destroyThrows) {
      renderer.destroy = () => {
        throw new Error("destroy failed on purpose");
      };
    }
    if (closedRejects || closedHangs) {
      const session = rendererSession(renderer) as unknown as { close: () => Promise<void> };
      session.close = () => new Promise<void>(() => {});
      const closed = closedRejects ? Promise.reject(new Error("closed rejected on purpose")) : new Promise<void>(() => {});
      closed.catch(() => {});
      Object.defineProperty(renderer, "closed", { get: () => closed });
    }
    const view = deriveSessionView({ ...createSession(), cwd: "/work/project" }, { agent: { name: "spike-agent" } });
    const [ready, setReady] = createSignal(false);
    await render(
      () => (
        <box flexDirection="column" width="100%" height="100%">
          <Show when={ready()}>
            <text {...theme.text("text")}>READY</text>
          </Show>
          <box flexDirection="column" flexGrow={1} overflow="hidden">
            <For each={rows}>{(row) => <text flexShrink={0} {...theme.text("text")}>{row}</text>}</For>
          </box>
          <Bar bar={resolveBar({ left: ["agent", "cwd"], right: ["turn-state", "connection"] })} view={view} theme={theme} width={process.stdout.columns ?? 80} />
        </box>
      ),
      renderer,
    );
    await renderer.idle();
    if (failStart) throw new Error("start-up failed on purpose");
    if (mouse) renderer.useMouse = true;
    setReady(true);
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "q") void lifecycle.shutdown({ kind: "user" });
    });
  },
});
