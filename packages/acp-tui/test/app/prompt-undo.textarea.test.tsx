// day-two-feedback task 9.1: the undo grouping over OpenTUI's real textarea and edit buffer (the
// test renderer), wired as the prompt box wires it: the manager sees each key before the textarea
// does and every content-change event, and its programmatic edits run through `atomic`.
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { TextareaRenderable } from "@opentui/core";
import { createPromptUndo, type PromptUndo } from "../../src/app/prompt-undo.ts";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(async () => {
  await setup?.dispose();
  setup = undefined;
});

async function mount(): Promise<{ input: TextareaRenderable; undo: PromptUndo; clock: { now: number } }> {
  let input: TextareaRenderable | undefined;
  const clock = { now: 1000 };
  const undo = createPromptUndo(
    {
      text: () => input?.plainText ?? "",
      undo: () => input?.undo() ?? false,
      redo: () => input?.redo() ?? false,
      canUndo: () => input?.editBuffer.canUndo() ?? false,
      canRedo: () => input?.editBuffer.canRedo() ?? false,
      clearHistory: () => input?.editBuffer.clearHistory(),
    },
    { now: () => clock.now },
  );
  setup = await testRender(
    () => <textarea ref={(r: TextareaRenderable) => (input = r)} focused onKeyDown={(key) => undo.keyDown(key)} onContentChange={() => undo.sync()} />,
    { width: 40, height: 6 },
  );
  return { input: input!, undo, clock };
}

/** Lets the textarea's change events arrive. */
const settle = () => Bun.sleep(30);

describe("the prompt box's undo over the real textarea", () => {
  test("Undo by word: `fix the router` typed in one go (the keys arrive before any event does)", async () => {
    const { input, undo } = await mount();
    // One chunk: every key reaches the textarea before its first change event is delivered.
    await setup!.mockInput.pressKeys(Array.from("fix the router"));
    await settle();
    expect(input.plainText).toBe("fix the router");
    expect(undo.depth.undo).toBe(3);
    undo.undo();
    expect(input.plainText).toBe("fix the ");
    undo.undo();
    expect(input.plainText).toBe("fix ");
    undo.undo();
    expect(input.plainText).toBe("");
    expect(undo.undo()).toBe(false);
    await settle();
    expect(input.plainText).toBe("");
    expect(undo.depth).toEqual({ undo: 0, redo: 3 });
  });

  test("Typed key by key, with the events arriving between them: the same steps", async () => {
    const { input, undo } = await mount();
    for (const char of "fix the router") {
      await setup!.mockInput.typeText(char);
      await settle();
    }
    expect(undo.depth.undo).toBe(3);
    undo.undo();
    expect(input.plainText).toBe("fix the ");
  });

  test("Typing over a selection is one undo step with what follows (task 12.6)", async () => {
    const { input, undo } = await mount();
    await setup!.mockInput.typeText("foo");
    await settle();
    undo.boundary();
    // `foo` selected, `bar` typed over it.
    for (let i = 0; i < 3; i++) input.moveCursorLeft({ select: true });
    await setup!.mockInput.typeText("bar");
    await settle();
    expect(input.plainText).toBe("bar");
    expect(undo.depth.undo).toBe(2);
    undo.undo();
    expect(input.plainText).toBe("foo");
    undo.redo();
    expect(input.plainText).toBe("bar");
  });

  test("Redo after undo, and the events the undo causes are not read as edits", async () => {
    const { input, undo } = await mount();
    await setup!.mockInput.pressKeys(Array.from("fix the router"));
    await settle();
    undo.undo();
    await settle();
    expect(undo.depth).toEqual({ undo: 2, redo: 1 });
    undo.redo();
    await settle();
    expect(input.plainText).toBe("fix the router");
    expect(undo.depth).toEqual({ undo: 3, redo: 0 });
  });

  test("Undo a paste: one step, and redo brings it back", async () => {
    const { input, undo } = await mount();
    await setup!.mockInput.pressKeys(Array.from("see "));
    await settle();
    undo.atomic(() => input.insertText("three\nlines\nhere"));
    await settle();
    expect(input.plainText).toBe("see three\nlines\nhere");
    undo.undo();
    expect(input.plainText).toBe("see ");
    undo.redo();
    expect(input.plainText).toBe("see three\nlines\nhere");
  });

  test("Backspaces are a run: five of them undone at once", async () => {
    const { input, undo } = await mount();
    await setup!.mockInput.pressKeys(Array.from("hello world"));
    await settle();
    await setup!.mockInput.pressKeys(["\b", "\b", "\b", "\b", "\b"]);
    await settle();
    expect(input.plainText).toBe("hello ");
    undo.undo();
    expect(input.plainText).toBe("hello world");
  });

  test("A selection deleted is one step", async () => {
    const { input, undo } = await mount();
    await setup!.mockInput.pressKeys(Array.from("hello world"));
    await settle();
    input.setSelection(6, 11);
    undo.atomic(() => input.deleteSelection());
    await settle();
    expect(input.plainText).toBe("hello ");
    undo.undo();
    expect(input.plainText).toBe("hello world");
  });

  test("Nothing is left to undo after a reset, and the edit buffer's history is gone too", async () => {
    const { input, undo } = await mount();
    await setup!.mockInput.pressKeys(Array.from("fix the router"));
    await settle();
    input.clear();
    undo.reset();
    await settle();
    expect(undo.undo()).toBe(false);
    expect(input.editBuffer.canUndo()).toBe(false);
    expect(input.plainText).toBe("");
  });

  test("The history of the keys before the reset does not come back through a later edit", async () => {
    const { input, undo } = await mount();
    await setup!.mockInput.pressKeys(Array.from("one two"));
    await settle();
    input.clear();
    undo.reset();
    await setup!.mockInput.pressKeys(Array.from("new "));
    await settle();
    undo.undo();
    expect(input.plainText).toBe("");
    expect(undo.undo()).toBe(false);
  });
});
