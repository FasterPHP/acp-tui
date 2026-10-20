// acp-tui lexes agent Markdown with marked itself (the height estimate and the projection,
// conversation/markdown/lex.ts) while OpenTUI lexes it for drawing with the marked it bundles.
// The two must be the same version, or the estimate, the projection and the screen could
// disagree: a bump of OpenTUI that moves its marked must move acp-tui's pin too.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEX_OPTIONS } from "../../../src/conversation/markdown/lex.ts";

const ROOT = join(import.meta.dir, "../../../../..");
const json = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8")) as Record<string, Record<string, string>>;

describe("marked: one version for drawing and for the estimate", () => {
  test("acp-tui pins exactly the marked version @opentui/core depends on", () => {
    const opentui = json("node_modules/@opentui/core/package.json").dependencies!.marked;
    const ours = json("packages/acp-tui/package.json").dependencies!.marked;
    expect(opentui).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ours).toBe(opentui);
  });

  test("the installed marked is that version", () => {
    const installed = (json("node_modules/marked/package.json") as unknown as { version: string }).version;
    expect(installed).toBe(json("packages/acp-tui/package.json").dependencies!.marked!);
  });

  test("the lex options are the ones OpenTUI passes (`{ gfm: true }`)", () => {
    expect(LEX_OPTIONS).toEqual({ gfm: true });
    const bundle = readFileSync(join(ROOT, "node_modules/@opentui/core/index.bun.js"), "utf8");
    // parseMarkdownIncremental lexes the content, and the rest after its stable tokens, with these.
    expect(bundle).toContain(".lex(newContent, { gfm: true })");
    expect(bundle).toContain(".lex(remainingContent, { gfm: true })");
  });
});
