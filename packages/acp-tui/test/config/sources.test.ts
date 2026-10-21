// mvp-configuration tasks 2.1, 2.2 and 2.4: where the configuration comes from
// and how the files combine (spec tui-config "Configuration file", "Per-project
// file" and "Precedence of settings"; design D4 and D5). Real files in
// temporary directories; `home` stands in for the user's home directory.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveConfig, mergeRaw } from "../../src/config/effective.ts";
import { defaultConfig } from "../../src/config/schema.ts";
import { configDirectory, findProjectFile, readConfigFile, themesDirectory, userConfigFile, within } from "../../src/config/sources.ts";
import { createConfigStore } from "../../src/config/store.ts";

const temp = (prefix: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));

/** `/work` with `/work/repo` a git work tree (`.git` a directory) and `/work/repo/src/lib`. */
function workTree() {
  const work = temp("acp-tui-work-");
  const repo = join(work, "repo");
  const lib = join(repo, "src", "lib");
  mkdirSync(lib, { recursive: true });
  mkdirSync(join(repo, ".git"));
  return { work, repo, lib };
}

describe("Configuration file (task 2.1)", () => {
  test("XDG location: $XDG_CONFIG_HOME/acp-tui/config.jsonc when absolute, else ~/.config", () => {
    // The POSIX rule, whatever the host: the platform is named, so the expectations are literal.
    expect(userConfigFile({ XDG_CONFIG_HOME: "/tmp/cfg", HOME: "/home/u" }, "linux")).toBe("/tmp/cfg/acp-tui/config.jsonc");
    expect(userConfigFile({ HOME: "/home/u" }, "linux")).toBe("/home/u/.config/acp-tui/config.jsonc");
    expect(userConfigFile({ XDG_CONFIG_HOME: "cfg", HOME: "/home/u" }, "linux")).toBe("/home/u/.config/acp-tui/config.jsonc");
    expect(configDirectory({ XDG_CONFIG_HOME: "/tmp/cfg" }, "linux")).toBe("/tmp/cfg/acp-tui");
    expect(themesDirectory({ XDG_CONFIG_HOME: "/tmp/cfg" }, "linux")).toBe("/tmp/cfg/acp-tui/themes");
  });

  test("XDG location: the file there is read, comments and trailing commas included", () => {
    const xdg = temp("acp-tui-xdg-");
    mkdirSync(join(xdg, "acp-tui"));
    writeFileSync(join(xdg, "acp-tui", "config.jsonc"), `{ // keyboard only\n  "mouse": "off", }`);
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: xdg }, sessionDirectory: null });
    expect(store.config().mouse).toBe("off");
    expect(store.problems()).toEqual([]);
  });

  test("config.dist.jsonc beside the file is never read: invalid, it changes nothing and reports nothing (interface-feedback 5.2)", () => {
    const xdg = temp("acp-tui-xdg-");
    mkdirSync(join(xdg, "acp-tui"));
    writeFileSync(join(xdg, "acp-tui", "config.jsonc"), `{ "mouse": "off" }`);
    writeFileSync(join(xdg, "acp-tui", "config.dist.jsonc"), `{ "mouse": "nonsense", "density": 7, oops`);
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: xdg }, sessionDirectory: null });
    expect(store.config().mouse).toBe("off");
    expect(store.config().density).toBe(defaultConfig().density);
    expect(store.problems()).toEqual([]);
    expect(Object.values(store.files()).filter((f) => typeof f === "string" && f.includes("dist"))).toEqual([]);
    // And with no config.jsonc at all, a valid dist file is no configuration either.
    const other = temp("acp-tui-xdg-");
    mkdirSync(join(other, "acp-tui"));
    writeFileSync(join(other, "acp-tui", "config.dist.jsonc"), `{ "mouse": "off" }`);
    expect(createConfigStore({ env: { XDG_CONFIG_HOME: other, HOME: other }, sessionDirectory: null }).config()).toEqual(defaultConfig());
  });

  test("No file: every setting has its default and there is no problem", () => {
    const xdg = temp("acp-tui-xdg-");
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: xdg }, sessionDirectory: null });
    expect(store.config()).toEqual(defaultConfig());
    expect(store.problems()).toEqual([]);
  });
});

describe("Per-project file (task 2.2)", () => {
  test("Found at the work tree root: from /work/repo/src/lib, the root's .acp-tui.jsonc sets verbose over the user's compact", () => {
    const { repo, lib, work } = workTree();
    writeFileSync(join(repo, ".acp-tui.jsonc"), `{ "density": "verbose" }`);
    expect(findProjectFile(lib, { home: "/nonexistent-home" })).toBe(join(repo, ".acp-tui.jsonc"));
    const xdg = temp("acp-tui-xdg-");
    mkdirSync(join(xdg, "acp-tui"));
    writeFileSync(join(xdg, "acp-tui", "config.jsonc"), `{ "density": "compact" }`);
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: "/nonexistent-home" }, sessionDirectory: lib });
    expect(store.config().density).toBe("verbose");
    expect(store.files().project).toBe(join(repo, ".acp-tui.jsonc"));
    expect(work).toBeTruthy();
  });

  test("Not above the work tree: /work/.acp-tui.jsonc is not read for a session at the root of /work/repo", () => {
    const { work, repo, lib } = workTree();
    writeFileSync(join(work, ".acp-tui.jsonc"), `{ "density": "focus" }`);
    expect(findProjectFile(repo, { home: "/nonexistent-home" })).toBeNull();
    expect(findProjectFile(lib, { home: "/nonexistent-home" })).toBeNull();
  });

  test("the nearest file wins and files do not stack", () => {
    const { repo, lib } = workTree();
    writeFileSync(join(repo, ".acp-tui.jsonc"), `{ "density": "verbose", "mouse": "off" }`);
    writeFileSync(join(repo, "src", ".acp-tui.jsonc"), `{ "density": "focus" }`);
    expect(findProjectFile(lib, { home: "/nonexistent-home" })).toBe(join(repo, "src", ".acp-tui.jsonc"));
    const xdg = temp("acp-tui-xdg-");
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: "/nonexistent-home" }, sessionDirectory: lib });
    expect(store.config().density).toBe("focus");
    expect(store.config().mouse).toBe("full");
  });

  test("a .git file (a linked work tree or submodule) also marks the root", () => {
    const work = temp("acp-tui-work-");
    const repo = join(work, "linked");
    mkdirSync(join(repo, "sub"), { recursive: true });
    writeFileSync(join(repo, ".git"), "gitdir: /elsewhere\n");
    writeFileSync(join(work, ".acp-tui.jsonc"), "{}");
    writeFileSync(join(repo, ".acp-tui.jsonc"), "{}");
    expect(findProjectFile(join(repo, "sub"), { home: "/nonexistent-home" })).toBe(join(repo, ".acp-tui.jsonc"));
  });

  test("outside a work tree only the session directory itself is read", () => {
    const outer = temp("acp-tui-plain-");
    const inner = join(outer, "inner");
    mkdirSync(inner);
    writeFileSync(join(outer, ".acp-tui.jsonc"), "{}");
    expect(findProjectFile(inner, { home: "/nonexistent-home" })).toBeNull();
    writeFileSync(join(inner, ".acp-tui.jsonc"), "{}");
    expect(findProjectFile(inner, { home: "/nonexistent-home" })).toBe(join(inner, ".acp-tui.jsonc"));
  });

  test("never above the user's home directory, even inside a work tree that holds it", () => {
    const top = temp("acp-tui-hometree-");
    mkdirSync(join(top, ".git"));
    writeFileSync(join(top, ".acp-tui.jsonc"), "{}");
    const home = join(top, "home", "u");
    const project = join(home, "project");
    mkdirSync(project, { recursive: true });
    expect(findProjectFile(project, { home })).toBeNull();
    writeFileSync(join(home, ".acp-tui.jsonc"), `{}`);
    expect(findProjectFile(project, { home })).toBe(join(home, ".acp-tui.jsonc"));
  });

  test("a session started with a directory argument: the store looks from that directory", () => {
    const { repo } = workTree();
    writeFileSync(join(repo, ".acp-tui.jsonc"), `{ "mouse": "wheel" }`);
    const xdg = temp("acp-tui-xdg-");
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: "/nonexistent-home" }, sessionDirectory: repo });
    expect(store.config().mouse).toBe("wheel");
    // No session directory (the subcommands, tests): no project file.
    expect(createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: "/nonexistent-home" }, sessionDirectory: null }).files().project).toBeNull();
  });

  test("a project file's denied settings are reported and ignored; the rest applies", () => {
    const { repo } = workTree();
    writeFileSync(join(repo, ".acp-tui.jsonc"), JSON.stringify({ agent_servers: { evil: { command: "/tmp/x" } }, default_agent: "evil", clipboard: "osc52", terminals: { zed: { hyperlinks: true } }, glyphs: "ascii", keys: { card: { escape: "choose2" }, elicitation: { y: "confirm" }, conversation: { c: "copyItem" } } }));
    const xdg = temp("acp-tui-xdg-");
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: "/nonexistent-home" }, sessionDirectory: repo });
    const config = store.config();
    expect(config.agent_servers).toEqual({});
    expect(config.default_agent_server).toBe("auggie");
    expect(config.clipboard).toBe("auto");
    expect(config.terminals).toEqual({});
    expect(config.glyphs.set).toBe("ascii");
    expect(config.keys).toEqual({ conversation: { c: "copyItem" } });
    // `default_agent`, the old name, is the same setting and the same limit (day-two-feedback task 13.5).
    expect(store.problems().map((p) => p.path)).toEqual(["agent_servers", "default_agent_server", "clipboard", "terminals", "keys.card", "keys.elicitation"]);
    for (const problem of store.problems()) expect(problem.message).toContain("is not allowed in a project file");
  });
});

describe("Precedence of settings (task 2.4)", () => {
  test("default, then the user's file, then the project file, then the command line", () => {
    const user = { mouse: "off", density: "verbose", attention: { signal: "osc9" }, exit: { print: "none" } };
    const project = { density: "focus", attention: { long_turn_seconds: 10 } };
    const config = effectiveConfig({ user, project, overrides: { mouse: "wheel", exit_print: "transcript" } });
    expect(config.mouse).toBe("wheel");
    expect(config.density).toBe("focus");
    // Objects merge key by key: the project file's threshold keeps the user's signal.
    expect(config.attention).toEqual({ signal: "osc9", long_turn_seconds: 10, title_marker: true });
    expect(config.exit.print).toBe("transcript");
    expect(config.wheel_lines).toBeNull();
    expect(effectiveConfig({ user: {}, project: {}, overrides: { wheel_lines: 2, clipboard: "none" } })).toMatchObject({ wheel_lines: 2, clipboard: "none" });
  });

  test("arrays and values are replaced, null kept as a value (a key removed)", () => {
    expect(mergeRaw({ a: [1, 2], b: { c: 1 } }, { a: [3], b: { d: null } })).toEqual({ a: [3], b: { c: 1, d: null } });
    expect(mergeRaw({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  test("a reload never changes a setting the command line set", () => {
    const xdg = temp("acp-tui-xdg-");
    mkdirSync(join(xdg, "acp-tui"));
    const file = join(xdg, "acp-tui", "config.jsonc");
    writeFileSync(file, `{ "exit": { "print": "summary" }, "mouse": "off" }`);
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: xdg }, sessionDirectory: null, overrides: { exit_print: "transcript" } });
    expect(store.pinned).toEqual(["exit.print"]);
    expect(store.config().exit.print).toBe("transcript");
    writeFileSync(file, `{ "exit": { "print": "none" }, "mouse": "wheel" }`);
    const result = store.reload();
    expect(store.config().exit.print).toBe("transcript");
    expect(store.config().mouse).toBe("wheel");
    expect(result.changed).toEqual(["mouse"]);
  });
});

describe("Byte order mark ignored (windows-support)", () => {
  test("readConfigFile drops a leading U+FEFF, and only a leading one", () => {
    const dir = temp("acp-tui-bom-");
    const file = join(dir, "config.jsonc");
    writeFileSync(file, `\uFEFF{ "mouse": "off" }`);
    expect(readConfigFile(file).text).toBe(`{ "mouse": "off" }`);
    writeFileSync(file, `{ "x": "\uFEFF" }`);
    expect(readConfigFile(file).text).toBe(`{ "x": "\uFEFF" }`);
  });

  test("File saved with a BOM: the store starts with mouse off and no problem", () => {
    const xdg = temp("acp-tui-xdg-");
    mkdirSync(join(xdg, "acp-tui"));
    writeFileSync(join(xdg, "acp-tui", "config.jsonc"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`{ "mouse": "off" }`)]));
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: xdg }, sessionDirectory: null });
    expect(store.config().mouse).toBe("off");
    expect(store.problems()).toEqual([]);
  });
});

describe("within (the project file search stops above the home directory)", () => {
  test("Windows: case and the kind of separator do not matter", () => {
    expect(within("C:\\Users\\u\\work", "c:\\users\\U", "win32")).toBe(true);
    expect(within("C:/Users/u/work", "C:\\Users\\u\\", "win32")).toBe(true);
    expect(within("C:\\Users\\u", "C:\\Users\\u", "win32")).toBe(true);
    expect(within("C:\\Users", "C:\\Users\\u", "win32")).toBe(false);
    expect(within("C:\\Users\\u2", "C:\\Users\\u", "win32")).toBe(false);
  });

  test("Linux and macOS: exact", () => {
    expect(within("/home/u/work", "/home/u", "linux")).toBe(true);
    expect(within("/home/U/work", "/home/u", "linux")).toBe(false);
    expect(within("/home/u2", "/home/u", "darwin")).toBe(false);
  });
});
