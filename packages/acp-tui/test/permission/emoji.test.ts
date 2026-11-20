// The permission card's emoji (spec tui-rendering "Other extensions stay text"): a sequence of a
// class the terminal's row of the capability table names is drawn as its name in `muted`, so the
// frame lines up where the terminal draws it at another width than acp-tui lays out. Auggie 1.x
// starts every question with `⚠️` (a narrow base with VS16), which Zed advances one cell and
// draws over the next; every other row of the table draws it in the 2 cells laid out.
import { describe, expect, test } from "bun:test";
import { createSession, reduce, type PermissionRecordItem, type ToolCallItem } from "acp-model";
import { cardLayout, cardModel, previewRows, type CardSegment, type CardStyle } from "../../src/app/permission.ts";
import { displayWidth } from "../../src/layout/segments.ts";
import { emojiClasses } from "../../src/render/emoji/emoji.ts";
import { TERMINAL_IDS, TERMINAL_TABLE, type TerminalId } from "../../src/renderer/capabilities.ts";

const WARNING = "⚠️";
const AUGGIE_TITLE = `${WARNING} Tool "bash" requires approval:\n\n  echo allowed-probe\n\nAllow?`;

const record = (title: string, names = ["Yes", "No"]): PermissionRecordItem => ({
  id: "permission:t1",
  status: "live",
  origin: "self",
  kind: "permission_record",
  toolCallId: "t1",
  title,
  options: names.map((name, i) => ({ optionId: String(i), name, kind: "allow_once" as const })),
  outcome: { type: "pending" },
});

const STYLE: CardStyle = { focused: true, flash: false, selected: 0, maxRows: 13, padding: { rows: 1, columns: 2 } };
const text = (row: readonly CardSegment[]) => row.map((s) => s.text).join("");
const emojiOf = (id: TerminalId) => TERMINAL_TABLE[id].capabilities.emoji;
/** The rows that name the warning sign: `:warning:` and its token. */
const nameTokens = (rows: readonly (readonly CardSegment[])[]) => rows.flatMap((r) => r.filter((s) => s.text.includes(":warning:")).map((s) => s.token));

describe("the permission card's emoji per terminal row", () => {
  test("⚠️ is a VS16 sequence acp-tui lays out in 2 cells", () => {
    expect(emojiClasses(WARNING)).toEqual(["vs16"]);
    expect(displayWidth(WARNING)).toBe(2);
  });

  for (const id of TERMINAL_IDS) {
    const named = emojiOf(id).includes("vs16");
    test(`${id}: Auggie's question ${named ? "names ⚠️ as :warning: in muted" : "keeps ⚠️"}, and every row is the card's width`, () => {
      const layout = cardLayout(cardModel(record(AUGGIE_TITLE), undefined), 63, { ...STYLE, emoji: emojiOf(id) });
      const rows = layout.rows.map(text);
      for (const row of rows) expect(displayWidth(row)).toBe(63);
      const question = rows.find((r) => r.includes("Tool"))!;
      if (named) {
        expect(question).toStartWith(`│  :warning: Tool "bash" requires approval:`);
        expect(rows.join("\n")).not.toContain(WARNING);
        expect(nameTokens(layout.rows)).toEqual(["muted"]);
      } else {
        expect(question).toStartWith(`│  ${WARNING} Tool "bash" requires approval:`);
        expect(rows.join("\n")).not.toContain(":warning:");
      }
    });
  }

  test("only Zed's row names VS16 sequences (JetBrains, Windows Terminal and ConPTY draw them in 2 cells)", () => {
    expect(TERMINAL_IDS.filter((id) => emojiOf(id).includes("vs16"))).toEqual(["zed"]);
  });

  test("a literal :warning: from the agent stays text; only the named emoji is muted", () => {
    const layout = cardLayout(cardModel(record(`:warning: ${WARNING} go`), undefined), 63, { ...STYLE, emoji: emojiOf("zed") });
    const row = layout.rows.find((r) => text(r).includes("go"))!;
    expect(row.filter((s) => s.text.trim() !== "" && s.token !== "permission").map((s) => [s.text, s.token])).toEqual([
      [":warning: ", "text"],
      [":warning:", "muted"],
      [" go", "text"],
    ]);
  });

  test("wrapped and cut short, the name keeps its token on each row and the frame its width", () => {
    const title = `${"word ".repeat(9)}${WARNING}${"x".repeat(40)} ${"tail ".repeat(30)}`;
    const layout = cardLayout(cardModel(record(title), undefined), 30, { ...STYLE, maxRows: 7, emoji: emojiOf("zed") });
    for (const row of layout.rows) expect(displayWidth(text(row))).toBe(30);
    const muted = layout.rows.flatMap((r) => r.filter((s) => s.token === "muted" && s.text.trim() !== "").map((s) => s.text));
    expect(muted.join("")).toBe(":warning:");
    expect(layout.rows.map(text).join("\n")).toContain("…");
  });

  test("sanitising comes first: bidi controls and zero-width characters go, the emoji is named after", () => {
    const model = cardModel(record(`${WARNING}‮ run​ it`), undefined);
    expect(model.title).toBe(`${WARNING} run it`);
    const layout = cardLayout(model, 63, { ...STYLE, emoji: emojiOf("zed") });
    expect(layout.rows.map(text).some((r) => r.startsWith("│  :warning: run it "))).toBe(true);
  });

  test("option labels and the preview are named too in Zed, and kept elsewhere", () => {
    let session = reduce(createSession(), { type: "prompt_sent", text: "go", at: 0 });
    session = reduce(session, {
      type: "permission_opened",
      toolCallId: "t1",
      at: 1,
      request: {
        sessionId: "s",
        toolCall: { toolCallId: "t1", title: "bash", kind: "execute", content: [{ type: "content", content: { type: "text", text: `echo ${WARNING} done` } }] },
        options: [{ optionId: "0", name: "Yes", kind: "allow_once" }],
      },
    });
    const tool = session.items.get("tool:t1") as ToolCallItem;
    const model = cardModel(record("Run it?", [`Yes ${WARNING}`, "No"]), tool);
    const zed = cardLayout(model, 63, { ...STYLE, emoji: emojiOf("zed"), preview: { rows: previewRows(tool, 57, emojiOf("zed")), offset: 0 } });
    const zedText = zed.rows.map(text).join("\n");
    expect(zedText).not.toContain(WARNING);
    expect(zedText).toContain("echo :warning: done");
    for (const row of zed.rows) expect(displayWidth(text(row))).toBe(63);
    const jetbrains = cardLayout(model, 63, { ...STYLE, emoji: emojiOf("jetbrains"), preview: { rows: previewRows(tool, 57, emojiOf("jetbrains")), offset: 0 } });
    expect(jetbrains.rows.map(text).join("\n")).toContain(`echo ${WARNING} done`);
  });
});
