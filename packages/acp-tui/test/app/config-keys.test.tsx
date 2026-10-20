// mvp-configuration tasks 8.1, 8.4 and 3.4 in the test renderer (no PTY): the
// App with a configuration store over an in-memory file. Key overrides from the
// file are bound, re-registered when a reload changes them (an armed two-press
// state disarmed by the swap), their problems go into the store, the `config`
// module counts them, and the palette's `Configuration problems` lists them.
// Needs the root bunfig `[test] preload`; run from the repository root.
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSession, reduce, type ModelEvent, type Session } from "acp-model";
import { App } from "../../src/app/App.tsx";
import type { AppActions, AppContextValue } from "../../src/app/context.ts";
import { createConfigStore, type ConfigStore } from "../../src/config/store.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layoutFromConfig } from "../../src/layout/from-config.ts";
import { createPalette } from "../../src/overlay/Overlay.tsx";
import { createSessionStore, type SessionStore } from "../../src/session/store.ts";
import { DEFAULT_THEME, resolveTheme } from "../../src/theme/index.ts";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup | undefined;
let store: SessionStore | undefined;
afterEach(async () => {
  await setup?.dispose();
  store?.dispose();
  setup = undefined;
  store = undefined;
});

const ROWS = 24;
const COLS = 80;

/** A configuration store over a user file in a temporary configuration home (the app places key
 *  problems by reading the files), edited by `set`. */
function fileConfig(initial: string | null): { config: ConfigStore; path: string; set(text: string | null): void } {
  const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-cfg-")));
  mkdirSync(join(home, "acp-tui"));
  const path = join(home, "acp-tui", "config.jsonc");
  const set = (text: string | null) => (text === null ? rmSync(path, { force: true }) : writeFileSync(path, text));
  set(initial);
  const config = createConfigStore({ env: { XDG_CONFIG_HOME: home, HOME: "/home/u" }, sessionDirectory: null });
  return { config, path, set };
}

async function mount(file: string | null) {
  const { config, set, path } = fileConfig(file);
  let session: Session = createSession();
  const listeners = new Set<(s: Session) => void>();
  const dispatch = (event: ModelEvent) => {
    session = reduce(session, event);
    for (const l of listeners) l(session);
  };
  const exits: number[] = [];
  store = createSessionStore({ home: "/home/u" });
  const actions: AppActions = { prompt: () => null, cancel() {}, answerPermission: () => false, exit: () => void exits.push(1) };
  const context: AppContextValue = { store, actions, theme: resolveTheme(DEFAULT_THEME), config };
  const palette = createPalette();
  setup = await testRender(() => <App context={context} layout={layoutFromConfig(config.config().layout)} overlay={palette.overlay} />, {
    width: COLS,
    height: ROWS,
    screenMode: "alternate-screen",
  });
  dispatch({ type: "session_created", at: 0, cwd: "/home/u/proj", agentInfo: { name: "fake-agent", version: "1" }, response: { sessionId: "s" } });
  store.attach({ getSession: () => session, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) });
  const frame = async () => {
    for (let i = 0; i < 2; i++) {
      await setup!.flush();
      await setup!.renderOnce();
    }
    return setup!.captureCharFrame().split("\n").slice(0, ROWS).map((l) => l.trimEnd());
  };
  const statusRow = async () => (await frame()).at(-2)!;
  /** A turn running with an empty prompt box, so Ctrl+D arms detach. */
  const running = () => dispatch({ type: "prompt_sent", text: "go", at: 1 });
  return { config, set, path, frame, statusRow, running, exits };
}

describe("key overrides in the app (task 8.1)", () => {
  test("Default removed and rebound: ctrl+d arms nothing during a turn, and ctrl+q arms detach naming ctrl+q", async () => {
    const app = await mount(`{ "keys": { "global": { "ctrl+d": null, "ctrl+q": "detach" } } }`);
    app.running();
    await app.frame();
    setup!.mockInput.pressKey("d", { ctrl: true });
    expect(await app.statusRow()).not.toContain("again to detach");
    setup!.mockInput.pressKey("q", { ctrl: true });
    expect(await app.statusRow()).toContain("ctrl+q again to detach");
    expect(app.config.problems()).toEqual([]);
  });

  test("a reload re-registers the keys: ctrl+q detaches after the file binds it, and an armed state is disarmed by the swap", async () => {
    const app = await mount(null);
    app.running();
    await app.frame();
    setup!.mockInput.pressKey("d", { ctrl: true });
    expect(await app.statusRow()).toContain("ctrl+d again to detach");
    app.set(`{ "keys": { "global": { "ctrl+d": null, "ctrl+q": "detach" } } }`);
    expect(app.config.reload().changed).toEqual(["keys"]);
    // The swap disarmed what Ctrl+D had armed.
    expect(await app.statusRow()).not.toContain("again to detach");
    setup!.mockInput.pressKey("d", { ctrl: true });
    expect(await app.statusRow()).not.toContain("again to detach");
    setup!.mockInput.pressKey("q", { ctrl: true });
    expect(await app.statusRow()).toContain("ctrl+q again to detach");
    setup!.mockInput.pressKey("q", { ctrl: true });
    await app.frame();
    expect(app.exits).toEqual([1]);
  });

  test("the idle hints follow a reloaded key map", async () => {
    const app = await mount(null);
    expect(await app.statusRow()).toContain("ctrl+d detach");
    app.set(`{ "keys": { "global": { "ctrl+d": null, "ctrl+q": "detach" } } }`);
    app.config.reload();
    expect(await app.statusRow()).toContain("ctrl+q detach");
  });
});

describe("configuration problems in the app (tasks 3.4 and 8.4)", () => {
  test("key problems join the store's problems before the first frame, the config mark counts them, and a reload that fixes them clears it", async () => {
    const app = await mount(['{ "density": "sideways",', '  "keys": { "prompt": { "q": "paste" } } }'].join("\n"));
    expect(app.config.problems().map((p) => p.path)).toEqual(["density", "keys.prompt.q"]);
    expect(app.config.problems()[1]).toMatchObject({ file: app.path, line: 2, column: 25 });
    expect(await app.statusRow()).toMatch(/config 2 .*connected$/);
    app.set(`{ "density": "focus" }`);
    const result = app.config.reload();
    expect(result.problems).toEqual([]);
    expect(await app.statusRow()).not.toContain("config");
  });

  test("Problems listed in the palette: Configuration problems lists both, each with its file, line and setting", async () => {
    const app = await mount(['{ "density": "sideways",', '  "keys": { "prompt": { "q": "paste" } } }'].join("\n"));
    await app.frame();
    setup!.mockInput.pressKey("p", { ctrl: true });
    await app.frame();
    await setup!.mockInput.typeText("configuration");
    const listed = (await app.frame()).join("\n");
    expect(listed).toContain("Configuration problems");
    setup!.mockInput.pressEnter();
    await Bun.sleep(10);
    const rows = await app.frame();
    const text = rows.join("\n");
    expect(text).toContain(app.path.slice(0, COLS - 6));
    expect(text).toMatch(/1:14 density .*takes/);
    expect(text).toMatch(/2:25 keys\.prompt\.q .*would no longer type/);
  });

  test("with no problems the list says so", async () => {
    const app = await mount(null);
    await app.frame();
    setup!.mockInput.pressKey("p", { ctrl: true });
    await app.frame();
    await setup!.mockInput.typeText("configuration problems");
    await app.frame();
    setup!.mockInput.pressEnter();
    await Bun.sleep(10);
    expect((await app.frame()).join("\n")).toContain("no configuration problems");
  });
});
