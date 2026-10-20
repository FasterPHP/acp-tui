// day-two-feedback task 9.1 (spec tui-keymap "Undo and redo in the prompt box"): the grouping of
// the edit buffer's history into steps, over a stand-in for the textarea whose history is
// OpenTUI's: one native entry per edit, undone and redone one at a time.
import { describe, expect, test } from "bun:test";
import { createPromptUndo, diffText, type PromptUndo, type UndoTarget } from "../../src/app/prompt-undo.ts";

class Draft implements UndoTarget {
  value = "";
  private past: string[] = [];
  private future: string[] = [];
  /** How many native undo calls were made (to see that the history is walked per entry). */
  nativeUndos = 0;
  text(): string {
    return this.value;
  }
  set(next: string): void {
    this.past.push(this.value);
    this.future = [];
    this.value = next;
  }
  undo(): boolean {
    const previous = this.past.pop();
    if (previous === undefined) return false;
    this.nativeUndos++;
    this.future.push(this.value);
    this.value = previous;
    return true;
  }
  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.value);
    this.value = next;
    return true;
  }
  canUndo(): boolean {
    return this.past.length > 0;
  }
  canRedo(): boolean {
    return this.future.length > 0;
  }
  clearHistory(): void {
    this.past = [];
    this.future = [];
  }
}

interface Rig {
  draft: Draft;
  undo: PromptUndo;
  clock: { now: number };
  /** Types each character as a key does: the key reaches the manager, then the textarea edits. */
  type(text: string): void;
  /** Backspace at the end of the draft. */
  backspace(times?: number): void;
  /** An edit that does not come through a key the textarea handles (a selection deleted, say). */
  replace(next: string): void;
}

function rig(): Rig {
  const draft = new Draft();
  const clock = { now: 1000 };
  const undo = createPromptUndo(draft, { now: () => clock.now });
  return {
    draft,
    undo,
    clock,
    type(text) {
      for (const char of Array.from(text)) {
        undo.keyDown({ name: char });
        draft.set(draft.value + char);
        clock.now += 50;
      }
      undo.sync();
    },
    backspace(times = 1) {
      for (let i = 0; i < times; i++) {
        undo.keyDown({ name: "backspace" });
        draft.set(draft.value.slice(0, -1));
        clock.now += 50;
      }
      undo.sync();
    },
    replace(next) {
      undo.sync();
      draft.set(next);
      undo.sync();
    },
  };
}

describe("diffText", () => {
  test("the common start and end are kept", () => {
    expect(diffText("hello", "hello!")).toEqual({ start: 5, removed: "", inserted: "!" });
    expect(diffText("hello world", "hello ")).toEqual({ start: 6, removed: "world", inserted: "" });
    expect(diffText("hello world", "hello there")).toEqual({ start: 6, removed: "world", inserted: "there" });
    expect(diffText("abc", "abXc")).toEqual({ start: 2, removed: "", inserted: "X" });
    expect(diffText("", "abc")).toEqual({ start: 0, removed: "", inserted: "abc" });
    expect(diffText("abc", "abc")).toEqual({ start: 3, removed: "", inserted: "" });
  });

  test("never inside a surrogate pair", () => {
    // 👍 is D83D DC4D, 👎 is D83D DC4E: they share their first code unit.
    expect(diffText("a👍", "a👎")).toEqual({ start: 1, removed: "👍", inserted: "👎" });
    expect(diffText("👍b", "👎b")).toEqual({ start: 0, removed: "👍", inserted: "👎" });
  });
});

describe("Undo by word (task 9.1)", () => {
  test("`fix the router` typed without pausing: undo gives `fix the `, then `fix `, then nothing", () => {
    const r = rig();
    r.type("fix the router");
    expect(r.undo.depth.undo).toBe(3);
    expect(r.undo.undo()).toBe(true);
    expect(r.draft.value).toBe("fix the ");
    expect(r.undo.undo()).toBe(true);
    expect(r.draft.value).toBe("fix ");
    expect(r.undo.undo()).toBe(true);
    expect(r.draft.value).toBe("");
    expect(r.undo.undo()).toBe(false);
    expect(r.draft.value).toBe("");
  });

  test("redo brings each step back, and a new edit forgets what could be redone", () => {
    const r = rig();
    r.type("fix the router");
    r.undo.undo();
    r.undo.undo();
    expect(r.draft.value).toBe("fix ");
    expect(r.undo.redo()).toBe(true);
    expect(r.draft.value).toBe("fix the ");
    expect(r.undo.redo()).toBe(true);
    expect(r.draft.value).toBe("fix the router");
    expect(r.undo.redo()).toBe(false);
    r.undo.undo();
    expect(r.draft.value).toBe("fix the ");
    r.type("x");
    expect(r.undo.redo()).toBe(false);
  });

  test("the edit buffer's history is walked one entry at a time until the step's start", () => {
    const r = rig();
    r.type("fix the router");
    r.undo.undo();
    expect(r.draft.nativeUndos).toBe("router".length);
  });

  test("a newline after a word completes it like a space", () => {
    const r = rig();
    r.type("one\ntwo");
    r.undo.undo();
    expect(r.draft.value).toBe("one\n");
    r.undo.undo();
    expect(r.draft.value).toBe("");
  });

  test("spaces typed one after another do not each become a step with the word's space", () => {
    const r = rig();
    r.type("a  b");
    // `a ` completes a word; the second space starts a run that `b` joins.
    expect(r.undo.depth.undo).toBe(2);
    r.undo.undo();
    expect(r.draft.value).toBe("a ");
  });

  test("a grapheme of several code points is one typed character", () => {
    const r = rig();
    r.type("a");
    r.undo.keyDown({ name: "👍🏽" });
    r.draft.set(`${r.draft.value}👍🏽`);
    r.undo.sync();
    expect(r.undo.depth.undo).toBe(1);
    r.undo.undo();
    expect(r.draft.value).toBe("");
  });
});

describe("Runs end (task 9.1)", () => {
  test("a pause of over a second ends a run, a shorter one does not", () => {
    const r = rig();
    r.type("ab");
    r.clock.now += 900;
    r.type("cd");
    expect(r.undo.depth.undo).toBe(1);
    r.clock.now += 1500;
    r.type("ef");
    expect(r.undo.depth.undo).toBe(2);
    r.undo.undo();
    expect(r.draft.value).toBe("abcd");
    r.undo.undo();
    expect(r.draft.value).toBe("");
  });

  test("a key that moves the cursor ends the run, so typing after it is a new step", () => {
    const r = rig();
    r.type("abc");
    r.undo.keyDown({ name: "left" });
    // The cursor is now before `c`: the textarea inserts there.
    r.draft.set("abXc");
    r.undo.sync();
    expect(r.undo.depth.undo).toBe(2);
    r.undo.undo();
    expect(r.draft.value).toBe("abc");
    r.undo.undo();
    expect(r.draft.value).toBe("");
  });

  test("an edit that does not continue where the last one ended is a new step, whatever moved the cursor", () => {
    const r = rig();
    r.type("abc");
    // A click moved the cursor in front of `c`: no key told the manager.
    r.draft.set("abXc");
    r.undo.sync();
    expect(r.undo.depth.undo).toBe(2);
  });

  test("a click ends the run", () => {
    const r = rig();
    r.type("abc");
    r.undo.boundary();
    r.type("d");
    expect(r.undo.depth.undo).toBe(2);
  });

  test("insertion and deletion are runs of their own", () => {
    const r = rig();
    r.type("hello");
    r.backspace(3);
    expect(r.draft.value).toBe("he");
    expect(r.undo.depth.undo).toBe(2);
    r.undo.undo();
    expect(r.draft.value).toBe("hello");
    r.undo.undo();
    expect(r.draft.value).toBe("");
  });

  test("Delete works as Backspace does: forward deletions at one place are a run", () => {
    const r = rig();
    r.type("abcd ");
    r.undo.keyDown({ name: "left" });
    // Two Deletes in front of the cursor at index 1... the textarea removes at the same index.
    r.undo.keyDown({ name: "delete" });
    r.draft.set("acd ");
    r.undo.keyDown({ name: "delete" });
    r.draft.set("ad ");
    r.undo.sync();
    expect(r.undo.depth.undo).toBe(2);
    r.undo.undo();
    expect(r.draft.value).toBe("abcd ");
  });
});

describe("Whole edits are steps of their own (task 9.1)", () => {
  test("a paste: undo gives the text before it, redo the pasted text", () => {
    const r = rig();
    r.type("see ");
    r.undo.atomic(() => r.draft.set("see three\nlines\nhere"));
    expect(r.undo.depth.undo).toBe(2);
    r.undo.undo();
    expect(r.draft.value).toBe("see ");
    r.undo.redo();
    expect(r.draft.value).toBe("see three\nlines\nhere");
  });

  test("a paste typed into with no run before it, and typing after it, are three steps", () => {
    const r = rig();
    r.undo.atomic(() => r.draft.set("pasted"));
    r.type("x");
    expect(r.undo.depth.undo).toBe(2);
  });

  test("a deleted selection and a replaced selection are one step each", () => {
    const r = rig();
    r.type("hello world");
    r.replace("hello ");
    r.type("x");
    r.replace("hello there");
    r.undo.undo();
    expect(r.draft.value).toBe("hello x");
    r.undo.undo();
    expect(r.draft.value).toBe("hello ");
    r.undo.undo();
    expect(r.draft.value).toBe("hello world");
  });

  test("typing over a selection: the deletion and the typed run are one step (task 12.6)", () => {
    const r = rig();
    r.type("hello world");
    r.undo.boundary();
    // `world` selected and a `b` typed over it, then `ar `: the first key is a replacement.
    r.replace("hello b");
    r.type("ar ");
    expect(r.draft.value).toBe("hello bar ");
    // `hello `, `world` and `bar `: the deletion of `world` is in the last one.
    expect(r.undo.depth.undo).toBe(3);
    r.undo.undo();
    expect(r.draft.value).toBe("hello world");
    r.undo.undo();
    expect(r.draft.value).toBe("hello ");
    r.undo.undo();
    expect(r.draft.value).toBe("");
    r.undo.redo();
    r.undo.redo();
    r.undo.redo();
    expect(r.draft.value).toBe("hello bar ");
  });

  test("a single character over a selection in the middle of a run starts a step of its own", () => {
    const r = rig();
    r.type("one two");
    r.replace("one tw0");
    expect(r.undo.depth.undo).toBe(3);
    r.undo.undo();
    expect(r.draft.value).toBe("one two");
  });

  test("a mention replacing `@src` by a path is one step", () => {
    const r = rig();
    r.type("see @src");
    r.undo.atomic(() => r.draft.set("see src/app/PromptBox.tsx "));
    r.undo.undo();
    expect(r.draft.value).toBe("see @src");
  });

  test("an edit that changes nothing leaves no step", () => {
    const r = rig();
    r.type("a ");
    r.undo.atomic(() => {});
    r.undo.atomic(() => r.draft.set("a "));
    expect(r.undo.depth.undo).toBe(1);
  });

  test("a clear is a step too (a cut that empties the draft)", () => {
    const r = rig();
    r.type("hello");
    r.undo.atomic(() => r.draft.set(""));
    r.undo.undo();
    expect(r.draft.value).toBe("hello");
  });
});

describe("The history starts afresh (task 9.1)", () => {
  test("nothing is left to undo after a reset (a prompt sent, a session switched)", () => {
    const r = rig();
    r.type("fix the router");
    r.draft.set("");
    r.undo.reset();
    expect(r.undo.depth).toEqual({ undo: 0, redo: 0 });
    expect(r.draft.canUndo()).toBe(false);
    expect(r.undo.undo()).toBe(false);
    expect(r.draft.value).toBe("");
    // And typing goes on from the new start.
    r.type("go on");
    r.undo.undo();
    expect(r.draft.value).toBe("go ");
  });

  test("the undo of a step does not read the draft's own changes as edits", () => {
    const r = rig();
    r.type("fix the router");
    r.undo.undo();
    r.undo.sync();
    expect(r.undo.depth).toEqual({ undo: 2, redo: 1 });
  });
});
