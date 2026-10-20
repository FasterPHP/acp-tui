#!/usr/bin/env bun
/**
 * Builds the tree-sitter grammars acp-tui bundles for code-block highlighting
 * (mvp-rendering design decision 8, task 8.1).
 *
 * For each grammar below it fetches the PINNED commit (never a branch), runs the
 * tree-sitter CLI (`generate` when the repository does not commit its parser,
 * then `build --wasm`), checks that web-tree-sitter 0.25.10 (the version inside
 * OpenTUI) loads the result and compiles the highlight query, and writes
 *
 *   packages/acp-tui/assets/grammars/<language>/tree-sitter-<language>.wasm
 *   packages/acp-tui/assets/grammars/<language>/highlights.scm
 *   packages/acp-tui/assets/grammars/<language>/LICENSE
 *   packages/acp-tui/assets/grammars/manifest.json
 *
 * Usage (from the repository root):
 *
 *   bun packages/acp-tui/scripts/build-grammars.ts            # build and write the assets
 *   bun packages/acp-tui/scripts/build-grammars.ts --check    # rebuild and compare with the manifest
 *   bun packages/acp-tui/scripts/build-grammars.ts php json   # only these languages
 *
 * Network: git fetches from github.com, and the CLI downloads wasi-sdk (a clang
 * for wasm32-wasi, about 114 MB) from github.com/WebAssembly/wasi-sdk on its first
 * `build --wasm`, into `$XDG_CACHE_HOME/tree-sitter/wasi-sdk` (`~/.cache/...`).
 * Where the home directory is read-only, set `XDG_CACHE_HOME` to a writable
 * directory. Neither is needed at run time: acp-tui never fetches anything.
 *
 * Needs `tree-sitter` (the CLI, version pinned in CLI_VERSION) and `node` (the CLI
 * evaluates `grammar.js` with it) on the PATH.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, Query } from "web-tree-sitter";

/** The tree-sitter CLI the wasm files are built with. A different CLI changes the output. */
const CLI_VERSION = "0.26.9";
/** The ABI the CLI generates parsers at. web-tree-sitter 0.25.10 loads ABI 13 to 15. */
const GENERATE_ABI = 15;
/** The ABI range of web-tree-sitter 0.25.10 (`LANGUAGE_VERSION` 15, `MIN_COMPATIBLE_VERSION` 13). */
const WEB_TREE_SITTER_ABI = { min: 13, max: 15 };

interface GrammarSource {
  /** The OpenTUI filetype and the directory name under `assets/grammars/`. */
  language: string;
  repo: string;
  tag: string;
  /** The commit the tag points at (not the annotated tag object). */
  commit: string;
  /** The grammar's directory inside the repository ("" for the root). */
  subdir: string;
  /** The grammar's name in `grammar.js`, which names the wasm export. */
  grammar: string;
  /** Highlight queries, relative to the repository root. They are concatenated in this order. */
  highlights: string[];
  licence: { spdx: string; file: string };
  /** Why this grammar (kept for the record; not written to the manifest). */
  why: string;
}

export const GRAMMARS: GrammarSource[] = [
  {
    language: "php",
    repo: "https://github.com/tree-sitter/tree-sitter-php",
    tag: "v0.24.2",
    commit: "5b5627faaa290d89eb3d01b9bf47c3bb9e797dea",
    subdir: "php_only",
    grammar: "php_only",
    highlights: ["queries/highlights.scm"],
    licence: { spdx: "MIT", file: "LICENSE" },
    why: "php_only: a snippet highlights with or without <?php",
  },
  {
    language: "json",
    repo: "https://github.com/tree-sitter/tree-sitter-json",
    tag: "v0.24.8",
    commit: "ee35a6ebefcef0c5c416c0d1ccec7370cfca5a24",
    subdir: "",
    grammar: "json",
    highlights: ["queries/highlights.scm"],
    licence: { spdx: "MIT", file: "LICENSE" },
    why: "",
  },
  {
    language: "bash",
    repo: "https://github.com/tree-sitter/tree-sitter-bash",
    tag: "v0.25.1",
    commit: "a06c2e4415e9bc0346c6b86d401879ffb44058f7",
    subdir: "",
    grammar: "bash",
    highlights: ["queries/highlights.scm"],
    licence: { spdx: "MIT", file: "LICENSE" },
    why: "",
  },
  {
    language: "sql",
    repo: "https://github.com/DerekStride/tree-sitter-sql",
    tag: "v0.3.11",
    commit: "7b51ecda191d36b92f5a90a8d1bc3faef1c7b8b8",
    subdir: "",
    grammar: "sql",
    highlights: ["queries/highlights.scm"],
    licence: { spdx: "MIT", file: "LICENSE" },
    why: "the maintained general SQL grammar (releases to 2026, used by nvim-treesitter); it commits no parser.c, so the script generates it",
  },
  {
    language: "python",
    repo: "https://github.com/tree-sitter/tree-sitter-python",
    tag: "v0.25.0",
    commit: "293fdc02038ee2bf0e2e206711b69c90ac0d413f",
    subdir: "",
    grammar: "python",
    highlights: ["queries/highlights.scm"],
    licence: { spdx: "MIT", file: "LICENSE" },
    why: "",
  },
  {
    language: "yaml",
    repo: "https://github.com/tree-sitter-grammars/tree-sitter-yaml",
    tag: "v0.7.2",
    commit: "7708026449bed86239b1cd5bce6e3c34dbca6415",
    subdir: "",
    grammar: "yaml",
    highlights: ["queries/highlights.scm"],
    licence: { spdx: "MIT", file: "LICENSE" },
    why: "",
  },
];

/** Licences acceptable for redistribution inside an Apache-2.0 project. */
const ACCEPTED_LICENCES = new Set(["MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause"]);

export interface ManifestEntry {
  language: string;
  grammar: string;
  repo: string;
  tag: string;
  commit: string;
  subdir: string;
  generated: boolean;
  abi: number;
  licence: string;
  wasm: { file: string; bytes: number; sha256: string };
  highlights: { file: string; sources: string[]; sha256: string };
  licenceFile: { file: string; sha256: string };
}

export interface Manifest {
  note: string;
  treeSitterCli: string;
  wasiSdk: string;
  webTreeSitter: string;
  generateAbi: number;
  grammars: ManifestEntry[];
}

const here = dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = resolve(here, "../assets/grammars");
const MANIFEST_PATH = join(ASSET_DIR, "manifest.json");

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = {}): string {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} (in ${cwd}) exited ${p.exitCode}\n${p.stderr.toString()}${p.stdout.toString()}`);
  }
  return p.stdout.toString();
}

function cliVersion(): string {
  const out = run(["tree-sitter", "--version"], process.cwd()).trim();
  const m = out.match(/(\d+\.\d+\.\d+)/);
  if (!m) throw new Error(`cannot read the tree-sitter version from "${out}"`);
  return m[1] as string;
}

/** The wasi-sdk the CLI downloaded, from the VERSION file in its cache. */
async function wasiSdkVersion(): Promise<string> {
  const cacheHome = process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? "", ".cache");
  const text = await readFile(join(cacheHome, "tree-sitter", "wasi-sdk", "VERSION"), "utf8");
  const llvm = text.match(/^llvm-version:\s*(\S+)/m)?.[1];
  const first = text.trim().split("\n")[0];
  return `wasi-sdk ${first}${llvm ? ` (llvm ${llvm})` : ""}`;
}

/** Fetches exactly `commit` into `dir`; fails if the checkout is not that commit. */
function fetchCommit(source: GrammarSource, dir: string): void {
  run(["git", "init", "--quiet", dir], tmpdir());
  run(["git", "remote", "add", "origin", source.repo], dir);
  run(["git", "fetch", "--quiet", "--depth", "1", "origin", source.commit], dir);
  run(["git", "-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD"], dir);
  const head = run(["git", "rev-parse", "HEAD"], dir).trim();
  if (head !== source.commit) throw new Error(`${source.language}: checked out ${head}, expected ${source.commit}`);
  // The tag must still point at the pinned commit, or the manifest would name a tag that moved.
  const tag = run(["git", "ls-remote", source.repo, `refs/tags/${source.tag}^{}`, `refs/tags/${source.tag}`], dir)
    .trim()
    .split("\n")
    .map((l) => l.split("\t")[0]);
  if (!tag.includes(source.commit)) {
    throw new Error(`${source.language}: tag ${source.tag} no longer points at ${source.commit} (${tag.join(", ")})`);
  }
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

let wtsReady: Promise<void> | undefined;
function initWebTreeSitter(): Promise<void> {
  wtsReady ??= Parser.init({
    locateFile: () => fileURLToPath(import.meta.resolve("web-tree-sitter/tree-sitter.wasm")),
  });
  return wtsReady;
}

interface Built {
  entry: ManifestEntry;
  wasm: Uint8Array;
  highlights: string;
  licence: string;
}

async function buildOne(source: GrammarSource, work: string): Promise<Built> {
  const repoDir = join(work, source.language);
  fetchCommit(source, repoDir);
  const grammarDir = source.subdir ? join(repoDir, source.subdir) : repoDir;

  const generated = !(await exists(join(grammarDir, "src", "parser.c")));
  if (generated) {
    run(["tree-sitter", "generate", "--abi", String(GENERATE_ABI), "--js-runtime", "node"], grammarDir);
  }

  const wasmPath = join(work, `${source.language}.wasm`);
  run(["tree-sitter", "build", "--wasm", "-o", wasmPath], grammarDir);
  const wasm = new Uint8Array(await readFile(wasmPath));

  const highlights = (
    await Promise.all(source.highlights.map((file) => readFile(join(repoDir, file), "utf8")))
  ).join("\n");
  const licence = await readFile(join(repoDir, source.licence.file), "utf8");
  if (!ACCEPTED_LICENCES.has(source.licence.spdx)) {
    throw new Error(`${source.language}: licence ${source.licence.spdx} is not on the accepted list`);
  }
  if (source.licence.spdx === "MIT" && !/Permission is hereby granted, free of charge/.test(licence)) {
    throw new Error(`${source.language}: ${source.licence.file} does not read as the MIT licence`);
  }

  // The same checks OpenTUI's worker makes: the language loads, and the query compiles.
  await initWebTreeSitter();
  const language = await Language.load(wasm);
  const abi = language.abiVersion;
  if (abi < WEB_TREE_SITTER_ABI.min || abi > WEB_TREE_SITTER_ABI.max) {
    throw new Error(`${source.language}: ABI ${abi} is outside web-tree-sitter's ${WEB_TREE_SITTER_ABI.min} to ${WEB_TREE_SITTER_ABI.max}`);
  }
  new Query(language, highlights);

  const entry: ManifestEntry = {
    language: source.language,
    grammar: source.grammar,
    repo: source.repo,
    tag: source.tag,
    commit: source.commit,
    subdir: source.subdir,
    generated,
    abi,
    licence: source.licence.spdx,
    wasm: { file: `${source.language}/tree-sitter-${source.language}.wasm`, bytes: wasm.byteLength, sha256: sha256(wasm) },
    highlights: {
      file: `${source.language}/highlights.scm`,
      sources: source.highlights,
      sha256: sha256(highlights),
    },
    licenceFile: { file: `${source.language}/LICENSE`, sha256: sha256(licence) },
  };
  return { entry, wasm, highlights, licence };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const only = args.filter((a) => !a.startsWith("-"));
  const selected = GRAMMARS.filter((g) => only.length === 0 || only.includes(g.language));
  if (selected.length === 0) throw new Error(`no grammar matches ${only.join(", ")}`);

  const version = cliVersion();
  if (version !== CLI_VERSION) {
    throw new Error(`tree-sitter CLI ${version} found, ${CLI_VERSION} required (the wasm output depends on it)`);
  }

  const work = await mkdtemp(join(tmpdir(), "acp-tui-grammars-"));
  try {
    const built: Built[] = [];
    for (const source of selected) {
      process.stdout.write(`${source.language} (${source.repo} ${source.tag}) ... `);
      const b = await buildOne(source, work);
      built.push(b);
      console.log(`ABI ${b.entry.abi}, ${b.entry.wasm.bytes} bytes, ${b.entry.wasm.sha256.slice(0, 12)}${b.entry.generated ? ", parser generated" : ""}`);
    }

    const wasiSdk = await wasiSdkVersion();
    const previous: Manifest | undefined = (await exists(MANIFEST_PATH))
      ? JSON.parse(await readFile(MANIFEST_PATH, "utf8"))
      : undefined;
    const merged = new Map((previous?.grammars ?? []).map((e) => [e.language, e]));
    for (const b of built) merged.set(b.entry.language, b.entry);
    const manifest: Manifest = {
      note: "Generated by packages/acp-tui/scripts/build-grammars.ts. Do not edit by hand.",
      treeSitterCli: version,
      wasiSdk,
      webTreeSitter: "0.25.10",
      generateAbi: GENERATE_ABI,
      grammars: GRAMMARS.map((g) => merged.get(g.language)).filter((e): e is ManifestEntry => e !== undefined),
    };

    if (check) {
      let differences = 0;
      for (const b of built) {
        const old = previous?.grammars.find((e) => e.language === b.entry.language);
        const same = old !== undefined && JSON.stringify(old) === JSON.stringify(b.entry);
        console.log(`${same ? "reproduced" : "DIFFERS   "} ${b.entry.language}${same || !old ? "" : ` (wasm sha256 ${old.wasm.sha256.slice(0, 12)} -> ${b.entry.wasm.sha256.slice(0, 12)})`}`);
        if (!same) differences++;
      }
      if (previous && (previous.treeSitterCli !== version || previous.wasiSdk !== wasiSdk)) {
        console.log(`toolchain differs: manifest ${previous.treeSitterCli} / ${previous.wasiSdk}, here ${version} / ${wasiSdk}`);
        differences++;
      }
      process.exitCode = differences === 0 ? 0 : 1;
      return;
    }

    for (const b of built) {
      const dir = join(ASSET_DIR, b.entry.language);
      await mkdir(dir, { recursive: true });
      await writeFile(join(ASSET_DIR, b.entry.wasm.file), b.wasm);
      await writeFile(join(ASSET_DIR, b.entry.highlights.file), b.highlights);
      await writeFile(join(ASSET_DIR, b.entry.licenceFile.file), b.licence);
    }
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${built.length} grammar(s) and ${MANIFEST_PATH}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
