// Spike S3 (task 12.2). The height estimates against what
// OpenTUI really lays out: every item of 200 long-session items is mounted
// (one `ItemView` each in a plain column: the conversation itself mounts only a
// window), and each item's Yoga height is compared with
// `estimateHeight`, collapsed and expanded, at 100 and 63 columns. Estimates
// only need to be close (anchor compensation absorbs the rest), so the test
// bounds the error rather than requiring equality, and prints the figures
// (30 September 2026: every item exact but one agent message at 63 columns, one row short).
// Needs the root bunfig `[test] preload`; run from the repository root.
import { afterEach, describe, expect, test } from "bun:test";
import { testRender, useRenderer } from "@opentui/solid";
import type { Renderable } from "@opentui/core";
import { createSession, reduce, type Item, type Session } from "acp-model";
import { SyntaxStyle } from "@opentui/core";
import { DEFAULT_GLYPHS } from "../../../src/conversation/glyphs.ts";
import { createSpinner, ItemView, type ItemContext } from "../../../src/conversation/items.tsx";
import { createSessionStore, type SessionStore } from "../../../src/session/store.ts";
import { DEFAULT_THEME, markdownStyles, resolveTheme } from "../../../src/theme/index.ts";
import { setRenderSettings } from "../../../src/conversation/markdown/context.ts";
import { estimateHeight } from "../../../src/conversation/window/heights.ts";
import { collapsible } from "../../../src/conversation/view-model.ts";
import { longSessionEvents } from "./session.ts";
import { runScenario } from "../../selection/fixtures.ts";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup | undefined;
let store: SessionStore | undefined;
afterEach(async () => {
  await setup?.dispose();
  store?.dispose();
  setup = undefined;
  store = undefined;
});

function itemsOf(session: Session): Item[] {
  return session.order.map((id) => session.items.get(id)!).filter((item) => !(item.kind === "agent_message" && item.text.trim() === ""));
}

function longSessionItems(): Item[] {
  let session: Session = createSession();
  for (const event of longSessionEvents(200)) session = reduce(session, event);
  return itemsOf(session);
}

async function measure(width: number, expandAll: boolean, items: Item[] = longSessionItems()) {
  store = createSessionStore({ home: "/w" });
  const vm = store.conversation;
  const theme = resolveTheme(DEFAULT_THEME);
  if (expandAll) for (const item of items) if (collapsible(item)) vm.setExpanded(item, true);
  // The Markdown style is owned by the test renderer's native scene (OpenTUI 0.6).
  const context = (style: SyntaxStyle): ItemContext => ({
    theme,
    glyphs: DEFAULT_GLYPHS,
    style,
    items: Object.fromEntries(items.map((item) => [item.id, item])),
    vm,
    spinner: createSpinner(),
    width: () => width,
    selected: () => false,
    register() {},
    mouse: { pressItem() {}, pressHeader() {}, releaseHeader() {} },
  });
  setup = await testRender(
    () => {
      const ctx = context(SyntaxStyle.fromStyles(markdownStyles(theme), useRenderer().nativeScene));
      return (
        <box flexDirection="column" width={width}>
          {items.map((item) => (
            <ItemView id={item.id} margin={0} ctx={ctx} />
          ))}
        </box>
      );
    },
    { width, height: 40, screenMode: "alternate-screen" },
  );
  await setup.flush();
  await setup.renderOnce();
  await setup.renderOnce();
  const rows: { item: Item; real: number; estimate: number }[] = [];
  for (const item of items) {
    const node = setup.renderer.root.findDescendantById(`item:${item.id}`) as Renderable | undefined;
    if (!node) continue;
    const real = node.getLayout().height;
    rows.push({ item, real, estimate: estimateHeight(item, width, vm.expanded(item), { flat: theme.flat }) });
  }
  return rows;
}

function summary(rows: { item: Item; real: number; estimate: number }[]) {
  const byKind = new Map<string, { n: number; exact: number; err: number; real: number; estimate: number }>();
  for (const r of rows) {
    const k = byKind.get(r.item.kind) ?? { n: 0, exact: 0, err: 0, real: 0, estimate: 0 };
    k.n++;
    if (r.real === r.estimate) k.exact++;
    k.err += Math.abs(r.real - r.estimate);
    k.real += r.real;
    k.estimate += r.estimate;
    byKind.set(r.item.kind, k);
  }
  const real = rows.reduce((a, r) => a + r.real, 0);
  const estimate = rows.reduce((a, r) => a + r.estimate, 0);
  return { byKind: Object.fromEntries(byKind), real, estimate };
}

describe("height estimates against Yoga (200 long-session items)", () => {
  for (const width of [100, 63, 40]) {
    for (const expandAll of [false, true]) {
      test(`${width} columns, ${expandAll ? "everything expanded" : "compact defaults"}: total within 2%, over 95% of items exact`, async () => {
        const rows = await measure(width, expandAll);
        expect(rows.length).toBeGreaterThan(150);
        const s = summary(rows);
        console.log(`estimate ${width} cols ${expandAll ? "expanded" : "collapsed"}: real ${s.real} rows, estimated ${s.estimate}`, JSON.stringify(s.byKind));
        expect(Math.abs(s.estimate - s.real) / s.real).toBeLessThan(0.02);
        const exact = rows.filter((r) => r.real === r.estimate).length;
        expect(exact / rows.length).toBeGreaterThan(0.95);
      }, 30000);
    }
  }
});

// mvp-rendering task 10.2, tui-rendering "Heights computable without mounting", scenario "Gallery
// estimates": the items of markdown-gallery (one message holding every element), copy-fixtures
// and long-session, estimated without mounting and then drawn, at 40, 63 and 100 columns.
describe("Gallery estimates (markdown-gallery, copy-fixtures and long-session items)", () => {
  let fixtures: Item[] | undefined;
  async function galleryItems(): Promise<Item[]> {
    if (!fixtures) {
      const gallery = itemsOf(await runScenario("markdown-gallery", "show me the gallery"));
      const copy = itemsOf(await runScenario("copy-fixtures", "give me things to copy"));
      // Item IDs are unique per scenario but not across them: prefix each scenario's.
      const tag = (prefix: string, items: Item[]) => items.map((item) => ({ ...item, id: `${prefix}:${item.id}` }) as Item);
      fixtures = [...tag("gallery", gallery), ...tag("copy", copy), ...longSessionItems()];
    }
    return fixtures;
  }
  for (const width of [40, 63, 100]) {
    for (const expandAll of [false, true]) {
      test(`${width} columns, ${expandAll ? "everything expanded" : "compact defaults"}: at least 95% of items exact, totals within 2%`, async () => {
        const items = await galleryItems();
        const rows = await measure(width, expandAll, items);
        expect(rows.length).toBe(items.length);
        const s = summary(rows);
        const wrong = rows.filter((r) => r.real !== r.estimate).map((r) => `${r.item.id} (${r.item.kind}) real ${r.real} estimated ${r.estimate}`);
        console.log(`gallery estimate ${width} cols ${expandAll ? "expanded" : "collapsed"}: real ${s.real} rows, estimated ${s.estimate}; not exact: ${wrong.length ? wrong.join("; ") : "none"}`);
        expect(rows.some((r) => r.item.id.startsWith("gallery:") && r.real > 300)).toBe(true);
        expect(Math.abs(s.estimate - s.real) / s.real).toBeLessThanOrEqual(0.02);
        expect((rows.length - wrong.length) / rows.length).toBeGreaterThanOrEqual(0.95);
      }, 60000);
    }
  }
});

// interface-feedback 4.3, tui-rendering "Rules between table rows" and "Heights computable without
// mounting": a table's estimated height equals its mounted height under each value of
// `markdown.table_row_rules`, with cells that wrap and with cells that do not.
describe("table heights under markdown.table_row_rules", () => {
  const WRAPPING = "| key | description |\n| --- | --- |\n| a | a long description that has to wrap in a narrow pane |\n| b | short |\n| c | another description that is long enough to wrap twice over in this pane |";
  const FLAT = "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |";
  const item = (text: string): Item => {
    let session: Session = createSession();
    session = reduce(session, { type: "session_created", at: 0, cwd: "/w", agentInfo: { name: "fake-agent", version: "1" }, response: { sessionId: "s" } } as never);
    session = reduce(session, { type: "session_update", at: 1, update: { sessionUpdate: "agent_message_chunk", messageId: "m", content: { type: "text", text } } } as never);
    return itemsOf(session)[0]!;
  };
  afterEach(() => setRenderSettings(null));
  for (const rule of ["auto", "always", "never"] as const) {
    for (const [name, source] of [["wrapping", WRAPPING], ["one-line", FLAT]] as const) {
      for (const width of [40, 63, 100]) {
        test(`${rule}, ${name} cells, ${width} columns: estimate equals mounted height`, async () => {
          setRenderSettings({ tableRowRules: rule });
          const rows = await measure(width, false, [item(source)]);
          expect(rows.length).toBe(1);
          expect(rows[0]!.estimate).toBe(rows[0]!.real);
        });
      }
    }
  }
});
