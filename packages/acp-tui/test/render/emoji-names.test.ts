// The emoji name table (mvp-rendering task 14.5, review C11): generated from Unicode's
// emoji-test.txt by scripts/build-emoji-names.ts, and the run-time rule that names a sequence
// from it (src/render/emoji/emoji.ts). The byte-for-byte check runs where the pinned source has
// been downloaded into the cache (`bun packages/acp-tui/scripts/build-emoji-names.ts` does it).
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { cachePath, generate, loadSource, openTuiWidth as measureWidth, OUTPUT_PATH, parseEmojiTest, slug, SOURCE_SHA256 } from "../../scripts/build-emoji-names.ts";
import { EMOJI_NAMES, EMOJI_TONES, EMOJI_VERSION, OPENTUI_MISMEASURED } from "../../src/render/emoji/emoji-names.ts";
import { EMOJI_CLASSES, emojiClasses, emojiName, emojiSubstitute, splitEmoji } from "../../src/render/emoji/emoji.ts";

const source = await loadSource();
const TONES = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];

/** OpenTUI's own width of `text` (its default `unicode` method), measured as the generator
 *  measures it (an owned buffer's `encodeUnicode`, OpenTUI 0.6). */
const openTuiWidth = await measureWidth();

describe("emoji name table (task 14.5)", () => {
  test.skipIf(source === null)(`the committed module is exactly what the generator writes, byte for byte (needs ${cachePath()})`, async () => {
    const first = await generate(source!);
    expect(await generate(source!)).toBe(first);
    expect(await readFile(OUTPUT_PATH, "utf8")).toBe(first);
  });

  test("the module is ASCII, records its source and carries the Unicode License v3", async () => {
    const text = await readFile(OUTPUT_PATH, "utf8");
    expect(/[^\x00-\x7f]/.test(text)).toBe(false);
    expect(/[\u2013\u2014]/.test(text)).toBe(false);
    expect(text).toContain("UNICODE LICENSE V3");
    expect(text).toContain("Copyright (c) 1991-2026 Unicode, Inc.");
    expect(text).toContain(SOURCE_SHA256);
    expect(text).toContain("https://www.unicode.org/Public/18.0.0/emoji/emoji-test.txt");
    expect(EMOJI_VERSION).toBe("18.0");
  });

  test("every name is a snake_case shortcode name, and no two keys share one", () => {
    const names = Object.values(EMOJI_NAMES);
    for (const name of names) expect(name).toMatch(/^[a-z0-9#*]+(?:_[a-z0-9#*]+)*$/);
    expect(new Set(names).size).toBe(names.length);
    for (const template of Object.values(EMOJI_TONES)) expect(template === "" || /^[a-z0-9_]*%[a-z0-9_]*$/.test(template)).toBe(true);
  });

  test("the names the spec and the brief give", () => {
    expect(emojiName("\u{1F468}‍\u{1F469}‍\u{1F467}")).toBe("family_man_woman_girl");
    expect(emojiName("\u{1F1EC}\u{1F1E7}")).toBe("flag_united_kingdom");
    expect(emojiName("\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}")).toBe("flag_england");
    expect(emojiName("1️⃣")).toBe("keycap_1");
    expect(emojiName("#️⃣")).toBe("keycap_#");
    expect(emojiName("\u{1F44D}\u{1F3FD}")).toBe("thumbs_up_medium_skin_tone");
    expect(emojiName("❤️")).toBe("red_heart");
    expect(emojiName("❤")).toBe("red_heart");
    // Tones placed inside the name, two tones, and a pair with no untoned form.
    expect(emojiName("\u{1F468}\u{1F3FE}‍\u{1F9B0}")).toBe("man_medium_dark_skin_tone_red_hair");
    expect(emojiName("\u{1F9D1}\u{1F3FB}‍\u{1F91D}‍\u{1F9D1}\u{1F3FF}")).toBe("people_holding_hands_light_skin_tone_dark_skin_tone");
    expect(emojiName("\u{1FAF1}\u{1F3FB}‍\u{1FAF2}\u{1F3FC}")).toBe("handshake_light_skin_tone_medium_light_skin_tone");
    // Unqualified forms find the fully-qualified name; a plain emoji and ASCII have none.
    expect(emojiName("\u{1F3F3}‍\u{1F308}")).toBe("rainbow_flag");
    expect(emojiName("\u{1F600}")).toBeNull();
    expect(emojiName("a")).toBeNull();
  });

  test("the classes of each sample (docs/mvp-notes/rendering-research.md C11)", () => {
    expect(emojiClasses("\u{1F468}‍\u{1F469}‍\u{1F467}")).toEqual(["zwj"]);
    expect(emojiClasses("\u{1F1EC}\u{1F1E7}")).toEqual(["flag"]);
    expect(emojiClasses("1️⃣")).toEqual(["keycap"]);
    expect(emojiClasses("\u{1F44D}\u{1F3FD}")).toEqual(["tone"]);
    expect(emojiClasses("❤️")).toEqual(["vs16"]);
    expect(emojiClasses("⚠️")).toEqual(["vs16"]);
    expect(emojiClasses("❤")).toEqual(["bare"]);
    expect(emojiClasses("✌\u{1F3FD}")).toEqual(["bare", "tone"]);
    // A wide base with VS16, a bare base OpenTUI agrees on, a plain emoji: no class.
    expect(emojiClasses("㊗️")).toEqual([]);
    expect(emojiClasses("⚠")).toEqual([]);
    expect(emojiClasses("\u{1F600}")).toEqual([]);
  });

  test("OPENTUI_MISMEASURED is exactly what OpenTUI and Bun.stringWidth disagree on", () => {
    expect(OPENTUI_MISMEASURED.length).toBeGreaterThan(45);
    for (const s of OPENTUI_MISMEASURED) expect(openTuiWidth(s), s).not.toBe(Bun.stringWidth(s));
    // Every single emoji of the table alone (the bare text-default symbols among them): in the
    // list exactly where the two disagree.
    for (const key of Object.keys(EMOJI_NAMES)) {
      if ([...key].length !== 1 || key.charCodeAt(0) < 0x80) continue;
      expect(OPENTUI_MISMEASURED.includes(key), key).toBe(openTuiWidth(key) !== Bun.stringWidth(key));
    }
  });

  test.skipIf(source === null)("OPENTUI_MISMEASURED holds every sequence of emoji-test.txt the two disagree on", () => {
    for (const e of parseEmojiTest(source!)) {
      const seq = String.fromCodePoint(...e.cps);
      expect(OPENTUI_MISMEASURED.includes(seq), e.name).toBe(openTuiWidth(seq) !== Bun.stringWidth(seq));
    }
  });

  test("property: every table entry drawn as its name keeps the emoji as its projection", () => {
    const samples: string[] = [...Object.keys(EMOJI_NAMES), ...OPENTUI_MISMEASURED];
    for (const [key, template] of Object.entries(EMOJI_TONES)) {
      const [first, ...rest] = [...key];
      // The tone goes after the first person (and after the last for a pair).
      for (const tone of TONES) samples.push(template === "" || rest.length === 0 ? first + tone + rest.join("") : first + tone + rest.join("") + tone);
    }
    for (const sample of samples) {
      const pieces = splitEmoji(`a ${sample} b`, EMOJI_CLASSES);
      expect(pieces.map((p) => p.source ?? p.text).join(""), sample).toBe(`a ${sample} b`);
      const named = pieces.filter((p) => p.source !== undefined);
      // Every entry with a class is named (a key alone may have none, such as U+00A9 without VS16).
      if (emojiClasses(sample).length > 0) {
        expect(named.length, sample).toBe(1);
        expect(named[0]!.text).toBe(`:${emojiName(sample)}:`);
        expect(named[0]!.source).toBe(sample);
      }
    }
  });

  test.skipIf(source === null)("every fully-qualified sequence of emoji-test.txt: its name is the CLDR short name, and it is drawn as it where named", () => {
    let named = 0;
    for (const e of parseEmojiTest(source!)) {
      if (e.status !== "fully-qualified") continue;
      const seq = String.fromCodePoint(...e.cps);
      const substitute = emojiSubstitute(seq, EMOJI_CLASSES);
      if (substitute === null) continue;
      expect(substitute, e.name).toBe(`:${slug(e.name)}:`);
      named++;
    }
    expect(named).toBeGreaterThan(2400);
  });
});
