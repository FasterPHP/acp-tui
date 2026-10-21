import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { describe, expect, test } from "bun:test";
import { infoStringToFiletype } from "@opentui/core";
import { BUNDLED_GRAMMARS, GRAMMAR_DIR, bundledGrammars } from "../../src/conversation/grammars.ts";
import { highlightAll, SAMPLES } from "./grammar-samples.ts";

const LANGUAGES = BUNDLED_GRAMMARS.map((g) => g.filetype);

interface Manifest {
  grammars: { language: string; abi: number; licence: string; wasm: { file: string; sha256: string } }[];
}

describe("bundled grammars (mvp-rendering task 8.2)", () => {
  test("every registration is a local absolute path to a committed file, never a URL", () => {
    for (const parser of bundledGrammars()) {
      for (const path of [parser.wasm, ...parser.queries.highlights]) {
        expect(path.startsWith(GRAMMAR_DIR)).toBe(true);
        expect(isAbsolute(path)).toBe(true);
        expect(/^https?:/i.test(path)).toBe(false);
        expect(existsSync(path)).toBe(true);
      }
    }
    expect(() => bundledGrammars("https://example.com/")).toThrow(/URL/);
  });

  test("the info strings in a fence resolve to the registered filetypes", () => {
    const expected: Record<string, string> = {
      php: "php",
      json: "json",
      bash: "bash",
      sh: "bash",
      zsh: "bash",
      shell: "bash",
      sql: "sql",
      mysql: "sql",
      py: "python",
      python: "python",
      yaml: "yaml",
      yml: "yaml",
      java: "java",
      kotlin: "kotlin",
      kt: "kotlin",
      kts: "kotlin",
      xml: "xml",
      pom: "xml",
      xsd: "xml",
      svg: "xml",
    };
    const registered = new Set<string>();
    const aliases = new Map<string, string>();
    for (const { filetype, aliases: a = [] } of BUNDLED_GRAMMARS) {
      registered.add(filetype);
      for (const alias of a) aliases.set(alias, filetype);
    }
    for (const [info, filetype] of Object.entries(expected)) {
      // Either OpenTUI's own mapping gives the filetype, or an alias we register does.
      const mapped = infoStringToFiletype(info) ?? info;
      const resolved = registered.has(mapped) ? mapped : aliases.get(mapped);
      expect(resolved, info).toBe(filetype);
    }
  });

  test("the manifest matches the committed files: wasm hash, licence and ABI web-tree-sitter 0.25.10 accepts", async () => {
    const manifest = JSON.parse(await readFile(`${GRAMMAR_DIR}manifest.json`, "utf8")) as Manifest;
    expect(manifest.grammars.map((g) => g.language)).toEqual(LANGUAGES);
    for (const entry of manifest.grammars) {
      const wasm = await readFile(`${GRAMMAR_DIR}${entry.wasm.file}`);
      expect(createHash("sha256").update(wasm).digest("hex"), entry.language).toBe(entry.wasm.sha256);
      expect(entry.licence, entry.language).toBe("MIT");
      expect(existsSync(`${GRAMMAR_DIR}${entry.language}/LICENSE`)).toBe(true);
      expect(entry.abi).toBeGreaterThanOrEqual(13);
      expect(entry.abi).toBeLessThanOrEqual(15);
    }
  });

  test("each language highlights a sample through OpenTUI's tree-sitter client", async () => {
    const results = await highlightAll();
    expect(results.map((r) => r.language)).toEqual(Object.keys(SAMPLES));
    for (const r of results) {
      expect(r.error, r.language).toBeUndefined();
      expect(r.captures, r.language).toBeGreaterThan(0);
    }
    const by = Object.fromEntries(results.map((r) => [r.language, r.groups]));
    // PHP with the tag: the class keyword and the tag itself are captured.
    expect(by.php).toContain("keyword");
    expect(by.php).toContain("tag");
    // PHP without the tag (php_only): a bare statement still highlights.
    expect(by["php (no tag)"]).toContain("function");
    expect(by["php (no tag)"]).toContain("variable");
    expect(by.json).toContain("string");
    expect(by.bash).toContain("keyword");
    expect(by.sql).toContain("keyword");
    expect(by.python).toContain("keyword");
    expect(by.yaml).toContain("property");
    expect(by.java).toContain("keyword");
    expect(by.kotlin).toContain("string");
    expect(by.xml).toContain("tag");
    expect(by.javascript).toContain("keyword");
    expect(by.typescript).toContain("keyword");
    // OpenTUI 0.6's own TSX grammar (opentui-0-6 design D6): the element is a tag.
    expect(by.tsx).toContain("keyword");
    expect(by.tsx).toContain("tag.builtin");
  });
});

describe("Offline (spec: Bundled grammars, no network)", () => {
  const unshare = Bun.which("unshare");
  const sample = import.meta.resolve("./grammar-samples.ts").replace("file://", "");

  test.skipIf(!unshare)("every language highlights in a network namespace with no interface, and nothing is reported failing", async () => {
    // `unshare -rn`: a user and network namespace whose only interface (lo) is down, so any
    // connection attempt, URL source or DNS lookup would fail loudly in OpenTUI's worker.
    const probe = Bun.spawnSync([unshare!, "-rn", "sh", "-c", "cat /proc/net/dev | tail -n +3 | grep -vc '^ *lo:'"], { stdout: "pipe", stderr: "pipe" });
    if (probe.exitCode !== 0 && probe.exitCode !== 1) return; // user namespaces unavailable here
    expect(probe.stdout.toString().trim()).toBe("0");

    const run = Bun.spawn([unshare!, "-rn", process.execPath, sample], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HTTPS_PROXY: "", HTTP_PROXY: "", https_proxy: "", http_proxy: "" } });
    const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    expect(code, err).toBe(0);
    expect(err).not.toMatch(/Error downloading|Failed to fetch|fetch failed|ENETUNREACH|ECONNREFUSED/);
    const results = JSON.parse(out.trim().split("\n").pop()!) as { language: string; captures: number; error?: string }[];
    expect(results.map((r) => r.language)).toEqual(Object.keys(SAMPLES));
    for (const r of results) {
      expect(r.error, r.language).toBeUndefined();
      expect(r.captures, r.language).toBeGreaterThan(0);
    }
  });
});
