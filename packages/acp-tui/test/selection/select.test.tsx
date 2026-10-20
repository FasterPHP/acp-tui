// SPIKE (phase-1a, S4): selection in-process (task 14.2): the real App with
// `--spike select`'s component and mouse hook, OpenTUI's test renderer and its
// mock mouse (SGR reports through the same private dispatch as a terminal's),
// over fake-agent's `copy-fixtures` driven through the reducer. The clipboard
// is a recording fake: nothing reaches the host clipboard or the terminal.
// Needs the root bunfig `[test] preload`; run from the repository root.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testRender } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import type { AgentMessageItem, Session, ToolCallItem } from "acp-model";
import { compactConfig } from "../app/compact-config.ts";
import { App } from "../../src/app/App.tsx";
import type { AppActions, AppContextValue } from "../../src/app/context.ts";
import { DEFAULT_LAYOUT, resolveLayout } from "../../src/layout/layout.ts";
import { installMouseInput } from "../../src/renderer/mouse.ts";
import { DEFAULT_WHEEL } from "../../src/renderer/wheel.ts";
import type { Copier } from "../../src/selection/clipboard.ts";
import { itemMarkdown } from "../../src/selection/export.ts";
import { createSelection } from "../../src/selection/select.tsx";
import { setRenderSettings } from "../../src/conversation/markdown/context.ts";
import { createSessionStore, type SessionStore } from "../../src/session/store.ts";
import { DEFAULT_THEME, resolveTheme } from "../../src/theme/index.ts";
import { useKeys } from "../../src/keys/context.ts";
import { commandCatalogue, type CatalogueEntry } from "../../src/keys/register.ts";
import { paletteItems } from "../../src/overlay/palette.ts";
import { COPY_FIXTURES, COPY_PROMPT, runScenario } from "./fixtures.ts";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup | undefined;
let store: SessionStore | undefined;
// These tests are about selection, at the column positions they were written for: one column of
// card padding, the default before day-one-feedback's task group 13 (code blocks in answers keep
// their padding rows, which are decorative and never selected).
beforeEach(() => setRenderSettings({ cardPadColumns: 1 }));
afterEach(async () => {
  setRenderSettings(null);
  // OpenTUI 0.6: destroy and wait for the native session to close (opentui-0-6 design D7).
  await setup?.dispose();
  store?.dispose();
  setup = undefined;
  store = undefined;
});

const GOLDEN = join(import.meta.dir, "golden");
const golden = (name: string) => readFileSync(join(GOLDEN, name), "utf8").replace(/\n$/, "");

let session: Session;
beforeAll(async () => {
  session = await runScenario("copy-fixtures", COPY_PROMPT);
});

const WIDTH = 60;

async function mount(height = 70, options: { copyOnRelease?: boolean } = {}) {
  store = createSessionStore({ home: "/w" });
  const actions: AppActions = { prompt: () => null, cancel() {}, answerPermission: () => false, exit() {} };
  const context: AppContextValue = { store, actions, theme: resolveTheme(DEFAULT_THEME), config: compactConfig() };
  const copied: { text: string; trigger: string }[] = [];
  const copier = (): Copier => ({
    mode: "auto",
    display: "wayland",
    async copy(text, trigger) {
      copied.push({ text, trigger });
      return { path: "host", result: null };
    },
    async dispose() {},
  });
  const spike = createSelection({ copier, ...options });
  let catalogue: () => CatalogueEntry[] = () => [];
  const Catalogue = () => {
    const { keymap, keyMap } = useKeys();
    catalogue = () => commandCatalogue(keymap, keyMap);
    return null;
  };
  const overlay = () => (
    <>
      {spike.overlay()}
      <Catalogue />
    </>
  );
  setup = await testRender(() => <App context={context} layout={resolveLayout(DEFAULT_LAYOUT)} overlay={overlay} />, {
    width: WIDTH,
    height,
    screenMode: "alternate-screen",
  });
  installMouseInput(setup.renderer, { policy: () => "full", wheel: DEFAULT_WHEEL, intercept: spike.intercept });
  store.attach({ getSession: () => session, subscribe: () => () => {} });
  const tool = session.order.map((id) => session.items.get(id)!).find((i): i is ToolCallItem => i.kind === "tool_call")!;
  store.conversation.setExpanded(tool, true);
  const frame = async () => {
    await setup!.flush();
    await setup!.renderOnce();
    return setup!.captureCharFrame().split("\n");
  };
  // The Markdown renderables lay their blocks out over a few frames.
  const ready = (rows: string[]) => ["  │ created_at", "  The third paragraph", "  ● third item"].every((p) => rows.some((l) => l.startsWith(p)));
  for (let i = 0; i < 200 && !ready(await frame()); i++) await Bun.sleep(10);
  await frame();
  const row = async (prefix: string) => {
    const rows = await frame();
    const y = rows.findIndex((l) => l.startsWith(prefix));
    if (y < 0) throw new Error(`no row starting with ${JSON.stringify(prefix)}:\n${rows.join("\n")}`);
    return y;
  };
  /** Whether the cell is drawn as selected (the test theme is flat: inverse video). */
  const selected = (x: number, y: number) => {
    const line = setup!.captureSpans().lines[y]!;
    let col = 0;
    for (const span of line.spans) {
      if (x < col + span.width) return (span.attributes & TextAttributes.INVERSE) !== 0;
      col += span.width;
    }
    return false;
  };
  return { copied, frame, row, selected, mouse: setup.mockMouse, keys: setup.mockInput, tool, catalogue: () => catalogue() };
}

function message(source: string): AgentMessageItem {
  const found = session.order.map((id) => session.items.get(id)!).find((i) => i.kind === "agent_message" && i.text === source);
  return found as AgentMessageItem;
}

describe("selection (phase-1a task 14.2)", () => {
  test("a drag across three items copies the range as the projection gives it, on release", async () => {
    const app = await mount();
    const nameRow = await app.row("  │ name ");
    const hunkRow = await app.row("  ┃ @@ -6,12 +6,7 @@");
    // From the end of the hunk header up to the start of `name` (the golden range, dragged up).
    await app.mouse.drag(2 + 2 + 15, hunkRow, 2, nameRow);
    await app.frame();
    expect(app.copied).toEqual([{ text: golden("range.txt"), trigger: "release" }]);
  });

  test("the highlight covers the selected text on screen and never the gutter or card rule", async () => {
    const app = await mount();
    const nameRow = await app.row("  │ name ");
    const hunkRow = await app.row("  ┃ @@ -6,12 +6,7 @@");
    await app.mouse.drag(2, nameRow, 2 + 2 + 15, hunkRow);
    await app.frame();
    const rows = await app.frame();
    // The anchor row, a paragraph row of the middle item, the tool's title and the hunk header.
    // mvp-rendering: the table's left border (column 2) is decoration; its first cell is at 4.
    expect(app.selected(4, nameRow)).toBe(true);
    expect(app.selected(2, nameRow)).toBe(false);
    expect(app.selected(0, nameRow)).toBe(false);
    expect(app.selected(1, nameRow)).toBe(false);
    const paragraph = rows.findIndex((l) => l.startsWith("  The second paragraph"));
    expect(app.selected(2, paragraph)).toBe(true);
    const header = rows.findIndex((l) => l.includes("Edit src/InvoiceTotal.php") && l.includes("edit"));
    const title = rows[header]!.indexOf("Edit src");
    expect(app.selected(title, header)).toBe(true);
    // The header's glyphs and kind column are decoration.
    expect(app.selected(2, header)).toBe(false);
    expect(app.selected(2, hunkRow)).toBe(false); // the card rule
    expect(app.selected(4, hunkRow)).toBe(true);
    expect(app.selected(4 + 15, hunkRow)).toBe(true);
    expect(app.selected(4 + 16, hunkRow)).toBe(false);
    // Rows above the anchor are not selected.
    expect(app.selected(2, nameRow - 1)).toBe(false);
  });

  test("with copy on release off (selection.copy_on_release), a release only selects; Ctrl+C copies", async () => {
    const app = await mount(70, { copyOnRelease: false });
    const row = await app.row("  The first paragraph");
    await app.mouse.drag(2, row, 2 + 8, row);
    await app.frame();
    expect(app.copied).toEqual([]);
    expect(app.selected(2, row)).toBe(true);
    app.keys.pressCtrlC();
    await app.frame();
    expect(app.copied).toEqual([{ text: "The first", trigger: "ctrl+c" }]);
  });

  test("a click selects nothing and copies nothing; OpenTUI's own selection never starts", async () => {
    const app = await mount();
    const nameRow = await app.row("  │ name ");
    await app.mouse.click(4, nameRow);
    await app.frame();
    expect(app.copied).toEqual([]);
    expect(setup!.renderer.getSelection()).toBeNull();
    expect(app.selected(4, nameRow)).toBe(false);
  });

  test("a drag that ends on a tool's header line does not toggle it", async () => {
    const app = await mount();
    const header = (await app.frame()).findIndex((l) => l.includes("Edit src/InvoiceTotal.php") && l.includes("edit"));
    const nameRow = await app.row("  │ name ");
    await app.mouse.drag(2, nameRow, 20, header);
    await app.frame();
    expect(store!.conversation.expanded(app.tool)).toBe(true);
    expect(app.copied).toHaveLength(1);
    // The title starts in column 15 (`  ← ✓ edit     Edit`), so column 20 ends on its sixth character.
    expect(app.copied[0]!.text.endsWith("\n\nEdit s")).toBe(true);
  });

  test("double click selects a word, triple click a line, each copied on release", async () => {
    const app = await mount();
    const row = await app.row("  The second paragraph");
    const x = 2 + "The second paragraph gives the rea".length; // in "reason"
    await app.mouse.doubleClick(2 + 5, row); // "second"
    await app.frame();
    expect(app.copied.at(-1)).toEqual({ text: "second", trigger: "release" });
    await Bun.sleep(450);
    await app.mouse.click(x, row);
    await app.mouse.click(x, row);
    await app.mouse.click(x, row);
    await app.frame();
    expect(app.copied.at(-1)!.text).toBe("The second paragraph gives the reason, including a code span that must survive a copy.");
  });

  test("Ctrl+C copies while text is selected; with nothing selected and the prompt box focused it does nothing", async () => {
    const app = await mount();
    const row = await app.row("  The first paragraph");
    await app.mouse.drag(2, row, 2 + 8, row);
    await app.frame();
    expect(app.copied.at(-1)).toEqual({ text: "The first", trigger: "release" });
    app.keys.pressCtrlC();
    await app.frame();
    expect(app.copied.at(-1)).toEqual({ text: "The first", trigger: "ctrl+c" });
    expect(store!.ui.armed).toBeNull();
    app.keys.pressEscape();
    // A lone ESC is held for the escape-sequence timeout before it counts as the key.
    await Bun.sleep(50);
    await app.frame();
    expect(app.selected(2, row)).toBe(false);
    store!.setFocus("prompt");
    app.keys.pressCtrlC();
    await app.frame();
    expect(app.copied).toHaveLength(2);
    // Consumed: the prompt box is empty and the session idle, and still exit is not armed.
    expect(store!.ui.armed).toBeNull();
  });

  test("y and Y copy the item under the conversation cursor as plain text and as Markdown", async () => {
    const app = await mount();
    const row = await app.row("  │ Field ");
    // Tab focuses the conversation; the click puts the cursor on the table and keeps that focus (a
    // click never moves keyboard focus, mvp-chrome-and-keys task 3.3).
    store!.setFocus("conversation");
    await app.mouse.click(4, row);
    await app.frame();
    expect(store!.ui.focus).toBe("conversation");
    app.keys.pressKey("y");
    await app.frame();
    expect(app.copied.at(-1)).toEqual({ text: golden("table.txt"), trigger: "y" });
    app.keys.pressKey("Y", { shift: true });
    await app.frame();
    expect(app.copied.at(-1)).toEqual({ text: itemMarkdown(message(COPY_FIXTURES.table)), trigger: "Y" });
  });

  test("the command palette lists the new commands with their keys", async () => {
    const app = await mount();
    const items = paletteItems(app.catalogue(), { configOptions: [], mouse: "full", permissionOptions: [] });
    const find = (id: string) => items.find((i) => i.id === id);
    expect(find("conversation.copyItem")).toMatchObject({ group: "Conversation", title: "Copy the item as plain text", keys: ["y"] });
    expect(find("conversation.copyItemMarkdown")).toMatchObject({ group: "Conversation", keys: ["shift+y"] });
    expect(find("selection.copy")).toMatchObject({ group: "Selection", title: "Copy the selection, or the item under the cursor", keys: ["ctrl+c"] });
    // Rich copy (mvp-conversation task 5.7): copy, copyRich, copyItem and copyItemMarkdown are
    // all palette commands.
    expect(find("selection.copyRich")).toMatchObject({ group: "Selection", keys: ["ctrl+shift+c"] });
    expect(find("selection.clear")).toMatchObject({ group: "Selection", keys: ["esc"] });
  });

  test("the selection's ends are model positions: it survives the item scrolling out of view and back", async () => {
    const app = await mount(24);
    // The conversation follows the bottom; scroll to the top first.
    const top = async () => {
      for (let i = 0; i < 40; i++) await app.mouse.scroll(10, 5, "up");
      return app.frame();
    };
    await top();
    const row = await app.row("  give me things");
    await app.mouse.drag(2, row, 2 + 3, row);
    await app.frame();
    expect(app.copied.at(-1)!.text).toBe("give");
    for (let i = 0; i < 40; i++) await app.mouse.scroll(10, 5, "down");
    await app.frame();
    app.keys.pressCtrlC();
    await app.frame();
    expect(app.copied.at(-1)).toEqual({ text: "give", trigger: "ctrl+c" });
    await top();
    const back = await app.row("  give me things");
    expect(app.selected(2, back)).toBe(true);
    expect(app.selected(6, back)).toBe(false);
  });
});


describe("selection highlight in a diff (mvp-conversation IDE finding F2)", () => {
  test("a selected diff line is highlighted from its sign to the end of its text, the cell between them included", async () => {
    const app = await mount();
    const rows = await app.frame();
    const y = rows.findIndex((l) => l.includes("┃  9 -"));
    const sign = rows[y]!.indexOf("-");
    const end = rows[y]!.trimEnd().length;
    // From the start of the removed line to the start of the next one.
    await app.mouse.drag(sign, y, 2, y + 1);
    await app.frame();
    const text = rows[y]!.slice(sign, end);
    expect(text.startsWith("-         $total")).toBe(true);
    // The line number column and the card rule are decoration; the sign, the cell after it and the text are not.
    expect(app.selected(2, y)).toBe(false);
    expect(app.selected(sign - 1, y)).toBe(false);
    for (let x = sign; x < end; x++) expect(`${x}:${app.selected(x, y)}`).toBe(`${x}:true`);
    // A range that starts at the text, or ends at the sign, adds no character there, so the cell is not drawn.
    await app.mouse.drag(sign + 2, y, 2, y + 1);
    await app.frame();
    expect(app.selected(sign, y)).toBe(false);
    expect(app.selected(sign + 1, y)).toBe(false);
    expect(app.selected(sign + 2, y)).toBe(true);
  });
});
