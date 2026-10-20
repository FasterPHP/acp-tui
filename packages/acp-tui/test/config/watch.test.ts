// mvp-configuration task 3.1: the configuration watcher (design D6; spec
// tui-config "Live reload", scenario "Save through a rename"). Directories are
// watched, not files; events are debounced by 150 ms and filtered by a content
// hash; a failed watch is re-established. A fake clock and a fake `fs.watch`
// drive the unit tests over real files; the test with the real ones is in watch.timing.test.ts
// (parallel-tests: it ends in a time bound, so it runs in the serial pass).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigWatcher, DEBOUNCE_MS, type Clock, type WatchFn } from "../../src/config/watch.ts";

const temp = (prefix: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));

/** A clock whose time only `advance` moves. */
function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    setTimeout(fn, ms) {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

/** A stand-in for `fs.watch`: records each watch and lets the test emit events and errors. */
function fakeWatch() {
  const watches: { dir: string; onEvent: (name: string | null) => void; onError: (e: unknown) => void; closed: boolean }[] = [];
  const watch: WatchFn = (dir, onEvent, onError) => {
    const entry = { dir, onEvent, onError, closed: false };
    watches.push(entry);
    return { close: () => void (entry.closed = true) };
  };
  const live = (dir: string) => watches.filter((w) => w.dir === dir && !w.closed);
  return {
    watch,
    watches,
    live,
    emit(dir: string, name: string | null) {
      for (const w of live(dir)) w.onEvent(name);
    },
    fail(dir: string) {
      for (const w of live(dir)) w.onError(Object.assign(new Error("watch failed"), { code: "EIO" }));
    },
  };
}

function setUp() {
  const dir = temp("acp-tui-watch-");
  const file = join(dir, "config.jsonc");
  writeFileSync(file, `{ "density": "compact" }`);
  const clock = fakeClock();
  const fs = fakeWatch();
  let changes = 0;
  const watcher = createConfigWatcher({
    targets: () => [{ dir, accept: (name) => name === null || name === "config.jsonc" }],
    files: () => [file],
    onChange: () => void changes++,
    clock: clock.clock,
    watch: fs.watch,
  });
  /** Saves as an editor does: a temporary file renamed over the original, with both events. */
  const renameSave = (text: string) => {
    const tmp = join(dir, "config.jsonc.tmp");
    writeFileSync(tmp, text);
    fs.emit(dir, "config.jsonc.tmp");
    renameSync(tmp, file);
    fs.emit(dir, "config.jsonc.tmp");
    fs.emit(dir, "config.jsonc");
  };
  return { dir, file, clock, fs, watcher, renameSave, changes: () => changes };
}

describe("the configuration watcher (task 3.1)", () => {
  test("Save through a rename: the change is applied once, 150 ms after the last event, and a later save is applied too", () => {
    const t = setUp();
    expect(t.fs.live(t.dir)).toHaveLength(1);
    t.renameSave(`{ "density": "verbose" }`);
    t.clock.advance(DEBOUNCE_MS - 1);
    expect(t.changes()).toBe(0);
    t.clock.advance(1);
    expect(t.changes()).toBe(1);
    // The directory's watch survives the rename: the same watch sees the next save.
    t.renameSave(`{ "density": "focus" }`);
    t.clock.advance(DEBOUNCE_MS);
    expect(t.changes()).toBe(2);
    expect(t.fs.watches).toHaveLength(1);
    t.watcher.close();
  });

  test("events in quick succession are one change", () => {
    const t = setUp();
    writeFileSync(t.file, `{ "density": "verbose" }`);
    for (let i = 0; i < 5; i++) {
      t.fs.emit(t.dir, "config.jsonc");
      t.clock.advance(100);
    }
    expect(t.changes()).toBe(0);
    t.clock.advance(DEBOUNCE_MS);
    expect(t.changes()).toBe(1);
  });

  test("a save that changes nothing does nothing; events for other files are ignored", () => {
    const t = setUp();
    writeFileSync(t.file, `{ "density": "compact" }`);
    t.fs.emit(t.dir, "config.jsonc");
    t.clock.advance(DEBOUNCE_MS);
    expect(t.changes()).toBe(0);
    writeFileSync(join(t.dir, "notes.txt"), "x");
    t.fs.emit(t.dir, "notes.txt");
    expect(t.clock.pending()).toBe(0);
  });

  test("a deleted then recreated file: each is a change", () => {
    const t = setUp();
    rmSync(t.file);
    t.fs.emit(t.dir, "config.jsonc");
    t.clock.advance(DEBOUNCE_MS);
    expect(t.changes()).toBe(1);
    writeFileSync(t.file, `{ "density": "focus" }`);
    t.fs.emit(t.dir, "config.jsonc");
    t.clock.advance(DEBOUNCE_MS);
    expect(t.changes()).toBe(2);
  });

  test("a watch that errors is re-established after the retry delay, and a change made meanwhile is seen", () => {
    const t = setUp();
    t.fs.fail(t.dir);
    expect(t.fs.live(t.dir)).toHaveLength(0);
    writeFileSync(t.file, `{ "density": "verbose" }`);
    t.clock.advance(1000);
    expect(t.fs.live(t.dir)).toHaveLength(1);
    expect(t.changes()).toBe(1);
  });

  test("a directory that does not exist yet is waited for on its nearest ancestor, then watched", () => {
    const base = temp("acp-tui-watch-");
    const dir = join(base, "acp-tui");
    const file = join(dir, "config.jsonc");
    const clock = fakeClock();
    const fs = fakeWatch();
    let changes = 0;
    const watcher = createConfigWatcher({
      targets: () => [{ dir, accept: (name) => name === "config.jsonc" }],
      files: () => [file],
      onChange: () => void changes++,
      clock: clock.clock,
      watch: fs.watch,
    });
    expect(fs.live(base)).toHaveLength(1);
    mkdirSync(dir);
    writeFileSync(file, `{ "mouse": "off" }`);
    fs.emit(base, "acp-tui");
    clock.advance(DEBOUNCE_MS);
    expect(changes).toBe(1);
    expect(fs.live(base)).toHaveLength(0);
    expect(fs.live(dir)).toHaveLength(1);
    // A directory removed under the watch goes back to waiting on its ancestor.
    rmSync(dir, { recursive: true });
    fs.emit(dir, "config.jsonc"); // the file goes with its directory
    clock.advance(DEBOUNCE_MS);
    expect(changes).toBe(2);
    expect(fs.live(base)).toHaveLength(1);
    watcher.close();
    expect(fs.live(base)).toHaveLength(0);
  });
});
