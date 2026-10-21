// windows-support D5: the tab's title is set again once a harness has started, on Windows only
// (npm's `.cmd` shims run `title %COMSPEC%`). The title machinery is title.test.ts's; this is the
// platform rule of `createTerminalSignals(...).reassertTitle`, with a fake renderer.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, type Session } from "acp-model";
import type { CliRenderer } from "@opentui/core";
import { createTerminalSignals, TITLE_REASSERT_DELAY_MS, TITLE_WATCH_INTERVAL_MS, TITLE_WATCH_MAX_WRITES } from "../../src/renderer/terminal-signals.ts";
import { createTitleSlots } from "../../src/renderer/title-slot.ts";

let dir: string;
let realWrite: typeof process.stdout.write;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-signals-title-"));
  // The escape output of a renderer without a session goes to stdout; keep it out of the report.
  realWrite = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
});
afterEach(() => {
  process.stdout.write = realWrite;
  rmSync(dir, { recursive: true, force: true });
});

function fixture(platform: NodeJS.Platform) {
  const session: Session = { ...createSession(), cwd: "/work/acp-tui" };
  const titles: string[] = [];
  const renderer = {
    isDestroyed: false,
    setTerminalTitle: (t: string) => void titles.push(t),
    on() {},
    off() {},
    stdinParser: { push: () => undefined },
  } as unknown as CliRenderer;
  const store = { snapshot: () => session, onChange: () => () => {}, ui: { mouse: "wheel" } } as never;
  const signals = createTerminalSignals({ store, platform, env: {}, titleSlots: createTitleSlots({ dir }) });
  return { signals, renderer, titles };
}

describe("reassertTitle", () => {
  test("on Windows it sets the current title again", () => {
    const f = fixture("win32");
    f.signals.install(f.renderer);
    expect(f.titles).toEqual(["acp-tui"]);
    f.signals.reassertTitle();
    expect(f.titles).toEqual(["acp-tui", "acp-tui"]);
    f.signals.restore();
  });

  test("on Linux and macOS it writes nothing", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const f = fixture(platform);
      f.signals.install(f.renderer);
      f.signals.reassertTitle();
      expect(f.titles).toEqual(["acp-tui"]);
      f.signals.restore();
    }
  });

  test("before the renderer is installed it does nothing", () => {
    const f = fixture("win32");
    f.signals.reassertTitle();
    expect(f.titles).toEqual([]);
  });

  test("a harness that answered before the renderer existed (--resume <id>, --continue): the title is set again as the renderer installs, on Windows", () => {
    const f = fixture("win32");
    f.signals.reassertTitle();
    f.signals.reassertTitle();
    expect(f.titles).toEqual([]);
    f.signals.install(f.renderer);
    expect(f.titles).toEqual(["acp-tui", "acp-tui"]);
    // Remembered once: a later call is its own reassertion.
    f.signals.reassertTitle();
    expect(f.titles).toEqual(["acp-tui", "acp-tui", "acp-tui"]);
    f.signals.restore();
  });

  test("the same on Linux and macOS writes the title once, as before", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const f = fixture(platform);
      f.signals.reassertTitle();
      f.signals.install(f.renderer);
      expect(f.titles).toEqual(["acp-tui"]);
      f.signals.restore();
    }
  });
});

// windows-support D5, the built-in Claude harness: `claude.exe` names the tab as its process
// starts (after `initialize`, at session/new), and a command a tool runs may too.
describe("harnessActivity", () => {
  function timed(platform: NodeJS.Platform) {
    const f = fixture(platform);
    const pending: { run: () => void; ms: number; cancelled: boolean }[] = [];
    const signals = createTerminalSignals({
      store: { snapshot: () => ({ ...createSession(), cwd: "/work/acp-tui" }), onChange: () => () => {}, ui: { mouse: "wheel" } } as never,
      platform,
      env: {},
      titleSlots: createTitleSlots({ dir }),
      schedule: (run, ms) => {
        const entry = { run, ms, cancelled: false };
        pending.push(entry);
        return () => void (entry.cancelled = true);
      },
    });
    signals.install(f.renderer);
    const fire = () => pending.filter((e) => !e.cancelled).forEach((e) => ((e.cancelled = true), e.run()));
    return { signals, titles: f.titles, pending, fire };
  }

  test("on Windows a session created or opened and a turn that ended set the title at once", () => {
    const t = timed("win32");
    expect(t.titles).toEqual(["acp-tui"]);
    t.signals.harnessActivity("session");
    expect(t.titles).toEqual(["acp-tui", "acp-tui"]);
    t.signals.harnessActivity("turn_end");
    expect(t.titles).toEqual(["acp-tui", "acp-tui", "acp-tui"]);
    expect(t.pending).toHaveLength(0);
    t.signals.restore();
  });

  test("on Windows a burst of tool call ends is one write after the delay", () => {
    const t = timed("win32");
    t.signals.harnessActivity("tool");
    t.signals.harnessActivity("tool");
    t.signals.harnessActivity("tool");
    expect(t.titles).toEqual(["acp-tui"]);
    expect(t.pending).toHaveLength(1);
    expect(t.pending[0]!.ms).toBe(TITLE_REASSERT_DELAY_MS);
    t.fire();
    expect(t.titles).toEqual(["acp-tui", "acp-tui"]);
    // The next one schedules again.
    t.signals.harnessActivity("tool");
    t.fire();
    expect(t.titles).toHaveLength(3);
    t.signals.restore();
  });

  test("a turn that ends covers a tool call's pending write", () => {
    const t = timed("win32");
    t.signals.harnessActivity("tool");
    t.signals.harnessActivity("turn_end");
    expect(t.titles).toHaveLength(2);
    t.fire();
    expect(t.titles).toHaveLength(2);
    t.signals.restore();
  });

  test("a write waiting when the terminal is restored is cancelled", () => {
    const t = timed("win32");
    t.signals.harnessActivity("tool");
    t.signals.restore();
    expect(t.pending[0]!.cancelled).toBe(true);
    t.fire();
    expect(t.titles).toEqual(["acp-tui"]);
  });

  test("before the renderer is installed the first call is remembered, as reassertTitle does", () => {
    const f = fixture("win32");
    f.signals.harnessActivity("session");
    f.signals.install(f.renderer);
    expect(f.titles).toEqual(["acp-tui", "acp-tui"]);
    f.signals.restore();
  });

  test("on Linux and macOS it writes nothing and schedules nothing", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const t = timed(platform);
      t.signals.harnessActivity("session");
      t.signals.harnessActivity("turn_end");
      t.signals.harnessActivity("tool");
      expect(t.pending).toHaveLength(0);
      expect(t.titles).toEqual(["acp-tui"]);
      t.signals.restore();
    }
  });
});

// windows-support D5, decision 16 as amended: between those moments the console's title is read
// every half second and acp-tui's set again when something else has changed it (Claude Code's
// process started for a prompt names the tab after a turn that failed at once has ended).
describe("title watch", () => {
  function watched(platform: NodeJS.Platform, read: (() => string | null) | null = null) {
    const f = fixture(platform);
    let console = "acp-tui";
    const ticks: { run: () => void; ms: number; stopped: boolean }[] = [];
    const titles: string[] = [];
    const renderer = {
      ...(f.renderer as object),
      setTerminalTitle: (t: string) => {
        titles.push(t);
        console = t;
      },
    } as unknown as CliRenderer;
    const signals = createTerminalSignals({
      store: { snapshot: () => ({ ...createSession(), cwd: "/work/acp-tui" }), onChange: () => () => {}, ui: { mouse: "wheel" } } as never,
      platform,
      env: {},
      titleSlots: createTitleSlots({ dir }),
      consoleTitle: read ?? (() => console),
      every: (run, ms) => {
        const entry = { run, ms, stopped: false };
        ticks.push(entry);
        return () => void (entry.stopped = true);
      },
    });
    signals.install(renderer);
    const tick = () => ticks.filter((e) => !e.stopped).forEach((e) => e.run());
    const retitle = (text: string) => void (console = text);
    return { signals, titles, ticks, tick, retitle };
  }

  test("on Windows a title changed behind acp-tui's back is set again at the next read", () => {
    const w = watched("win32");
    expect(w.ticks).toHaveLength(1);
    expect(w.ticks[0]!.ms).toBe(TITLE_WATCH_INTERVAL_MS);
    w.tick();
    expect(w.titles).toEqual(["acp-tui"]);
    w.retitle("claude");
    w.tick();
    expect(w.titles).toEqual(["acp-tui", "acp-tui"]);
    w.tick();
    expect(w.titles).toHaveLength(2);
    // Each later change is set back again.
    w.retitle("Administrator:  C:\\WINDOWS\\system32\\cmd.exe");
    w.tick();
    expect(w.titles).toHaveLength(3);
    w.signals.restore();
  });

  test("a console that keeps another title gets a few writes, then is left be until it changes", () => {
    const w = watched("win32", () => "stuck");
    for (let i = 0; i < 10; i++) w.tick();
    expect(w.titles).toHaveLength(1 + TITLE_WATCH_MAX_WRITES);
    w.signals.restore();
  });

  test("a title that cannot be read is left alone", () => {
    const w = watched("win32", () => null);
    w.tick();
    w.tick();
    expect(w.titles).toEqual(["acp-tui"]);
    w.signals.restore();
  });

  test("the watch stops when the terminal is restored", () => {
    const w = watched("win32");
    w.signals.restore();
    expect(w.ticks[0]!.stopped).toBe(true);
    w.retitle("claude");
    w.ticks[0]!.run();
    expect(w.titles).toEqual(["acp-tui"]);
  });

  test("on Linux and macOS there is no watch", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const w = watched(platform);
      expect(w.ticks).toHaveLength(0);
      w.signals.restore();
    }
  });

  test("without a reader (a platform given by a test, or no kernel32) there is no watch", () => {
    const f = fixture("win32");
    const ticks: number[] = [];
    const signals = createTerminalSignals({
      store: { snapshot: () => ({ ...createSession(), cwd: "/work/acp-tui" }), onChange: () => () => {}, ui: { mouse: "wheel" } } as never,
      platform: "win32",
      env: {},
      titleSlots: createTitleSlots({ dir }),
      every: (_run, ms) => (ticks.push(ms), () => {}),
    });
    signals.install(f.renderer);
    expect(ticks).toEqual([]);
    signals.restore();
  });
});
