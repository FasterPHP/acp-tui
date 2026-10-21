// Golden rows per gallery tag (mvp-rendering tasks 4.2 to 5.2; format in golden.ts). Each file
// holds a sample's rows at 63 and 100 columns; `UPDATE_GOLDEN=1` rewrites them, and the diff is
// reviewed against docs/phase-1a-notes/markdown-audit.md section 3.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_FLAGS, setRenderSettings, terminalFlags } from "../../../src/conversation/markdown/context.ts";
import { JETBRAINS_EMOJI, NO_CAPABILITIES, ZED_EMOJI } from "../../../src/renderer/capabilities.ts";
import { galleryByTag, goldenText, GOLDEN_DIR, messageRows } from "./golden.ts";

/** The tags with golden rows so far, by the task that renders them. */
const GOLDEN_TAGS: readonly string[] = [
  // Inline text (task 4.2).
  "M01",
  "M03",
  "M06",
  "M07",
  "M08",
  // Headings (task 4.3).
  "M12",
  "M13",
  // Lists and task items (task 4.4).
  "M15",
  "M16",
  "M17",
  "M18",
  // Quotes and alerts (task 4.5).
  "M23",
  "M24",
  // Rules, images, HTML and the extensions that stay text (task 4.6).
  "M05",
  "M09",
  "M14",
  "M27",
  "M28",
  "M29",
  // Tables (task 5.1) and records (task 5.2).
  "M19",
  "M20",
  // Strikethrough (task 7.2; M29's single tildes above), footnotes (task 7.3) and maths (task 7.5).
  "M02",
  "M25",
  "M26",
  // Code blocks (task 8.4) and diff fences (task 8.5).
  "M21",
  "M22",
  // Links (tasks 6.1 and 6.2): every form, a long URL wrapped, and the target rules.
  "M04",
  "M30",
  "M31",
  "M32",
  "M33",
];

const WIDTHS = [63, 100] as const;
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

describe("golden rows of the markdown gallery", () => {
  const byWidth = new Map(WIDTHS.map((w) => [w as number, galleryByTag(w)]));

  for (const tag of GOLDEN_TAGS) {
    test(`${tag} at ${WIDTHS.join(" and ")} columns`, () => {
      const text = goldenText(tag, WIDTHS, byWidth);
      const path = join(GOLDEN_DIR, `${tag}.txt`);
      if (UPDATE) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(path, text);
      }
      if (!existsSync(path)) throw new Error(`missing golden file ${tag}.txt: run with UPDATE_GOLDEN=1 and review it`);
      expect(text).toBe(readFileSync(path, "utf8"));
    });
  }

  // Emoji drawn as their names per terminal (task 14.5, review C11): M10 with each terminal's
  // emoji classes from the capability table.
  for (const [terminal, emoji] of [["unknown", NO_CAPABILITIES.emoji], ["jetbrains", JETBRAINS_EMOJI], ["zed", ZED_EMOJI]] as const) {
    test(`M10 with the emoji classes of ${terminal === "unknown" ? "an unknown terminal" : terminal}`, () => {
      const flags = { ...DEFAULT_FLAGS, emoji };
      const named = new Map(WIDTHS.map((w) => [w as number, galleryByTag(w, undefined, flags)]));
      const text = goldenText("M10", WIDTHS, named, `under the emoji classes of ${terminal === "unknown" ? "an unknown terminal" : terminal} (${emoji.join(", ")})`);
      const path = join(GOLDEN_DIR, `M10.${terminal}.txt`);
      if (UPDATE) writeFileSync(path, text);
      if (!existsSync(path)) throw new Error(`missing golden file M10.${terminal}.txt: run with UPDATE_GOLDEN=1 and review it`);
      expect(text).toBe(readFileSync(path, "utf8"));
    });
  }

  test("every tag of the gallery is found at both widths", () => {
    for (const width of WIDTHS) {
      const tags = [...byWidth.get(width)!.keys()];
      for (let n = 1; n <= 30; n++) expect(tags).toContain(`M${String(n).padStart(2, "0")}`);
    }
  });
});

// mvp-configuration task 4.8 (spec tui-config "Rendering settings"): the rendering settings, set as
// `app/run.tsx` sets them from the configuration, reach the flags the conversation draws with, and
// change the rows: "Heading markers shown" (M12, the headings sample) and a table at a new
// threshold (M19 under `markdown.table_min_column_width` 20, records at 63 columns).
describe("golden rows under the rendering settings", () => {
  const cases = [
    { name: "heading-markers", tag: "M12", settings: { headingMarkers: true, tableMinColumnWidth: 10, snippetRows: 10 }, note: "with markdown.heading_markers true" },
    { name: "table-min-20", tag: "M19", settings: { headingMarkers: false, tableMinColumnWidth: 20, snippetRows: 10 }, note: "with markdown.table_min_column_width 20" },
  ] as const;
  for (const c of cases) {
    test(`${c.tag} ${c.note}`, () => {
      setRenderSettings(c.settings);
      let flags;
      try {
        // The terminal's emoji classes left out, as in the other golden rows.
        flags = { ...terminalFlags(), emoji: DEFAULT_FLAGS.emoji };
      } finally {
        setRenderSettings(null);
      }
      expect(flags).toEqual({ headingMarkers: c.settings.headingMarkers, tableMinColumnWidth: c.settings.tableMinColumnWidth, codeWrap: "word", tableRowRules: "auto", codePadding: { rows: 1, columns: 2 }, emoji: [] });
      const rows = new Map(WIDTHS.map((w) => [w as number, galleryByTag(w, undefined, flags)]));
      const text = goldenText(c.tag, WIDTHS, rows, c.note);
      const path = join(GOLDEN_DIR, `${c.tag}.${c.name}.txt`);
      if (UPDATE) writeFileSync(path, text);
      if (!existsSync(path)) throw new Error(`missing golden file ${c.tag}.${c.name}.txt: run with UPDATE_GOLDEN=1 and review it`);
      expect(text).toBe(readFileSync(path, "utf8"));
      expect(text).not.toBe(goldenText(c.tag, WIDTHS, new Map(WIDTHS.map((w) => [w as number, galleryByTag(w)])), c.note));
    });
  }

  test("Heading markers shown: `## Install` reads `## Install`, the hashes muted and the text in the level 2 token", () => {
    setRenderSettings({ headingMarkers: true, tableMinColumnWidth: 10, snippetRows: 10 });
    try {
      const { rows } = messageRows("## Install\n", 61, undefined, { ...terminalFlags(), emoji: [] });
      const heading = rows.find((r) => r && r.spans.some((s) => s.text.includes("Install")))!;
      expect(heading.spans.map((s) => [s.text, s.token])).toEqual([["## ", "muted"], ["Install", "markdown.heading.2"]]);
    } finally {
      setRenderSettings(null);
    }
  });
});
