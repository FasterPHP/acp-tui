// The interactive app (the default `StartApp` in cli.ts). Order:
//   1. capture the console (the SDK logs with console.error; nothing may write
//      to the terminal outside the renderer),
//   2. for `--resume <id>` and `--continue` only, before anything is drawn:
//      launch and initialise the agent and find the session
//      (`switcher.prepare`, mvp-sessions design decision 13); a failure (the
//      session found nowhere, a directory without sessions, an agent that
//      cannot reopen sessions or fails to start) is printed below the command
//      line and the exit code is 1, the alternate screen never entered; while
//      it runs `acp-tui: finding session…` is on the normal screen, removed
//      before the error line or the alternate screen (app/finding-line.ts),
//   3. create the full-screen renderer and mount the App (the screen layout:
//      conversation, activity bar, card, prompt box, status row), so the
//      status row shows `connecting` while a new session's agent starts,
//   4. start the session and attach it to the store: a new one, or the one
//      step 2 found, reopened on the agent it launched (session/start.ts),
//      recorded in the session index; for `--resume` without an ID, launch
//      and initialise the agent and open the session list
//      (overlay/SessionList.tsx) before any session exists.
// The session in use, and switching to another from the session list, live
// in the session switcher (session/switch.ts); the exit text and every action
// follow the session in use.
// A start-up failure in 3 or 4 goes through the lifecycle's error path: the
// terminal is restored first, then `acp-tui: <message>` is printed (the
// message names the command and, for AgentStartupError, the stderr tail; for
// a session that cannot be reopened, the session, the agent and the agent's
// answer), and the exit code is 1. Every exit path detaches the session
// before the renderer is destroyed, and resolves with the exit code instead
// of exiting, so cli.ts
// stays the only place that calls process.exit. After the final reset the
// lifecycle prints the exit text (`--exit-print`, renderer/exit-text.ts: the
// resume line), then any error. The renderer's settle repaint and Ctrl+L come from
// renderer/repaint.ts; `repainter.onRepaint` and `lifecycle.onThemeSignal`
// (SIGUSR2) are the hooks for re-reading the terminal's colours.
import { writeCrashReport } from "../crash-report.ts";
import { render } from "@opentui/solid";
import { sanitise } from "acp-model";
import { createSignal } from "solid-js";
import type { CliRenderer, HostClipboardService } from "@opentui/core";
import { captureConsole } from "../agent/console-capture.ts";
import { AgentStartupError } from "../agent/connection.ts";
import type { StartAppOptions } from "../cli.ts";
import { showFinding } from "./finding-line.ts";
import { resolveLayout, type Layout } from "../layout/layout.ts";
import { layoutFromConfig } from "../layout/from-config.ts";
import { createConfigStore, type ConfigStore } from "../config/store.ts";
import { applyGlyphs, resetGlyphs } from "../conversation/live-glyphs.ts";
import { problemNotice, problemsForLog } from "../config/problems.ts";
import { resolveKeyOverrides } from "../keys/overrides.ts";
import { setNewlineHintState } from "../keys/newline-hint.ts";
import { problemsRoute } from "../overlay/problems.ts";
import type { ConfigOverrides } from "../config/effective.ts";
import {
  DEFAULT_SCREEN_OPTIONS,
  exitText,
  type ScreenOptions,
  forceFullRepaint,
  installCrashHook,
  testHooks,
  installFrameLog,
  createFramePace,
  installRepaint,
  runWithRenderer,
  type Lifecycle,
  type Repainter,
} from "../renderer/index.ts";
import { installBareCsiR } from "../renderer/bare-csi-r.ts";
import { installCtrlBreakKey } from "../renderer/ctrl-break-key.ts";
import { installDoubleEsc } from "../renderer/double-esc.ts";
import { logHyperlinks } from "../renderer/hyperlinks.ts";
import { setDrawCapabilities } from "../conversation/markdown/draw.ts";
import { setRenderSettings } from "../conversation/markdown/context.ts";
import { effectiveTerminal, type EffectiveTerminal } from "../renderer/capabilities.ts";
import type { Config, SectionName } from "../config/schema.ts";
import type { ClipboardMode, MousePolicy } from "../renderer/options.ts";
import { setUrlElision } from "../conversation/markdown/elide.ts";
import { installJediTermFilter } from "../renderer/jediterm-filter.ts";
import { createMouseReload, createMouseToggle, installMouseInput } from "../renderer/mouse.ts";
import { wheelStep, type WheelStep } from "../renderer/wheel.ts";
import { createTerminalSignals } from "../renderer/terminal-signals.ts";
import { attentionFromConfig, type AttentionSettings } from "../renderer/attention.ts";
import type { KeyMap } from "../keys/keymap.ts";
import type { InterruptSetting } from "../keys/settings.ts";
import { sessionExitState } from "../session/exit-state.ts";
import { readConfigDirectories } from "../agent/resolve.ts";
import { openSessionIndex } from "../session/session-index.ts";
import { SessionOpenFailure } from "../session/start.ts";
import { createSessionStore, type SessionStore } from "../session/store.ts";
import { createSessionSwitcher } from "../session/switch.ts";
import { createSessionList } from "../overlay/SessionList.tsx";
import { bindTerminalColours, createLiveTheme, createThemeRefresh, type ThemeColours } from "../theme/index.ts";
import { createConfiguredTheme } from "../theme/configured.ts";
import { createPalette } from "../overlay/Overlay.tsx";
import { createCards } from "../card/ChromeCard.tsx";
import { chainIntercepts, createScrollbar } from "../conversation/scrollbar.ts";
import { registerGrammars } from "../conversation/grammars.ts";
import { createSelection } from "../selection/select.tsx";
import { createClipboardReader } from "../selection/clipboard.ts";
import { createFind } from "../find/Find.tsx";
import { createLinks } from "../links/Links.tsx";
import { createHover } from "../conversation/hover.tsx";
import { App } from "./App.tsx";
import type { AppActions, AppContextValue } from "./context.ts";
import { splashLaunch } from "./splash.ts";

/** How long a start-up notice (a configuration problem, several agents with the session ID) stays
 *  in the prompt box's top border. */
const STARTUP_NOTICE_MS = 8000;

/** The notice when a reload changes whether links are written as OSC 8 in this terminal (spec
 *  tui-config "Live reload": OpenTUI fixes it when the renderer is constructed). */
export const HYPERLINKS_NEXT_START = "hyperlinks applies from the next start";

export interface RunAppExtras {
  /** A fixed layout (tests); without it the layout comes from the configuration. */
  layout?: Layout;
  /** The configuration store (tests); default one over the user's file and the project file of
   *  the session directory, with the command line's settings pinned. */
  config?: ConfigStore;
  /** A validated key map (`loadKeyMap`); default `DEFAULT_KEY_MAP` (tests inject rebindings). */
  keyMap?: KeyMap;
  /** The `interrupt` setting (keys/settings.ts), configurable now (`interrupt`); this entry
   *  point remains for tests that set it in-process; default `double`. */
  interrupt?: InterruptSetting;
  /** The attention settings (renderer/attention.ts), configurable now (`attention.*`); this entry
   *  point remains for tests that set them in-process; default `DEFAULT_ATTENTION`. */
  attention?: AttentionSettings;
  /** Replaces the host clipboard that `paste` reads (tests: a stubbed clipboard). */
  clipboardHost?: HostClipboardService;
  /** Called once the App is mounted and before the agent starts. Keys are registered by <App>
   *  itself. */
  onMounted?: (app: { renderer: CliRenderer; lifecycle: Lifecycle; store: SessionStore; context: AppContextValue }) => void;
}

export function runApp(options: StartAppOptions, extras: RunAppExtras = {}): Promise<number> {
  // The bundled tree-sitter grammars, from local files, before OpenTUI's client first starts
  // (mvp-rendering task 8.2): nothing is ever fetched over the network.
  registerGrammars();
  // The session directory and the agent come from the launch description (mvp-sessions task 3.3):
  // the directory argument, else the launch directory; the named, default or ad hoc agent.
  const { launch } = options;
  // The configuration (mvp-configuration design D5), loaded before the renderer is constructed:
  // the user's file, the project file of the session directory, and the command line's settings
  // on top, pinned for the run. A caller that gives `screen` without `overrides` (tests) pins all
  // four screen settings, as before the configuration existed.
  const given = options.screen ?? DEFAULT_SCREEN_OPTIONS;
  const overrides: ConfigOverrides =
    options.overrides ?? (options.screen ? { mouse: given.mouse, exit_print: given.exitPrint, clipboard: given.clipboard, ...(given.wheelLines !== null ? { wheel_lines: given.wheelLines } : {}) } : {});
  const config = extras.config ?? createConfigStore({ sessionDirectory: launch.directory, overrides });
  const settings = config.config();
  // The glyph set and its overrides (design D9), applied before anything is drawn. The loader has
  // already left out the overrides that are invalid in their own file; what is left here is what
  // only the merged configuration shows (a project override against the user's set).
  const applyGlyphConfig = (glyphs: typeof settings.glyphs): void => {
    const files = config.files();
    config.setProblems(
      "glyphs",
      applyGlyphs(glyphs).map((p) => ({
        file: files.project ?? files.user,
        line: 1,
        column: 1,
        path: `glyphs.overrides.${p.name}`,
        severity: "warning" as const,
        message: p.message,
        ...(p.suggestion === undefined ? {} : { suggestion: p.suggestion }),
      })),
    );
  };
  applyGlyphConfig(settings.glyphs);
  // Screen options (task 4.4) from the effective configuration; the settle repaint and Ctrl+L
  // (task 4.5, renderer/repaint.ts). These are the values at start-up; the behaviour settings
  // follow a reload (mvp-configuration task group 4: `onReload` below, and the readers given a
  // function of the configuration).
  const screen: ScreenOptions = {
    mouse: settings.mouse,
    wheelLines: settings.wheel_lines,
    exitPrint: settings.exit.print,
    clipboard: settings.clipboard,
  };
  // The test hooks (renderer/test-hooks.ts, mvp-configuration task 9.4): `ACP_TUI_TEST_HOOKS`, read
  // once at start-up; nothing on the command line, in the configuration or in the palette.
  const hooks = testHooks();
  // The layout in use: a fixed one (tests), else the configuration's, swapped on a reload (task
  // 3.2). Blocks keep their components across layouts (layout.ts `BLOCK_REGIONS`).
  const [layout, setLayout] = createSignal(extras.layout ? resolveLayout(extras.layout) : layoutFromConfig(settings.layout));
  // The configured theme (mvp-configuration task group 5): the theme files `theme.name` names, the
  // inline tokens and `surface_contrast`, with `theme.flat` forcing the flat style; its problems go
  // to the store's `theme` channel.
  const themeConfig = createConfiguredTheme(config);
  const theme = createLiveTheme(themeConfig.source, { forceFlat: themeConfig.flat() });
  themeConfig.attach(theme);
  // The effective mouse policy starts as the chosen one (the `mouse` module; F2 flips it).
  const store = createSessionStore({
    mouse: screen.mouse,
    models: () => {
      const models = config.config().models;
      return { groupByProvider: models.group_by_provider, separator: models.provider_separator };
    },
  });
  const capture = captureConsole(options.logger);
  // mvp-sessions: whether opening the session from the command line failed (then the exit text
  // names no session).
  let openFailed = false;
  // A notice in the prompt box's top border for a while (configuration problems, several agents
  // with the session ID, an unwritable index).
  const notice = (text: string, cut?: { readonly more: string; readonly short: string }): void => {
    const id = store.notify(sanitise(text, "approval"), "warning", cut && { more: sanitise(cut.more, "approval"), short: sanitise(cut.short, "approval") });
    setTimeout(() => store.dismissNotice(id), STARTUP_NOTICE_MS);
  };
  let lifecycleRef: Lifecycle | null = null;
  let rendererRef: CliRenderer | null = null;
  let repainter: Repainter | null = null;
  // The terminal's colours behind the theme's surfaces (task 5.2); `refresh()` re-queries them.
  let themeColours: ThemeColours | null = null;
  // The per-terminal table (mvp-configuration design D12, renderer/capabilities.ts): the built-in
  // row of this terminal, its `terminals` entry and `ACP_TUI_CAPABILITIES` on top. Its `osc8` is
  // fixed for the run: the renderer is constructed with it (`FORCE_HYPERLINK`), and draw.ts
  // attaches links by the same value, whatever a reload says (design D6); `strikethrough` and the
  // wheel step follow a reload.
  let terminal = effectiveTerminal(process.env, settings.terminals);
  const builtOsc8 = terminal.capabilities.osc8;
  const drawnCapabilities = (t: EffectiveTerminal) => ({ ...t.capabilities, osc8: builtOsc8 });
  setDrawCapabilities(drawnCapabilities(terminal));
  // The rendering settings (`markdown.*`, `tool_output.snippet_rows`; conversation/markdown/context.ts).
  const renderSettings = (c: Config) => ({
    headingMarkers: c.markdown.heading_markers,
    tableMinColumnWidth: c.markdown.table_min_column_width,
    codeWrap: c.markdown.code_wrap,
    snippetRows: c.tool_output.snippet_rows,
    cardPadRows: c.cards.padding.rows,
    cardPadColumns: c.cards.padding.columns,
  });
  setRenderSettings(renderSettings(settings));
  // Rows per wheel event for this terminal: `wheel_lines` (the file or `--wheel-lines`), else the
  // terminal's `terminals` entry, else the table (renderer/wheel.ts); re-selected on a reload, and
  // read through getters so the conversation's wheel follows.
  const [wheelNow, setWheelNow] = createSignal(wheelStep(settings.wheel_lines, process.env, settings.terminals));
  const wheel: WheelStep = {
    get rows() {
      return wheelNow().rows;
    },
    get terminal() {
      return wheelNow().terminal;
    },
    get source() {
      return wheelNow().source;
    },
  };
  // The mouse policy F2 toggles against: the `mouse` setting as last applied to the terminal.
  let chosenMouse = screen.mouse;
  let toggleMouse: (() => boolean) | null = null;
  let reloadMouse: ((policy: MousePolicy) => void) | null = null;
  // The clipboard paths, read at each copy and paste (`clipboard`, live; pinned by `--clipboard`).
  const clipboardMode = (): ClipboardMode => config.config().clipboard;
  // The terminal title, attention signals and the wheel with the mouse off (renderer/terminal-signals.ts);
  // attention reads `attention.*` at each signal.
  const terminalSignals = createTerminalSignals({ store, logger: options.logger, titleFormat: () => config.config().title.format, directory: launch.directory, attention: extras.attention ?? (() => attentionFromConfig(config.config().attention)) });
  // The command palette, the slash menu, the config pickers and key help (mvp-chrome-and-keys task
  // group 6; src/overlay/Overlay.tsx).
  const palette = createPalette();
  // The docked cards (mvp-chrome-and-keys tasks 5.1 and 5.6): the permission card with its preview
  // and Ctrl+O grow, and the elicitation card, whose handler the session controller gives the ACP
  // client, which also advertises the capability (src/card/ChromeCard.tsx).
  const cards = createCards({ clipboard: clipboardMode });
  // Selection and copy: the selection's mouse hook behind the policy check, and its component in
  // the App's overlay slot (src/selection/).
  const selection = createSelection({ clipboard: clipboardMode });
  // Paste (Ctrl+V, mvp-chrome-and-keys task 3.2): the prompt box reads the host clipboard through it.
  const clipboard = createClipboardReader({ mode: clipboardMode, logger: options.logger, ...(extras.clipboardHost ? { host: extras.clipboardHost } : {}) });
  // The conversation's scroll bar (mvp-chrome-and-keys D17): its mouse hook ahead of the
  // selection's, and the bar the conversation draws (src/conversation/scrollbar.ts), shown while the
  // layout's `layout.scrollbar` is on, which a reload switches (mvp-configuration task 6.5).
  const scrollbar = createScrollbar();
  // Find and export: the prompt block with the find bar below it, and the find keys, highlight
  // and export in the overlay slot (src/find/).
  const find = createFind();
  // Links (mvp-rendering task 6.3): a click on a link and the `openLink` action open it (or copy it
  // over SSH), with its mouse hook ahead of the selection's (src/links/).
  // In a terminal that opens URL-like text itself (`detectsUrls`, JetBrains), a click inside such
  // text is left to it (review C9).
  const links = createLinks({ clipboard: clipboardMode, detectsUrls: terminal.capabilities.detectsUrls });
  // There, too, a bare URL too long for its row is drawn on one row, shortened (review A1), so the
  // terminal never detects a cut-off URL; set before anything is laid out.
  setUrlElision(terminal.capabilities.detectsUrls);
  // Hover feedback (review C12): under `--mouse full`, what a click would act on is marked while
  // the pointer is over it; its mouse hook sees every report first (src/conversation/hover.tsx).
  const hover = createHover();
  // mvp-sessions: the session in use and switching (session/switch.ts), and the session list
  // (overlay/SessionList.tsx), always mounted.
  // The replay's drain and the agent read loop take their turns outside frames once the renderer
  // is up (renderer/frame-pace.ts; history-replay-pacing D1).
  const pace = createFramePace();
  const switcher = createSessionSwitcher({
    launch,
    logger: options.logger,
    index: openSessionIndex({ onWarning: notice }),
    store,
    notify: notice,
    // The launch directory's project file is already in the store (a failed edit keeps its last
    // good value); another directory's sessions read their own files.
    configDirectories: (directory) => (directory === launch.directory ? config.config().additional_directories : readConfigDirectories(directory).directories),
    cancelled: () => lifecycleRef?.shuttingDown ?? false,
    elicitation: cards.elicitation,
    pace,
    // On Windows a harness run through npm's `.cmd` shim retitles the tab (windows-support D5).
    onHarnessInitialized: () => {
      terminalSignals.reassertTitle();
      // The splash and the `connection` module move from `starting` to `opening session`.
      store.setHarnessInitialized();
    },
    // ... and so does a harness that starts a worker or runs a command later (Claude Code names
    // the tab `claude` as its process starts): the title is set again at those moments too.
    onHarnessActivity: (activity) => terminalSignals.harnessActivity(activity),
  });
  const controller = () => switcher.current()?.controller ?? null;
  /** The notice while the harness is starting: `auggie is still starting`. */
  const stillStarting = (): string => `${splashLaunch(switcher.current()?.launch ?? launch).harness} is still starting`;
  const sessionList = createSessionList({
    agents: switcher.agents,
    currentAgent: switcher.currentAgent,
    directory: switcher.directory,
    canList: switcher.canList,
    listPage: switcher.listPage,
    records: switcher.records,
    choose: switcher.choose,
    current: switcher.current,
    starting: switcher.starting,
    ready: switcher.ready,
    // Esc in the list at start-up (`--resume` without an ID): a new session; a failure is a
    // start-up failure.
    startNew: () => void switcher.startNew().catch((error: unknown) => lifecycleRef?.shutdown({ kind: "error", error }, 1)),
  });
  /**
   * The behaviour settings a reload changes outside the reactive readers (mvp-configuration task
   * group 4; spec tui-config "Live reload"): the mouse policy (when `mouse` changed, or a refused
   * change is still pending), the wheel step and what the terminal draws (`wheel_lines`,
   * `terminals`), with a notice when the effective `hyperlinks` changed, since that applies only
   * from the next start, and the rendering settings. `exit.print`, `clipboard`,
   * `selection.copy_on_release`, `interrupt` and `attention.*` are read where they are used;
   * `density` by the conversation (only when it changed); agents at the next session.
   */
  const applyBehaviour = (next: Config, changed: readonly SectionName[]): void => {
    if (next.mouse !== chosenMouse || changed.includes("mouse")) reloadMouse?.(next.mouse);
    if (changed.includes("wheel_lines") || changed.includes("terminals")) {
      const before = terminal;
      terminal = effectiveTerminal(process.env, next.terminals);
      setWheelNow(wheelStep(next.wheel_lines, process.env, next.terminals));
      setDrawCapabilities(drawnCapabilities(terminal));
      if (terminal.capabilities.osc8 !== before.capabilities.osc8 && terminal.capabilities.osc8 !== builtOsc8) notice(HYPERLINKS_NEXT_START);
    }
    if (changed.includes("markdown") || changed.includes("tool_output") || changed.includes("cards")) setRenderSettings(renderSettings(next));
  };
  const overlays = [sessionList.overlay, palette.overlay, selection.overlay, find.overlay, links.overlay, hover.overlay];
  const overlay = () => <>{overlays.map((o) => o())}</>;

  const actions: AppActions = {
    prompt: (text, links) => controller()?.prompt(text, links) ?? null,
    cancel: () => {
      cards.cancel();
      controller()?.cancel();
    },
    answerPermission: (optionId) => controller()?.answerPermission(optionId) ?? false,
    exit: () => void lifecycleRef?.shutdown({ kind: "user" }),
    // Ctrl+L: every cell repainted at once (design D6); `onRepaint` listeners run after it.
    repaint: () => repainter?.repaintNow(),
    // F2: the chosen policy or `off` (renderer/mouse.ts).
    toggleMouse: () => toggleMouse?.() ?? false,
    // The pickers and the cycle keys: the controller records the agent's answer in the model
    // (`config_options_replaced`, or the legacy mode or model).
    setConfigOption: async (configId, value) => {
      const using = controller();
      if (!using) throw new Error(stillStarting());
      await using.setConfigOption(configId, value);
    },
    setMode: async (modeId) => {
      const using = controller();
      if (!using) throw new Error(stillStarting());
      await using.setMode(modeId);
    },
    setModel: async (modelId) => {
      const using = controller();
      if (!using) throw new Error(stillStarting());
      await using.setModel(modelId);
    },
    addDirectory: (path, confirm) => switcher.addDirectory(path, confirm),
  };
  const context: AppContextValue = { store, actions, theme, logger: options.logger, wheel, clipboard, config, scrollbar, launch: () => splashLaunch(switcher.current()?.launch ?? launch) };

  return new Promise<number>((resolve) => {
    const run = (): void => {
      void runWithRenderer({
        // OSC 8 only where the capability table marks the terminal (task 6.4): OpenTUI's hyperlink
        // capability is fixed from it at construction (renderer/hyperlinks.ts), so it never writes
        // OSC 8 on its own judgement.
        renderer: { mouse: screen.mouse, osc8: builtOsc8 },
        finalReset: terminalSignals.restore,
        crashReport: (error) => writeCrashReport(error),
        onExit: async (reason) => {
          options.logger.log({ event: "exit", reason: reason.kind, ...(reason.kind === "error" && reason.uncaught ? { uncaught: true } : {}) });
          // Every agent this run started (after a switch in progress, the old one too).
          await switcher.detach();
        },
        // The resume line names the session open at exit (after a switch, the one switched to),
        // after detach (task 4.3, mvp-sessions design decision 12), when it can be resumed
        // (session/exit-state.ts); nothing for a session that never started or failed to open.
        // `last-answer` and `transcript` (mvp-conversation task 7.1) wrap at the terminal's width at
        // exit.
        exitText: () => {
          if (openFailed) return "";
          const current = switcher.current();
          const session = current?.controller.getSession() ?? null;
          const state = current?.recorder ? sessionExitState({ controller: current.controller, recorder: current.recorder, opened: current.opened }, current.launch) : null;
          // Read at exit (design D6): a reload may have changed it, unless the command line pinned it.
          return exitText(config.config().exit.print, {
            session,
            width: process.stdout.columns || rendererRef?.width || 80,
            canReopen: state?.canReopen ?? false,
            hadPromptOrOpened: state ? state.hadPrompt || state.openedFromHistory : false,
            adHocCommand: state?.adHocCommand ?? null,
          });
        },
        exit: (code) => {
          config.dispose();
          resetGlyphs();
          // Module-level readers back to the environment's and the defaults (in-process tests run
          // several apps in one process).
          setDrawCapabilities(null);
          setRenderSettings(null);
          capture.restore();
          void clipboard.dispose();
          store.dispose();
          resolve(code);
        },
        async start(renderer, lifecycle) {
          lifecycleRef = lifecycle;
          rendererRef = renderer;
          repainter = installRepaint(renderer);
          // `frame` and `mounted` log events for bench/scale.ts; nothing without ACP_TUI_LOG.
          installFrameLog(renderer, options.logger);
          pace.attach(renderer);
          repainter.onRepaint((cause) => options.logger.log({ event: "repaint", cause }));
          if (hooks.has("crash")) installCrashHook(renderer);
          // The mouse policy in front of every report, the `wheel` log event, and F2. In a JetBrains
          // terminal, cursor keys sent with a wheel report are dropped (renderer/jediterm-filter.ts).
          const jediterm = installJediTermFilter(renderer);
          // A bare `CSI R` is F3 (one PhpStorm tab sent it so; mvp-conversation D8).
          installBareCsiR(renderer);
          terminalSignals.install(renderer);
          // Two ESC bytes in one read are two Esc presses, not Alt+Esc (mvp-chrome-and-keys D11).
          installDoubleEsc(renderer);
          // Ctrl+Break sent as a kitty key (Windows Terminal 1.25) ends acp-tui as SIGBREAK does.
          installCtrlBreakKey(renderer, () => void lifecycle.shutdown({ kind: "signal", signal: "SIGBREAK" }));
          installMouseInput(renderer, {
            policy: () => store.ui.mouse,
            wheel,
            logger: options.logger,
            onWheel: jediterm?.noteWheel,
            intercept: chainIntercepts(
              hover.intercept,
              chainIntercepts(scrollbar.intercept, chainIntercepts(links.intercept, selection.intercept)),
            ),
          });
          logHyperlinks(builtOsc8, options.logger);
          toggleMouse = createMouseToggle({ renderer, chosen: () => chosenMouse, current: () => store.ui.mouse, set: store.setMouse, notify: notice, logger: options.logger });
          // A reload that changes `mouse` applies it by the same guarded path as F2 (design D6).
          reloadMouse = createMouseReload({
            renderer,
            chosen: () => chosenMouse,
            setChosen: (policy) => (chosenMouse = policy),
            current: () => store.ui.mouse,
            set: store.setMouse,
            notify: notice,
            onRefused: () => config.retryOnNextSave(),
            logger: options.logger,
          });
          // Surfaces need the terminal's colours: ask (300 ms at most) before the first frame, so
          // it is drawn with fills or, without a reply, flat. Later replies re-derive them.
          // Derived surfaces also need 24-bit colour; without it the theme stays flat (S1 bug 3).
          // A capability reply can turn truecolour on later, which re-derives and repaints.
          theme.setTruecolour(renderer.capabilities?.rgb ?? false);
          // The newline key the splash and key help name depends on the terminal and on whether
          // it answered the kitty keyboard query (Windows Terminal 1.25 does, 1.24 does not;
          // keys/newline-hint.ts), and the answer can come after the first frame.
          setNewlineHintState({ terminal: terminal.id, kitty: renderer.capabilities?.kitty_keyboard ?? false });
          renderer.on("capabilities", (caps: { rgb: boolean; kitty_keyboard?: boolean }) => {
            setNewlineHintState({ terminal: terminal.id, kitty: caps.kitty_keyboard ?? false });
            if (theme.setTruecolour(caps.rgb)) forceFullRepaint(renderer);
          });
          themeColours = bindTerminalColours(renderer, theme);
          await themeColours.refresh();
          // Later re-queries (task 5.3): resize settle and Ctrl+L, and SIGUSR2 (always repaints).
          // `CSI ? 997 ; n n` needs no hook: OpenTUI (which enables `CSI ? 2031 h` itself)
          // re-queries and the tracker sees the replies; any changed answer repaints.
          const themeRefresh = createThemeRefresh({ colours: themeColours, theme, repaint: () => forceFullRepaint(renderer) });
          repainter.onRepaint(() => void themeRefresh.run());
          lifecycle.onThemeSignal(() => void themeRefresh.run({ always: true }));
          // The blocks that replace the app's own: the find bar's prompt block and the docked cards.
          const blocks = { card: cards.block, ...find.blocks };
          await render(() => <App context={context} layout={layout()} keyMap={extras.keyMap} interrupt={extras.interrupt} blocks={blocks} overlay={overlay} />, renderer);
          extras.onMounted?.({ renderer, lifecycle, store, context });
          // Configuration problems never stop acp-tui: the first and how many are shown as a
          // notice at start-up and after each reload that has any (spec tui-config "Configuration
          // problems are visible"; the `config` module and the palette entry are task 3.4).
          options.logger.log({ event: "config_loaded", files: config.files(), pinned: config.pinned, problems: problemsForLog(config.problems()) });
          // Cut to the border's width, the notice ends with where to read every problem in full.
          const problemsNotice = () => {
            const routeMap = extras.keyMap ?? resolveKeyOverrides(config.config().keys).map;
            const summary = problemNotice(config.problems(), problemsRoute(routeMap));
            if (summary) notice(summary.text, summary);
          };
          problemsNotice();
          // Notices from the command line (an obsolete option, mvp-configuration design D14).
          for (const text of options.notices ?? []) notice(text);
          // Live reload (design D6, task 3.2): a change to a watched file builds a new effective
          // configuration and swaps it into the store's signal; what reads it redraws in the next
          // frame, with the conversation's reading position and focus kept.
          config.onReload((result) => {
            options.logger.log({ event: "config_reload", changed: [...result.changed], problems: problemsForLog(result.problems) });
            if (!extras.layout && result.changed.includes("layout")) setLayout(layoutFromConfig(result.config.layout));
            // Every reload, since a theme file can change without the `theme` section changing.
            if (themeConfig.reload()) forceFullRepaint(renderer);
            // Glyphs are read through the signal in `glyphs.ts`; the full repaint redraws what is
            // painted outside Solid's effects (the cursor bar, the scroll bar).
            if (result.changed.includes("glyphs")) {
              applyGlyphConfig(result.config.glyphs);
              forceFullRepaint(renderer);
            }
            applyBehaviour(result.config, result.changed);
            problemsNotice();
          });
          config.watch({ onWatchError: (dir, error) => options.logger.log({ event: "config_watch_error", dir, code: (error as NodeJS.ErrnoException).code ?? "error" }) });

          // `--resume` without an ID (mvp-sessions tasks 7.2 and 12.7): the agent is launched and
          // initialised so the list can read its `session/list`, and no session exists until a row
          // is chosen (or Esc starts a new one). The list opens with this first frame, from the
          // index, while the agent starts (day-two-feedback D2): `connect` is begun first, so the
          // list knows it is waiting, and it is not awaited; the list reads the agent's page once
          // `ready` resolves, and a start-up failure shows in its footer.
          if (launch.session.kind === "list") {
            // The status row says `connected` once `initialize` has been answered, though no
            // session exists until a row is chosen (task 12.7).
            void switcher.connect().then(
              () => store.setHarnessReady(true),
              () => {},
            );
            if (!lifecycle.shuttingDown) sessionList.open(true, launch.agentSource === "option" ? launch.agentName : null);
            return;
          }
          try {
            // A new session, or the session `--resume <id>` or `--continue` found before the app
            // started (mvp-sessions task groups 5 and 12): the store is attached before a load so the
            // history is drawn as it arrives, and the controller is known from `initialize` on, so
            // Ctrl+D detaches at any point. A load the agent refuses ends with the hint.
            await switcher.start();
          } catch (error) {
            // The exit text names no session that never opened; the error says why.
            if (error instanceof SessionOpenFailure) openFailed = true;
            throw error;
          }
        },
      });
    };
    // Before the renderer (design decision 13): what `--resume <id>` or `--continue` cannot find
    // or open is said below the command line, and nothing is drawn.
    const finding = launch.session.kind === "resume" || launch.session.kind === "continue" ? showFinding(process.stdout) : () => {};
    // On the normal screen the terminal is in its cooked mode, so Ctrl+C is SIGINT: it ends the
    // harness that is being looked in, removes the line and exits with status 130, saying nothing
    // more (spec tui-agent-session "Exit while the harness starts").
    let interrupted = false;
    const onInterrupt = (): void => {
      if (interrupted) return;
      interrupted = true;
      void switcher.detach();
    };
    const interruptedExit = (): void => {
      void switcher.detach().finally(() => {
        options.logger.log({ event: "exit", reason: "signal", before: "renderer" });
        capture.restore();
        store.dispose();
        resolve(130);
      });
    };
    process.on("SIGINT", onInterrupt);
    switcher.prepare().then(
      () => {
        process.off("SIGINT", onInterrupt);
        finding();
        if (interrupted) interruptedExit();
        else run();
      },
      async (error: unknown) => {
        // The interrupt reaches the harness too (the same terminal group): the harness's exit may be
        // noticed before the signal is, so look once more before reporting it as a failure.
        if (!interrupted && error instanceof AgentStartupError) await Bun.sleep(100);
        process.off("SIGINT", onInterrupt);
        finding();
        if (interrupted) {
          interruptedExit();
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        options.logger.log({ event: "exit", reason: "error", before: "renderer" });
        capture.restore();
        store.dispose();
        process.stderr.write(`acp-tui: ${sanitise(message, "approval").trimEnd()}\n`);
        resolve(1);
      },
    );
  });
}
