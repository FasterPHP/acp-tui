// Unsent drafts kept per session: the store (spec tui-sessions "Draft files are private", "Draft
// limits and failures", "Draft files are not trusted", "State location on Windows" "Drafts beside
// the index"), and the keeper's rules for what is kept, restored and printed.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftsDirectory } from "../../src/platform/paths.ts";
import { createDraftKeeper, type DraftHandle } from "../../src/session/draft-keeper.ts";
import { createDraftStore, draftFileName, MAX_DRAFT_BYTES, type Draft } from "../../src/session/drafts.ts";
import { WINDOWS } from "../windows.ts";

const roots: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-drafts-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Gone.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

const KEY = { harness: "fake", sessionId: "s-1" };
const draft = (text: string, cursor = text.length, mentions: Draft["mentions"] = []): Draft => ({ text, cursor, mentions });

describe("the draft store", () => {
  test("round trip: text with a line break and a tab, the cursor and an intact mention", () => {
    const dir = join(scratch(), "drafts");
    const store = createDraftStore({ dir });
    const text = "look\tat @src/app.ts\nthen fix";
    const mentions = [{ start: 8, end: 19, path: "src/app.ts", text: "@src/app.ts" }];
    expect(store.save(KEY, draft(text, 4, mentions))).toBe("saved");
    expect(store.load(KEY)).toEqual({ text, cursor: 4, mentions });
  });

  test("the file is named by a hash of the harness and the session ID, so a hostile ID never reaches a path", () => {
    const dir = join(scratch(), "drafts");
    const store = createDraftStore({ dir });
    const hostile = { harness: "fake", sessionId: "../../etc/passwd" };
    store.save(hostile, draft("x"));
    expect(readdirSync(dir)).toEqual([draftFileName(hostile)]);
    expect(draftFileName(hostile)).toMatch(/^[0-9a-f]{64}\.json$/);
    expect(draftFileName({ harness: "a", sessionId: "bc" })).not.toBe(draftFileName({ harness: "ab", sessionId: "c" }));
  });

  test.skipIf(WINDOWS)("the file has mode 0600 and the directory 0700, also when the directory existed wider", () => {
    const dir = join(scratch(), "drafts");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    createDraftStore({ dir }).save(KEY, draft("secret"));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, draftFileName(KEY))).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  test("an empty draft removes the file, and remove is quiet when there is none", () => {
    const dir = join(scratch(), "drafts");
    const store = createDraftStore({ dir });
    store.save(KEY, draft("x"));
    expect(existsSync(join(dir, draftFileName(KEY)))).toBe(true);
    store.save(KEY, draft(""));
    expect(store.load(KEY)).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
    store.remove(KEY);
  });

  test("Last writer wins: two stores on one key, the later save is the one loaded", () => {
    const dir = join(scratch(), "drafts");
    const first = createDraftStore({ dir });
    const second = createDraftStore({ dir });
    first.save(KEY, draft("one"));
    second.save(KEY, draft("two"));
    expect(first.load(KEY)?.text).toBe("two");
  });

  test("Too large: over 256 KiB of UTF-8 is not stored, and an older draft of the session does not come back", () => {
    const dir = join(scratch(), "drafts");
    const store = createDraftStore({ dir });
    store.save(KEY, draft("older"));
    expect(store.save(KEY, draft("x".repeat(MAX_DRAFT_BYTES + 1)))).toBe("too_large");
    expect(store.load(KEY)).toBeNull();
    // Counted in bytes, not characters: 100k two-byte characters are 200 KB, 140k are over.
    expect(store.save(KEY, draft("é".repeat(100_000)))).toBe("saved");
    expect(store.save(KEY, draft("é".repeat(140_000)))).toBe("too_large");
    expect(store.save(KEY, draft("x".repeat(MAX_DRAFT_BYTES)))).toBe("saved");
  });

  test("At most 200 files: the oldest by savedAt are removed first", () => {
    const dir = join(scratch(), "drafts");
    let clock = 1000;
    const store = createDraftStore({ dir, maxFiles: 3, now: () => clock++ });
    for (const id of ["a", "b", "c", "d", "e"]) store.save({ harness: "h", sessionId: id }, draft(id));
    expect(readdirSync(dir)).toHaveLength(3);
    expect(store.load({ harness: "h", sessionId: "a" })).toBeNull();
    expect(store.load({ harness: "h", sessionId: "b" })).toBeNull();
    for (const id of ["c", "d", "e"]) expect(store.load({ harness: "h", sessionId: id })?.text).toBe(id);
  });

  test("a store that cannot write warns once, returns failed, and carries on", () => {
    const base = scratch();
    // `drafts` is a file, so the directory cannot be made.
    const dir = join(base, "drafts");
    writeFileSync(dir, "not a directory");
    const warnings: string[] = [];
    const store = createDraftStore({ dir, onWarning: (t) => warnings.push(t) });
    expect(store.save(KEY, draft("a"))).toBe("failed");
    expect(store.save(KEY, draft("b"))).toBe("failed");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith("cannot keep the draft");
    expect(store.load(KEY)).toBeNull();
  });

  test.skipIf(WINDOWS || process.getuid?.() === 0)("a read-only state directory: failed, one warning, no temporary file left", () => {
    const base = scratch();
    const dir = join(base, "drafts");
    chmodSync(base, 0o500);
    const warnings: string[] = [];
    const store = createDraftStore({ dir, onWarning: (t) => warnings.push(t) });
    expect(store.save(KEY, draft("a"))).toBe("failed");
    expect(warnings).toHaveLength(1);
    chmodSync(base, 0o700);
    expect(readdirSync(base)).toEqual([]);
  });

  describe("files are not trusted", () => {
    function plant(store: string, key: typeof KEY, body: unknown): void {
      mkdirSync(store, { recursive: true });
      writeFileSync(join(store, draftFileName(key)), typeof body === "string" ? body : JSON.stringify(body));
    }
    const good = { version: 1, harness: "fake", sessionId: "s-1", text: "hello", cursor: 2, mentions: [], savedAt: 1 };

    test("not JSON, a torn file, another version, another session and a missing text are ignored", () => {
      const dir = join(scratch(), "drafts");
      const store = createDraftStore({ dir });
      for (const body of ['{"version":1,"harness":"fa', "null", "[]", { ...good, version: 2 }, { ...good, sessionId: "other" }, { ...good, harness: "other" }, { ...good, text: 5 }]) {
        plant(dir, KEY, body);
        expect(store.load(KEY)).toBeNull();
      }
      plant(dir, KEY, good);
      expect(store.load(KEY)?.text).toBe("hello");
    });

    test("a file over the size limit is ignored", () => {
      const dir = join(scratch(), "drafts");
      plant(dir, KEY, { ...good, text: "x".repeat(MAX_DRAFT_BYTES + 1) });
      expect(createDraftStore({ dir }).load(KEY)).toBeNull();
      plant(dir, KEY, { ...good, text: "x".repeat(3 * 1024 * 1024) });
      expect(createDraftStore({ dir }).load(KEY)).toBeNull();
    });

    test("Hostile draft file: the input rule removes the sequence and the bell, a mention that does not hold its text is plain text, the cursor is clamped", () => {
      const dir = join(scratch(), "drafts");
      const text = "a\u001b]52;c;ZXZpbA==\u0007b\u0007c @x/y";
      plant(dir, KEY, { ...good, text, cursor: 9999, mentions: [{ start: 0, end: 3, path: "x/y", text: "@x/y" }] });
      const loaded = createDraftStore({ dir }).load(KEY)!;
      expect(loaded.text).toBe("abc @x/y");
      expect(loaded.text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
      expect(loaded.mentions).toEqual([]);
      expect(loaded.cursor).toBe(loaded.text.length);
    });

    test("a mention is kept when its range holds exactly its text, dropped when out of range, overlapping or malformed", () => {
      const dir = join(scratch(), "drafts");
      const text = "see @a/b and @c";
      const mentions = [
        { start: 4, end: 8, path: "a/b", text: "@a/b" },
        { start: 13, end: 99, path: "c", text: "@c" },
        { start: 5, end: 7, path: "z", text: "a/" },
        { start: -1, end: 2, path: "z", text: "se" },
        { start: "4", end: 8, path: "a/b", text: "@a/b" },
        { start: 13, end: 15, path: 7, text: "@c" },
        { start: 13, end: 15, path: "c", text: "@c" },
      ];
      plant(dir, KEY, { ...good, text, cursor: -5, mentions });
      const loaded = createDraftStore({ dir }).load(KEY)!;
      expect(loaded.mentions.map((m) => m.text)).toEqual(["@a/b", "@c"]);
      expect(loaded.cursor).toBe(0);
    });

    test("a text the input rule changes keeps no mentions (their ranges no longer mean the same characters)", () => {
      const dir = join(scratch(), "drafts");
      plant(dir, KEY, { ...good, text: "\u0007@a/b", cursor: 1, mentions: [{ start: 1, end: 5, path: "a/b", text: "@a/b" }] });
      expect(createDraftStore({ dir }).load(KEY)).toEqual({ text: "@a/b", cursor: 1, mentions: [] });
    });

    test("a draft that is nothing after the input rule is not a draft", () => {
      const dir = join(scratch(), "drafts");
      plant(dir, KEY, { ...good, text: "\u0007\u001b[31m" });
      expect(createDraftStore({ dir }).load(KEY)).toBeNull();
    });
  });
});

describe("where drafts live", () => {
  test("Drafts beside the index: `drafts` in the state directory, on Linux and on Windows", () => {
    expect(draftsDirectory({ XDG_STATE_HOME: "/s" }, "linux")).toBe("/s/acp-tui/drafts");
    expect(draftsDirectory({ HOME: "/h" }, "linux")).toBe("/h/.local/state/acp-tui/drafts");
    expect(draftsDirectory({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32")).toBe("C:\\Users\\u\\AppData\\Local\\acp-tui\\drafts");
    expect(draftsDirectory({ XDG_STATE_HOME: "D:\\state", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32")).toBe("D:\\state\\acp-tui\\drafts");
  });
});

// -- The keeper ------------------------------------------------------------------------------------

interface FakeSession {
  readonly launch: { agentName: string };
  readonly recorder: { answered: boolean } | null;
  readonly opened: boolean;
  readonly controller: { support: { load: boolean; resume: boolean }; getSession: () => { id: string | null } };
}

function current(options: { load?: boolean; resume?: boolean; answered?: boolean; opened?: boolean; id?: string | null; recorder?: boolean } = {}): FakeSession {
  return {
    launch: { agentName: "fake" },
    recorder: options.recorder === false ? null : { answered: options.answered ?? false },
    opened: options.opened ?? false,
    controller: { support: { load: options.load ?? true, resume: options.resume ?? false }, getSession: () => ({ id: options.id === undefined ? "s-1" : options.id }) },
  };
}

function box(initial: Draft | null = null): DraftHandle & { value: Draft | null; cleared: number; replaced: (Draft | null)[]; restored: Draft[] } {
  const handle = {
    value: initial,
    cleared: 0,
    replaced: [] as (Draft | null)[],
    restored: [] as Draft[],
    draft: () => handle.value,
    restore(d: Draft) {
      handle.restored.push(d);
      handle.value = d;
    },
    clear() {
      handle.cleared++;
      handle.value = null;
    },
    replace(d: Draft | null) {
      handle.replaced.push(d);
      handle.value = d;
    },
  };
  return handle;
}

function keeper(session: FakeSession | null, enabled = true) {
  const dir = join(scratch(), "drafts");
  const store = createDraftStore({ dir });
  const state = { enabled, session };
  const k = createDraftKeeper({ store, enabled: () => state.enabled, current: () => state.session as never });
  return { k, store, state };
}

describe("the draft keeper", () => {
  test("a session that can be reopened keeps its draft at exit and prints nothing", () => {
    const { k, store } = keeper(current({ answered: true }));
    const handle = box(draft("half a thought"));
    k.bind(handle);
    expect(k.leaveForExit()).toBeNull();
    expect(store.load(KEY)?.text).toBe("half a thought");
  });

  test("Not kept before the first answered prompt: the text is returned for the exit text and nothing is written", () => {
    const { k, store } = keeper(current({ answered: false, opened: false }));
    k.bind(box(draft("explain the build")));
    expect(k.leaveForExit()).toBe("explain the build");
    expect(store.load(KEY)).toBeNull();
  });

  test("a session opened from history keeps a draft without an answered prompt", () => {
    const { k, store } = keeper(current({ opened: true }));
    k.bind(box(draft("x")));
    expect(k.leaveForExit()).toBeNull();
    expect(store.load(KEY)?.text).toBe("x");
  });

  test("an agent that advertises neither load nor resume, or a session without an ID, prints the draft", () => {
    for (const session of [current({ load: false, resume: false, opened: true }), current({ id: null, opened: true }), current({ recorder: false })]) {
      const { k } = keeper(session);
      k.bind(box(draft("keep me")));
      expect(k.leaveForExit()).toBe("keep me");
    }
    const none = keeper(null);
    none.k.bind(box(draft("keep me")));
    expect(none.k.leaveForExit()).toBe("keep me");
  });

  test("Store turned off: nothing is written, the draft is printed, and a file from an earlier run is left in place", () => {
    const { k, store, state } = keeper(current({ opened: true }), false);
    store.save(KEY, draft("older"));
    k.bind(box(draft("half a thought")));
    expect(k.leaveForExit()).toBe("half a thought");
    expect(store.load(KEY)?.text).toBe("older");
    k.enter("fake", "s-1");
    state.enabled = true;
  });

  test("an empty box removes the session's file (Removed when emptied)", () => {
    const { k, store } = keeper(current({ opened: true }));
    store.save(KEY, draft("older"));
    k.bind(box(null));
    expect(k.leaveForExit()).toBeNull();
    expect(store.load(KEY)).toBeNull();
  });

  test("a draft too large to store, or a store that fails, is printed instead", () => {
    const big = keeper(current({ opened: true }));
    big.k.bind(box(draft("x".repeat(MAX_DRAFT_BYTES + 1))));
    expect(big.k.leaveForExit()).toHaveLength(MAX_DRAFT_BYTES + 1);

    const dir = join(scratch(), "drafts");
    writeFileSync(dir, "a file");
    const k = createDraftKeeper({ store: createDraftStore({ dir }), enabled: () => true, current: () => current({ opened: true }) as never });
    k.bind(box(draft("half a thought")));
    expect(k.leaveForExit()).toBe("half a thought");
  });

  test("Removed once sent: forget removes the file of the session in use", () => {
    const { k, store } = keeper(current({ opened: true }));
    store.save(KEY, draft("older"));
    k.forget();
    expect(store.load(KEY)).toBeNull();
  });

  test("enter restores a kept draft into the bound box, nothing when there is none or the store is off, and waits for a box that is not mounted yet", () => {
    const { k, store, state } = keeper(current({ opened: true }));
    store.save(KEY, draft("abc", 1));
    const handle = box();
    k.bind(handle);
    k.enter("fake", "s-1");
    expect(handle.restored).toEqual([{ text: "abc", cursor: 1, mentions: [] }]);
    k.enter("fake", "missing");
    expect(handle.restored).toHaveLength(1);

    const late = createDraftKeeper({ store, enabled: () => true, current: () => null });
    late.enter("fake", "s-1");
    const mounted = box();
    late.bind(mounted);
    expect(mounted.restored).toHaveLength(1);

    state.enabled = false;
    const off = box();
    k.bind(off);
    k.enter("fake", "s-1");
    expect(off.restored).toEqual([]);
  });

  test("a switch from a session that can be reopened keeps its draft and empties the box; one that cannot leaves the text", () => {
    const keepable = keeper(current({ answered: true }));
    const handle = box(draft("for a"));
    keepable.k.bind(handle);
    const snapshot = keepable.k.leave(current({ answered: true }) as never);
    expect(snapshot?.text).toBe("for a");
    expect(handle.value).toBeNull();
    expect(keepable.store.load(KEY)?.text).toBe("for a");

    const fresh = keeper(current());
    const kept = box(draft("unsent"));
    fresh.k.bind(kept);
    fresh.k.leave(current() as never);
    expect(kept.value?.text).toBe("unsent");
    expect(kept.cleared).toBe(0);
    expect(fresh.store.load(KEY)).toBeNull();
  });

  test("a switch that fails puts the box back as it was", () => {
    const { k } = keeper(current({ answered: true }));
    const handle = box(draft("for a", 2));
    k.bind(handle);
    const snapshot = k.leave(current({ answered: true }) as never);
    k.rollback(snapshot);
    expect(handle.value).toEqual({ text: "for a", cursor: 2, mentions: [] });
  });
});
