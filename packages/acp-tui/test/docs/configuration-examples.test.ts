// Every JSONC example in docs/configuration.md loads as written (mvp-configuration task 11.1): each
// fenced `jsonc` block names what it is in its info string, and is written to a temporary
// `XDG_CONFIG_HOME` (or, for a project file, to a temporary work tree) and run through
// `acp-tui config --check`.
//
//   ```jsonc config           the user's config.jsonc; --check must print no problem
//   ```jsonc config warns     ... exit 0 and at least one warning (the example shows one)
//   ```jsonc config fails     ... exit 1 (the example shows a rejected setting)
//   ```jsonc theme <name>     themes/<name>.jsonc; clean (add `warns` for a legibility warning)
//   ```jsonc project          .acp-tui.jsonc in a work tree (a directory with .git), checked from it
//
// A section is the text between headings. A theme block is written for every config block of its
// section; a section with theme blocks and no config block is checked with `{ "theme": "<name>" }`.
// Nothing reads the user's own configuration directory.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const DOC = join(ROOT, "docs/configuration.md");

interface Block {
  readonly kind: "config" | "theme" | "project";
  readonly name?: string;
  readonly expect: "clean" | "warns" | "fails";
  readonly text: string;
  readonly line: number;
}
interface Section {
  readonly heading: string;
  readonly blocks: Block[];
}

function sections(markdown: string): Section[] {
  const out: Section[] = [{ heading: "(top)", blocks: [] }];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ heading: heading[1]!, blocks: [] });
      continue;
    }
    const fence = /^```jsonc\s+(.*)$/.exec(line);
    if (!fence) continue;
    const words = fence[1]!.trim().split(/\s+/);
    const kind = words.shift() as Block["kind"];
    if (kind !== "config" && kind !== "theme" && kind !== "project") throw new Error(`${DOC}:${i + 1}: unknown example kind '${kind}'`);
    const name = kind === "theme" ? words.shift() : undefined;
    const flag = words.shift();
    if (flag !== undefined && flag !== "warns" && flag !== "fails") throw new Error(`${DOC}:${i + 1}: unknown example flag '${flag}'`);
    let j = i + 1;
    while (j < lines.length && lines[j] !== "```") j++;
    const text = lines.slice(i + 1, j).join("\n") + "\n";
    out[out.length - 1]!.blocks.push({ kind, ...(name === undefined ? {} : { name }), expect: flag ?? "clean", text, line: i + 1 });
    i = j;
  }
  return out;
}

function run(xdg: string, cwd: string): { code: number; out: string } {
  const result = Bun.spawnSync(["bun", CLI, "config", "--check"], {
    cwd,
    env: { ...process.env, XDG_CONFIG_HOME: xdg, HOME: xdg },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, out: `${result.stdout.toString()}${result.stderr.toString()}` };
}

function scratch(): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-docs-")));
}

const found = sections(readFileSync(DOC, "utf8")).filter((s) => s.blocks.length > 0);

describe("docs/configuration.md examples", () => {
  test("the guide has examples of every kind", () => {
    const kinds = new Set(found.flatMap((s) => s.blocks.map((b) => b.kind)));
    expect([...kinds].sort()).toEqual(["config", "project", "theme"]);
  });

  for (const section of found) {
    const themes = section.blocks.filter((b) => b.kind === "theme");
    const configs = section.blocks.filter((b) => b.kind === "config");
    const projects = section.blocks.filter((b) => b.kind === "project");

    const check = (block: Block, config: string, themeBlocks: Block[]) => {
      const home = scratch();
      const dir = join(home, "acp-tui");
      mkdirSync(join(dir, "themes"), { recursive: true });
      writeFileSync(join(dir, "config.jsonc"), config);
      for (const theme of themeBlocks) writeFileSync(join(dir, "themes", `${theme.name}.jsonc`), theme.text);
      // The session directory: a work tree, with the project file when the block is one.
      const work = join(home, "work");
      mkdirSync(join(work, ".git"), { recursive: true });
      if (block.kind === "project") writeFileSync(join(work, ".acp-tui.jsonc"), block.text);
      const { code, out } = run(home, work);
      const message = `docs/configuration.md:${block.line} (${section.heading})\n${out}`;
      if (block.expect === "fails") {
        expect(code, message).toBe(1);
      } else {
        expect(code, message).toBe(0);
        if (block.expect === "warns") expect(out, message).toContain("warning:");
        else expect(out.trim(), message).toBe("no configuration problems");
      }
    };

    for (const block of configs) test(`${section.heading}: config at line ${block.line}`, () => check(block, block.text, themes));
    for (const block of projects) test(`${section.heading}: project file at line ${block.line}`, () => check(block, "{}\n", themes));
    if (configs.length === 0) {
      for (const theme of themes) test(`${section.heading}: theme ${theme.name} at line ${theme.line}`, () => check(theme, JSON.stringify({ theme: theme.name }), themes));
    }
  }
});
