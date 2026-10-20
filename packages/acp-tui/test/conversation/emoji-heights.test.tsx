// Heights stay exact with emoji drawn as their names (mvp-rendering task 14.5, review C11): an
// agent message, an expanded tool card (title, prose and a fence) and an expanded thought holding
// emoji of every class, mounted through `ItemView` under the JetBrains and Zed emoji classes
// (`setTerminalEmoji`, as `terminalFlags` would give in those terminals), against
// `estimateHeight`, at several widths; and the drawn rows show the names. Needs the root bunfig
// `[test] preload`; run from the repository root.
import { afterEach, describe, expect, test } from "bun:test";
import { testRender, useRenderer } from "@opentui/solid";
import { SyntaxStyle, type Renderable } from "@opentui/core";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { Item } from "acp-model";
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { createSpinner, ItemView, type ItemContext } from "../../src/conversation/items.tsx";
import { setTerminalEmoji } from "../../src/conversation/markdown/context.ts";
import { collapsible } from "../../src/conversation/view-model.ts";
import { estimateHeight } from "../../src/conversation/window/heights.ts";
import type { EmojiClass } from "../../src/render/emoji/emoji.ts";
import { JETBRAINS_EMOJI, ZED_EMOJI } from "../../src/renderer/capabilities.ts";
import { createSessionStore, type SessionStore } from "../../src/session/store.ts";
import { DEFAULT_THEME, markdownStyles, resolveTheme } from "../../src/theme/index.ts";
import { itemsOf, runUpdates } from "../selection/fixtures.ts";
import { EMOJI_MESSAGE, EMOJI_THOUGHT, EMOJI_TOOL_TEXT, EMOJI_TOOL_TITLE } from "./emoji-agent.ts";

type Setup = Awaited<ReturnType<typeof testRender>>;
let setup: Setup | undefined;
let store: SessionStore | undefined;
afterEach(async () => {
  await setup?.dispose();
  store?.dispose();
  setup = undefined;
  store = undefined;
  setTerminalEmoji(null);
});

/** The emoji agent's turn as items (a new object per call, so no layout is cached across classes). */
function emojiItems(): Item[] {
  const updates = [
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: EMOJI_THOUGHT } },
    { sessionUpdate: "tool_call", toolCallId: "emoji-read", title: EMOJI_TOOL_TITLE, kind: "execute", status: "in_progress" },
    { sessionUpdate: "tool_call_update", toolCallId: "emoji-read", status: "completed", content: [{ type: "content", content: { type: "text", text: EMOJI_TOOL_TEXT } }] },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: EMOJI_MESSAGE } },
  ] as SessionUpdate[];
  return itemsOf(runUpdates(updates, "go")).filter((item) => item.kind !== "user_message" && item.kind !== "marker");
}

async function measure(width: number, emoji: readonly EmojiClass[]): Promise<{ rows: { item: Item; real: number; estimate: number }[]; screen: string }> {
  setTerminalEmoji(emoji);
  const items = emojiItems();
  store = createSessionStore({ home: "/w" });
  const vm = store.conversation;
  const theme = resolveTheme(DEFAULT_THEME);
  for (const item of items) if (collapsible(item)) vm.setExpanded(item, true);
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
    { width, height: 80, screenMode: "alternate-screen" },
  );
  for (let i = 0; i < 4; i++) {
    await setup.flush();
    await setup.renderOnce();
  }
  const rows = items.map((item) => {
    const node = setup!.renderer.root.findDescendantById(`item:${item.id}`) as Renderable | undefined;
    const real = node ? node.getLayout().height : -1;
    return { item, real, estimate: estimateHeight(item, width, vm.expanded(item), { flat: theme.flat }) };
  });
  return { rows, screen: setup.captureCharFrame() };
}

describe("heights with emoji drawn as names (task 14.5)", () => {
  for (const [terminal, emoji, names] of [
    ["PhpStorm", JETBRAINS_EMOJI, [":family_man_woman_girl:", ":flag_united_kingdom:", ":keycap_1:", ":thumbs_up_medium_skin_tone:", ":red_heart:"]],
    ["Zed", ZED_EMOJI, [":family_man_woman_girl:", ":keycap_1:", ":thumbs_up_medium_skin_tone:", ":red_heart:"]],
  ] as const) {
    for (const width of [24, 40, 63, 100]) {
      test(`${terminal} at ${width} columns: every item's estimate is its height, and the names are drawn`, async () => {
        const { rows, screen } = await measure(width, emoji);
        expect(rows.length).toBe(3);
        for (const r of rows) expect(r.estimate, `${r.item.kind} at ${width}`).toBe(r.real);
        const flat = screen.replace(/\s+/g, "");
        for (const name of names) expect(flat).toContain(name.slice(0, Math.min(name.length, width - 8)));
      }, 20000);
    }
  }
});
