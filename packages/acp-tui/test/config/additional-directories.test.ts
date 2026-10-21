// harness-feedback task group 6 and configured-harnesses D8 (spec tui-config "Additional directories
// per harness", "Additional directories in a project file" and "Harness arguments for additional
// directories"): each file's entries are resolved when it is loaded, the user's own per harness and
// a project file's for every harness, and a project file is limited to the project's siblings. Every test builds its own tree of temporary
// directories and gives the loader its own home directory, so no real directory is read.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentCatalogue } from "../../src/agent/catalogue.ts";
import { effectiveConfig } from "../../src/config/effective.ts";
import { parseConfigText } from "../../src/config/load.ts";
import { formatProblemWithSeverity } from "../../src/config/problems.ts";
import { PROJECT_FILE_NAME } from "../../src/config/sources.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** /base/home (with shared, .ssh, app), /base/work (with app, lib, docs, .hidden), /base/cfg (with rel). */
function tree() {
  const base = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-dirs-")));
  roots.push(base);
  const dirs = ["home/shared", "home/.ssh", "home/app", "work/app", "work/lib", "work/docs", "work/.hidden", "cfg/rel"];
  for (const dir of dirs) mkdirSync(join(base, dir), { recursive: true });
  return { base, home: join(base, "home"), work: join(base, "work"), cfg: join(base, "cfg") };
}

const user = (text: string, t: ReturnType<typeof tree>) => parseConfigText(text, join(t.cfg, "config.jsonc"), { kind: "user", home: t.home });
const project = (text: string, root: string, t: ReturnType<typeof tree>) => parseConfigText(text, join(root, PROJECT_FILE_NAME), { kind: "project", home: t.home });

// Marcus, 21 October 2026 (configured-harnesses D8): the user's own directories are given per
// harness, in `agent_servers.<name>.additional_directories`; the top-level key is read only from a
// project file, and in the user's file it is reported and ignored.
const entry = (dirs: string, extra = "") => `{ "agent_servers": { "a": { "command": "a"${extra}, "additional_directories": ${dirs} } } }`;
const entryDirs = (parsed: ReturnType<typeof user>) => ((parsed.sections.agent_servers as Record<string, { additional_directories?: string[] }>)["a"]!).additional_directories;

describe("Additional directories per harness", () => {
  test("Entries are resolved against the file: ~ is the home directory, a relative path starts at the file's directory", () => {
    const t = tree();
    const parsed = user(entry(`["~/shared", "rel", "${t.work}/lib", "~/shared"]`, `, "additional_directory_args": ["--w", "{dir}"]`), t);
    expect(parsed.problems).toEqual([]);
    expect(parsed.notices).toEqual([]);
    expect(entryDirs(parsed)).toEqual([join(t.home, "shared"), join(t.cfg, "rel"), join(t.work, "lib")]);
  });

  test("A symlink is resolved to its real path", () => {
    const t = tree();
    symlinkSync(join(t.work, "lib"), join(t.cfg, "link"));
    expect(entryDirs(user(entry(`["link"]`), t))).toEqual([join(t.work, "lib")]);
  });

  test("Missing entry: a warning at that entry (line and column) that it is not a directory, and the entry is left out; the harness still launches", () => {
    const t = tree();
    const text = `{\n  "agent_servers": { "a": { "command": "a", "additional_directory_args": ["--w", "{dir}"], "additional_directories": ["~/shared", "~/nosuch"] } }\n}`;
    const parsed = user(text, t);
    expect(entryDirs(parsed)).toEqual([join(t.home, "shared")]);
    expect(parsed.problems).toHaveLength(1);
    const problem = parsed.problems[0]!;
    expect(problem).toMatchObject({ line: 2, path: "agent_servers.a.additional_directories.1", severity: "warning" });
    expect(formatProblemWithSeverity(problem)).toContain("warning: agent_servers.a.additional_directories.1 is not a directory and is left out");
    expect(buildAgentCatalogue(text, join(t.cfg, "config.jsonc")).agents.has("a")).toBe(true);
  });

  test("A value that is not a list of strings makes the entry invalid", () => {
    const t = tree();
    const parsed = user(entry(`"~/shared"`), t);
    expect(parsed.problems[0]).toMatchObject({ path: "agent_servers.a.additional_directories", severity: "error" });
    expect(parsed.invalidAgents["a"]).toContain("additional_directories");
  });

  test("The catalogue entry carries the resolved directories, and an entry without them carries none", () => {
    const t = tree();
    const text = `{ "agent_servers": { "a": { "command": "a", "additional_directories": ["${t.work}/lib"] }, "b": { "command": "b" } } }`;
    // Through the user's file, resolved by the loader (the catalogue is built from a parsed source).
    const catalogue = buildAgentCatalogue(text, join(t.cfg, "config.jsonc"));
    expect(catalogue.agents.get("a")?.harnessDirectories).toEqual([join(t.work, "lib")]);
    expect(catalogue.agents.get("b")?.harnessDirectories).toBeUndefined();
  });

  test("No template: config --check gets a notice that the directories reach the harness only through ACP; no problem", () => {
    const t = tree();
    const parsed = user(entry(`["~/shared"]`), t);
    expect(parsed.problems).toEqual([]);
    expect(parsed.notices).toHaveLength(1);
    expect(parsed.notices[0]).toMatchObject({ path: "agent_servers.a.additional_directories", severity: "notice" });
    expect(parsed.notices[0]!.message).toContain("are sent to a only if it takes them through ACP");
    // An empty list says nothing.
    expect(user(entry(`[]`), t).notices).toEqual([]);
  });
});

describe("Additional directories in the user's own file", () => {
  test("The top-level key is reported with where to move it, and ignored; the rest of the file applies", () => {
    const t = tree();
    const text = `{\n  "additional_directories": ["~/shared"],\n  "density": "compact"\n}`;
    const parsed = user(text, t);
    expect(parsed.sections.additional_directories).toBeUndefined();
    expect(parsed.rejected).toEqual([]);
    expect(parsed.sections.density).toBe("compact");
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toMatchObject({ line: 2, column: 3, path: "additional_directories", severity: "warning" });
    expect(parsed.problems[0]!.message).toContain("agent_servers.<name>.additional_directories");
    expect(effectiveConfig({ user: parsed.sections, project: {} }).additional_directories).toEqual([]);
  });

  test("Even an invalid value is only reported as misplaced, never an error", () => {
    const t = tree();
    const parsed = user(`{ "additional_directories": 42 }`, t);
    expect(parsed.problems.map((p) => p.severity)).toEqual(["warning"]);
  });

  test("The project file's directories are the effective list", () => {
    const t = tree();
    const u = user(`{ "additional_directories": ["~/shared"] }`, t);
    const p = project(`{ "additional_directories": ["../lib", "../docs"] }`, join(t.work, "app"), t);
    expect(p.problems).toEqual([]);
    expect(effectiveConfig({ user: u.sections, project: p.sections }).additional_directories).toEqual([join(t.work, "lib"), join(t.work, "docs")]);
  });

  test("A file that sets none contributes nothing, and the default is an empty list", () => {
    const t = tree();
    const p = project(`{ "additional_directories": ["../lib"] }`, join(t.work, "app"), t);
    expect(effectiveConfig({ user: {}, project: p.sections }).additional_directories).toEqual([join(t.work, "lib")]);
    expect(effectiveConfig({ user: {}, project: {} }).additional_directories).toEqual([]);
  });
});

describe("Additional directories in a project file", () => {
  test("Sibling repository: ../lib is added", () => {
    const t = tree();
    const p = project(`{ "additional_directories": ["../lib"] }`, join(t.work, "app"), t);
    expect(p.problems).toEqual([]);
    expect(p.sections.additional_directories).toEqual([join(t.work, "lib")]);
  });

  test("A directory inside the project itself is allowed", () => {
    const t = tree();
    mkdirSync(join(t.work, "app", "packages"));
    expect(project(`{ "additional_directories": ["packages"] }`, join(t.work, "app"), t).sections.additional_directories).toEqual([join(t.work, "app", "packages")]);
  });

  test("Hidden directory refused: ../.ssh beside a project in the home directory", () => {
    const t = tree();
    const p = project(`{\n  "additional_directories": ["../.ssh"]\n}`, join(t.home, "app"), t);
    expect(p.sections.additional_directories).toEqual([]);
    expect(p.problems).toHaveLength(1);
    expect(p.problems[0]).toMatchObject({ line: 2, path: "additional_directories.0", severity: "error" });
    expect(p.problems[0]!.message).toContain("is not allowed in a project file");
    expect(p.problems[0]!.message).toContain('starting with "."');
  });

  test("A hidden directory beside the project is refused too (../.hidden)", () => {
    const t = tree();
    expect(project(`{ "additional_directories": ["../.hidden"] }`, join(t.work, "app"), t).problems[0]!.message).toContain("is not allowed in a project file");
  });

  test("Home refused: ~ is the home directory, and ../.. is an ancestor of it", () => {
    const t = tree();
    const p = project(`{ "additional_directories": ["~", "${t.base}"] }`, join(t.home, "app"), t);
    expect(p.sections.additional_directories).toEqual([]);
    expect(p.problems.map((x) => x.path)).toEqual(["additional_directories.0", "additional_directories.1"]);
    expect(p.problems.every((x) => x.message.includes("is not allowed in a project file"))).toBe(true);
  });

  test("Outside the parent of the project is refused, even where it exists", () => {
    const t = tree();
    const p = project(`{ "additional_directories": ["${join(t.home, "shared")}", "../lib"] }`, join(t.work, "app"), t);
    expect(p.sections.additional_directories).toEqual([join(t.work, "lib")]);
    expect(p.problems).toHaveLength(1);
    expect(p.problems[0]!.path).toBe("additional_directories.0");
  });

  test("The parent itself is refused: it would add every sibling", () => {
    const t = tree();
    const p = project(`{ "additional_directories": [".."] }`, join(t.work, "app"), t);
    expect(p.sections.additional_directories).toEqual([]);
    expect(p.problems).toHaveLength(1);
  });

  test("A symlink beside the project that leads out of the limits is refused", () => {
    const t = tree();
    symlinkSync(join(t.home, ".ssh"), join(t.work, "escape"));
    const p = project(`{ "additional_directories": ["../escape"] }`, join(t.work, "app"), t);
    expect(p.sections.additional_directories).toEqual([]);
    expect(p.problems[0]!.message).toContain("is not allowed in a project file");
    expect(p.problems[0]!.message).toContain("resolves to");
  });

  test("The rest of the file still applies when an entry is refused", () => {
    const t = tree();
    const p = project(`{ "additional_directories": ["~"], "density": "compact" }`, join(t.home, "app"), t);
    expect(p.sections.density).toBe("compact");
  });

  test("A missing sibling is a warning, not a refusal", () => {
    const t = tree();
    const p = project(`{ "additional_directories": ["../nosuch"] }`, join(t.work, "app"), t);
    expect(p.problems).toMatchObject([{ severity: "warning" }]);
  });
});

describe("Harness arguments for additional directories", () => {
  const FILE = "/home/u/.config/acp-tui/config.jsonc";

  test("Valid template: no problem, and the catalogue entry carries it", () => {
    const text = `{ "agent_servers": { "my-auggie": { "command": "auggie", "args": ["--acp"], "additional_directory_args": ["--add-workspace", "{dir}"] } } }`;
    const parsed = parseConfigText(text, FILE, { kind: "user" });
    expect(parsed.problems).toEqual([]);
    expect(buildAgentCatalogue(text, FILE).agents.get("my-auggie")?.additionalDirectoryArgs).toEqual(["--add-workspace", "{dir}"]);
  });

  test("Template without a placeholder: a problem names the key and says it needs {dir}; the entry cannot be launched", () => {
    const text = `{ "agent_servers": { "x": { "command": "x", "additional_directory_args": ["--add-workspace"] } } }`;
    const parsed = parseConfigText(text, FILE, { kind: "user" });
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toMatchObject({ path: "agent_servers.x.additional_directory_args", severity: "error" });
    expect(parsed.problems[0]!.message).toContain("{dir}");
    const catalogue = buildAgentCatalogue(text, FILE);
    expect(catalogue.agents.has("x")).toBe(false);
    expect(catalogue.invalid.get("x")).toContain("additional_directory_args");
  });

  test("The built-in auggie carries the template; claude and opencode do not", () => {
    const agents = buildAgentCatalogue(null, FILE).agents;
    expect(agents.get("auggie")?.additionalDirectoryArgs).toEqual(["--add-workspace", "{dir}"]);
    expect(agents.get("claude")?.additionalDirectoryArgs).toBeUndefined();
    expect(agents.get("opencode")?.additionalDirectoryArgs).toBeUndefined();
  });
});
