// mvp-configuration tasks 9.1, 9.2 and 5.6 in process: `acp-tui config` (spec tui-config
// "Configuration problems are visible", "Commented default configuration", "Configuration schema"
// and "Configuration paths"; tui-theme "Legibility report for user themes"). Every test has its own
// configuration home and session directory; nothing reads ~/.config/acp-tui. The PTY tests of the
// same scenarios through the real CLI are subcommands.pty.test.ts.
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkProblems, runConfigCommand } from "../../src/config-command.ts";
import { formatProblemWithSeverity, hasErrors } from "../../src/config/problems.ts";
import { AGENT_EXAMPLES, commentedDefault, EXAMPLE } from "../../src/config/default-file.ts";
import { effectiveConfig, nextLastGood } from "../../src/config/effective.ts";
import { configJsonSchemaText } from "../../src/config/json-schema.ts";
import { describeSchema, HARNESS_NAME_SUBCOMMANDS, parseConfigText } from "../../src/config/load.ts";
import { RESERVED_SUBCOMMANDS } from "../../src/cli.ts";
import { readConfiguration } from "../../src/config/read.ts";
import { defaultConfig, describeOf, moduleFieldList, SECTIONS, valueListOf, valueListText, type SectionName } from "../../src/config/schema.ts";
import { DEFAULT_AGENT_EXAMPLE_COMMAND } from "../../src/agent/command.ts";
import type { z } from "zod";
import { MODULE_IDS } from "../../src/layout/modules.ts";

// The glyph checks measure with OpenTUI's width function, which needs @opentui/core evaluated
// (runConfigCommand loads it; the tests that call readConfiguration directly need it too).
beforeAll(async () => {
  await import("@opentui/core");
});

/** A home with a configuration directory (and `themes/`), and a session directory below it. */
function world(files: { config?: string; themes?: Record<string, string>; project?: string } = {}) {
  const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-config-cmd-")));
  const dir = join(home, "acp-tui");
  mkdirSync(join(dir, "themes"), { recursive: true });
  if (files.config !== undefined) writeFileSync(join(dir, "config.jsonc"), files.config);
  for (const [name, text] of Object.entries(files.themes ?? {})) writeFileSync(join(dir, "themes", `${name}.jsonc`), text);
  const cwd = join(home, "work");
  mkdirSync(cwd);
  if (files.project !== undefined) writeFileSync(join(cwd, ".acp-tui.jsonc"), files.project);
  const env = { XDG_CONFIG_HOME: home, HOME: home };
  return {
    home,
    cwd,
    env,
    configFile: join(dir, "config.jsonc"),
    themeFile: (name: string) => join(dir, "themes", `${name}.jsonc`),
    async run(args: string[], platform?: NodeJS.Platform) {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runConfigCommand(args, { stdout: { write: (t: string) => out.push(t) }, stderr: { write: (t: string) => err.push(t) } }, { cwd, env, ...(platform ? { platform } : {}) });
      return { code, stdout: out.join(""), stderr: err.join("") };
    },
  };
}

/** The comment text of a file, joined into one line per paragraph-insensitive string. */
const commentText = (text: string): string =>
  text
    .split("\n")
    .filter((l) => l.trim().startsWith("//"))
    .map((l) => l.trim().replace(/^(\/\/\s*)+/, ""))
    .join(" ")
    .replace(/\s+/g, " ");

describe("Commented default configuration (tasks 9.2 and 12.7)", async () => {
  test("Default loads as the default: saved as the user's file, config --check reports no problem and the effective configuration equals the built-in defaults", async () => {
    const text = commentedDefault();
    const w = world({ config: text });
    const parsed = parseConfigText(text, w.configFile, { knownAgents: ["auggie", "claude"] });
    expect(parsed.status).toBe("ok");
    expect(parsed.problems).toEqual([]);
    expect(parsed.rejected).toEqual([]);
    expect(effectiveConfig({ user: nextLastGood({}, parsed), project: {} })).toEqual(defaultConfig());
    expect(readConfiguration({ env: w.env, sessionDirectory: w.cwd }).config).toEqual(defaultConfig());
    const r = await w.run(["--check"]);
    expect(r).toEqual({ code: 0, stdout: "no configuration problems\n", stderr: "" });
  });

  test("every section is set, each preceded by its description from the schema, or by its value list", async () => {
    const text = commentedDefault();
    const comments = commentText(text);
    for (const section of Object.keys(SECTIONS) as SectionName[]) {
      // agent_startup_timeout_seconds is shown commented out, so that claude keeps its longer default.
      expect(text).toMatch(new RegExp(`^  ${section === "agent_startup_timeout_seconds" ? "// " : ""}"${section}": `, "m"));
      const list = valueListOf(SECTIONS[section]);
      if (list) expect(comments).toContain(`${list.heading}:`);
      else expect(comments).toContain(describeOf(SECTIONS[section])!.replace(/\s+/g, " "));
    }
    // Leaves without a value list say what they take.
    expect(comments).toContain("Takes a whole number from 1 or null.");
    expect(comments).not.toContain('Takes "full", "wheel" or "off".');
  });

  test("One list per setting (task 12.7): a setting with a value list prints a heading and one line per value with its meaning, matching its enumeration, and never a second list of the same values", async () => {
    const text = commentedDefault();
    const lines = text.split("\n");
    const mouse = lines.findIndex((l) => l === "  // Mouse policy:");
    expect(mouse).toBeGreaterThan(-1);
    expect(lines[mouse + 1]).toMatch(/^ {2}\/\/ "full" - acp-tui handles clicks, drags and the wheel/);
    expect(lines.slice(mouse, lines.indexOf('  "mouse": "full",')).filter((l) => /^ {2}\/\/ "(full|wheel|off)" - /.test(l))).toHaveLength(3);
    const listed: [string, z.core.$ZodType][] = [
      ["mouse", SECTIONS.mouse],
      ["clipboard", SECTIONS.clipboard],
      ["density", SECTIONS.density],
      ["interrupt", SECTIONS.interrupt],
    ];
    for (const [name, schema] of listed) {
      const list = valueListOf(schema)!;
      expect(list).toBeDefined();
      // The value list names exactly the enumeration's values, in its order.
      expect(`takes ${list.values.map(([v]) => JSON.stringify(v)).join(", ").replace(/, ([^,]*)$/, " or $1")}`).toBe(`takes ${describeSchema(schema)}`);
      expect(describeOf(schema)).toBe(valueListText(list));
      for (const [value, meaning] of list.values) expect(text).toContain(`// ${JSON.stringify(value)} - ${meaning.split(" ").slice(0, 4).join(" ")}`);
      expect(text).toContain(`  "${name}": `);
    }
    // Nested ones too: exit.print, attention.signal, glyphs.set and each terminal's strikethrough.
    for (const heading of ["What is printed below the command line on exit:", "The glyph set:", '"strikethrough" - how struck-through text is drawn:']) expect(text).toContain(`// ${heading}`);
    expect(text).toContain('    //   "overlay" - a combining stroke character');
  });

  test("No grammar false positives (task 12.7): every comment line closes each parenthesis it opens and holds an even number of double quotes", async () => {
    const text = commentedDefault();
    const comments = text.split("\n").filter((l) => l.trim().startsWith("//"));
    expect(comments.length).toBeGreaterThan(100);
    for (const line of comments) {
      let depth = 0;
      for (const ch of line) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth < 0) break;
      }
      if (depth !== 0) throw new Error(`unbalanced parentheses: ${line}`);
      if ((line.match(/"/g) ?? []).length % 2 !== 0) throw new Error(`odd number of double quotes: ${line}`);
    }
    // The set names are written as quoted values, never as bare words in prose.
    expect(text).not.toMatch(/\/\/ .*\bunicode\b(?!")/);
  });

  test("every module is listed with its fields", async () => {
    const text = commentedDefault();
    const comments = commentText(text);
    for (const id of MODULE_IDS) {
      expect(text).toContain(`"${id}": { "format": `);
      expect(comments).toContain(`Fields: ${moduleFieldList(id)}.`);
    }
  });

  test("Agent examples (task 12.7): the built-in claude with its real command, codex-acp, opencode acp and the others, each introduced as an example that is not active and naming its source", async () => {
    const text = commentedDefault();
    expect(text).toContain(`// "claude": { "command": "${DEFAULT_AGENT_EXAMPLE_COMMAND[0]}", "args": [${DEFAULT_AGENT_EXAMPLE_COMMAND.slice(1).map((arg) => JSON.stringify(arg)).join(", ")}], "env": { "ANTHROPIC_MODEL": "opus" } },`);
    expect(text).toContain('// "codex": { "command": "codex-acp", "args": [] },');
    expect(text).toContain('// "opencode": { "command": "opencode", "args": ["acp"] },');
    for (const name of ["auggie", "pi", "gemini", "deepseek"]) expect(text).toContain(`// "${name}": { "command": `);
    const lines = text.split("\n");
    for (const example of AGENT_EXAMPLES) {
      const at = lines.findIndex((l) => l.trim().startsWith(`// "${example.name}": {`));
      expect(at).toBeGreaterThan(-1);
      // The comment above the entry starts with the example marker and names a source.
      let start = at - 1;
      while (!lines[start]!.includes(EXAMPLE)) start--;
      const about = lines.slice(start, at).join(" ");
      expect(about).toMatch(/Sources?: /);
    }
  });

  test("Built-in harnesses shown: auggie, claude and opencode are each marked as built in and run as they do without an entry", async () => {
    const lines = commentedDefault().split("\n");
    for (const name of ["auggie", "claude", "opencode"]) {
      const at = lines.findIndex((l) => l.trim().startsWith(`// "${name}": {`));
      let start = at - 1;
      while (!lines[start]!.includes(EXAMPLE)) start--;
      expect(lines.slice(start, at).join(" ")).toMatch(/the built-in/);
    }
    expect(commentedDefault()).toContain("claude-agent-acp@0.94.0");
    expect(commentedDefault()).toContain("npm install -g @opencode/cli");
  });

  test("uncommenting every example gives a clean configuration with every example agent", async () => {
    // Remove the comment marks from each line that follows an "Example, not active" comment.
    const lines = commentedDefault().split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.includes(EXAMPLE)) continue;
      let j = i + 1;
      while (lines[j]!.trim().startsWith("// ") && !/^\s*\/\/ "/.test(lines[j]!)) j++;
      while (j < lines.length && /^\s*\/\/ "/.test(lines[j]!)) {
        lines[j] = lines[j]!.replace("// ", "");
        j++;
      }
    }
    const text = lines.join("\n");
    const parsed = parseConfigText(text, "/x/config.jsonc", { knownAgents: ["auggie", "claude"] });
    expect(parsed.problems).toEqual([]);
    expect(Object.keys(parsed.sections.agent_servers as object)).toEqual(AGENT_EXAMPLES.map((e) => e.name));
    expect((parsed.sections.keys as { global: unknown }).global).toEqual({ "ctrl+d": null, "ctrl+q": "detach" });
    expect((parsed.sections.theme as { tokens: unknown }).tokens).toEqual({ accent: 4, warning: { color: 3, bold: true } });
  });

  test("the header is in sections with headings", async () => {
    const lines = commentedDefault().split("\n");
    for (const heading of ["Making changes", "Validating changes", "Live reload", "Project files", "Editor completion"]) {
      const at = lines.indexOf(`// ${heading}`);
      expect(at).toBeGreaterThan(0);
      expect(lines[at - 1]).toBe("//");
      expect(lines[at + 1]).toBe("//");
    }
  });

  test("no U+2013 or U+2014 dashes, and comment lines of prose fit 100 columns", async () => {
    const text = commentedDefault();
    expect(text).not.toMatch(new RegExp("[\\u2013\\u2014]"));
    // Commented-out JSONC lines (`// "name": ...`, `//   { "left": ...`) may be longer; prose may not.
    for (const line of text.split("\n")) if (line.trim().startsWith("//") && !/^\s*(\/\/ +)+("[^"]*": |\{ ")/.test(line)) expect(line.length).toBeLessThanOrEqual(100);
  });
});

describe("config --check (task 9.1)", async () => {
  test("Check from the shell: an unknown token name in a theme file prints the theme file, the line and column and the token name, and exits non-zero", async () => {
    const w = world({ config: `{ "theme": "mine" }`, themes: { mine: `{\n  "tokens": {\n    "acent": 4\n  }\n}\n` } });
    const r = await w.run(["--check"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(`${w.themeFile("mine")}:3:5: error: `);
    expect(r.stdout).toContain("acent");
    expect(r.stdout).toMatch(/1 error, 0 warnings\n$/);
  });

  test("Weak token on One Light (task 5.6): a warning names tool.duration, Zed One Light and the ratio below 3:1, and the exit status is 0", async () => {
    const w = world({ config: `{ "theme": "weak" }`, themes: { weak: `{ "tokens": { "tool.duration": 11 } }` } });
    const r = await w.run(["--check"]);
    expect(r.code).toBe(0);
    const line = r.stdout.split("\n").find((l) => l.includes("tool.duration") && l.includes("Zed One Light"));
    expect(line).toBeDefined();
    expect(line).toContain(": warning: ");
    const ratio = Number(/is ([0-9.]+):1/.exec(line!)?.[1]);
    expect(ratio).toBeLessThan(3);
    expect(r.stdout).toMatch(/0 errors, \d+ warnings?\n$/);
  });

  test("a wrong value in the user's file is an error at its line and column (exit 1); a misspelt name only a warning (exit 0)", async () => {
    const wrong = world({ config: `{\n  "mouse": "sometimes",\n}\n` });
    const r = await wrong.run(["--check"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(`${wrong.configFile}:2:12: error: mouse takes "full", "wheel" or "off", not "sometimes"`);
    const misspelt = world({ config: `{ "wheel_line": 2 }` });
    const m = await misspelt.run(["--check"]);
    expect(m.code).toBe(0);
    expect(m.stdout).toContain(": warning: wheel_line is not a known setting and is ignored (did you mean wheel_lines?)");
  });

  test("key overrides: kept-key warnings for PhpStorm's two terminals and Zed, whatever the terminal running the check; warnings only, exit 0", async () => {
    const w = world({ config: `{ "keys": { "global": { "ctrl+p": "find" } } }` });
    const r = await w.run(["--check"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Zed");
    expect(r.stdout).toContain(`${w.configFile}:1:`);
    expect(r.stdout).toContain("ctrl+p");
    // A rejected override is an error.
    const bad = world({ config: `{ "keys": { "global": { "ctrl+q": "explode" } } }` });
    const b = await bad.run(["--check"]);
    expect(b.stdout).toContain("explode");
    expect(b.code).toBe(1);
  });

  test("Palette keeps one route: ctrl+p removed from global reports no problem and exits 0, because ? in the prompt context still opens the palette", async () => {
    const w = world({ config: `{ "keys": { "global": { "ctrl+p": null } } }` });
    const r = await w.run(["--check"]);
    expect(r.stdout).not.toContain("palette");
    expect(r.stdout).not.toContain("warning");
    expect(r.stdout).not.toContain("error");
    expect(r.code).toBe(0);
  });

  test("glyph overrides: a wide glyph is reported and the check still exits 0 (a warning)", async () => {
    const w = world({ config: `{ "glyphs": { "set": "unicode", "overrides": { "tool.status.ok": "✅" } } }` });
    const r = await w.run(["--check"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("glyphs.overrides.tool.status.ok");
    expect(r.stdout).toContain("2 cells where 1 is required");
  });

  test("a project override against the user's glyph set is checked over the merged configuration", async () => {
    // The project's marker override is valid in the unicode set it assumes, but the user's set is
    // ascii, whose own glyphs may hold it: checked with the merged files.
    const w = world({ config: `{ "glyphs": "ascii" }`, project: `{ "glyphs": { "overrides": { "permission.marker": "*" } } }` });
    const problems = checkProblems(readConfiguration({ env: w.env, sessionDirectory: w.cwd }));
    const marker = problems.filter((p) => p.path === "glyphs.overrides.permission.marker");
    expect(marker.length).toBeGreaterThan(0);
    expect(marker[0]!.severity).toBe("warning");
  });

  test("Harness named like a subcommand: an agent_servers entry named config or glyphs, or starting with -, is a warning that says it is reached only with --harness (exit 0)", async () => {
    const w = world({
      config: `{
  "agent_servers": {
    "config": { "command": "bun", "args": ["a.ts"] },
    "glyphs": { "command": "bun", "args": ["b.ts"] },
    "-odd": { "command": "bun", "args": ["c.ts"] },
    "fine": { "command": "bun", "args": ["d.ts"] }
  }
}
`,
    });
    const r = await w.run(["--check"]);
    expect(r.code).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.includes(": warning: "));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(`${w.configFile}:3:5: warning: agent_servers.config is also a subcommand`);
    expect(lines[0]).toContain("reached only with --harness config");
    expect(lines[1]).toContain("agent_servers.glyphs is also a subcommand");
    expect(lines[2]).toContain('starts with "-"');
    expect(lines[2]).toContain("--harness -odd");
    expect(r.stdout).not.toContain("agent_servers.fine");
    expect(r.stdout).toMatch(/0 errors, 3 warnings\n$/);
  });

  describe("Argument the interpreter would read (windows-support, tui-agent-session)", () => {
    const entry = `{
  "agent_servers": {
    "auggie": { "command": "auggie", "args": ["--acp", "a&b", "--x=50%", "plain"] },
    "other": { "command": "bun", "args": ["x|y<z>w"] }
  }
}
`;

    // On Linux a `win32` platform given to `config --check` also moves the configuration file to
    // Windows' locations, so these two read the file's text with the Windows rules directly and
    // format the problems as `config --check` prints them.
    const windowsCheck = (text: string, file = "/x/config.jsonc") => {
      const problems = parseConfigText(text, file, { knownAgents: ["auggie", "claude"], platform: "win32" }).problems;
      return { problems, stdout: problems.map(formatProblemWithSeverity).join("\n") };
    };

    test("on Windows each argument holding \" % & | < > ^ or a line break is a warning at that argument, naming the characters (exit 0)", () => {
      const r = windowsCheck(entry);
      expect(hasErrors(r.problems)).toBe(false);
      const lines = r.stdout.split("\n").filter((l) => l.includes(": warning: "));
      expect(lines).toHaveLength(3);
      // "a&b" is the second argument of the first entry: line 3, the string's own column.
      expect(lines[0]).toContain(`/x/config.jsonc:3:`);
      expect(lines[0]).toContain('warning: agent_servers.auggie.args.1 holds "&", which the command interpreter (cmd.exe) treats specially');
      expect(lines[0]).toContain("so the harness will not start if its command is a command script");
      expect(lines[1]).toContain('agent_servers.auggie.args.2 holds "%"');
      expect(lines[2]).toContain('agent_servers.other.args.0 holds "|", "<", ">"');
      expect(r.stdout).not.toContain("args.0 holds \"&\"");
      expect(r.stdout).not.toContain("auggie.args.0");
      expect(r.stdout).not.toContain("auggie.args.3");
    });

    test("the quote and a carriage return or line feed are named too (Bun refuses them in a command script's argument)", () => {
      const text = JSON.stringify({ agent_servers: { a: { command: "a", args: ['say "hi"', "one\ntwo", "one\r\ntwo", "fine"] } } });
      const r = windowsCheck(text);
      const lines = r.stdout.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("agent_servers.a.args.0 holds '\"', which");
      expect(lines[1]).toContain("agent_servers.a.args.1 holds \\n, which");
      expect(lines[2]).toContain("agent_servers.a.args.2 holds \\r, \\n, which");
      expect(lines[2]).toContain("Bun refuses to start one with them in an argument");
    });

    test("the warning's column is the argument's own", () => {
      const text = `{ "agent_servers": { "a": { "command": "a", "args": ["ok", "x^y"] } } }\n`;
      const r = windowsCheck(text);
      expect(r.stdout).toContain(`/x/config.jsonc:1:${text.indexOf('"x^y"') + 1}: warning: agent_servers.a.args.1 holds "^"`);
    });

    test("on Linux and macOS the same file has no warning", async () => {
      const w = world({ config: entry });
      for (const platform of ["linux", "darwin"] as const) {
        const r = await w.run(["--check"], platform);
        expect(r.code).toBe(0);
        expect(r.stdout).toBe("no configuration problems\n");
      }
    });

    test("the warning is a configuration problem like any other, so the app's notice shows it too", () => {
      const parsed = parseConfigText(entry, "/x/config.jsonc", { knownAgents: ["auggie", "claude"], platform: "win32" });
      expect(parsed.problems.map((p) => [p.path, p.severity])).toEqual([
        ["agent_servers.auggie.args.1", "warning"],
        ["agent_servers.auggie.args.2", "warning"],
        ["agent_servers.other.args.0", "warning"],
      ]);
      // The entries stay launchable: a warning does not refuse them.
      expect(Object.keys(parsed.sections.agent_servers as object)).toEqual(["auggie", "other"]);
      expect(parsed.invalidAgents).toEqual({});
    });
  });

  test("the subcommand names the loader warns about are the CLI's reserved ones", () => {
    expect([...HARNESS_NAME_SUBCOMMANDS]).toEqual([...RESERVED_SUBCOMMANDS]);
  });

  test("the project file of the current directory is checked too, and a denied setting there is an error", async () => {
    const w = world({ project: `{ "agent_servers": { "evil": { "command": "/tmp/x" } } }` });
    const r = await w.run(["--check"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(join(w.cwd, ".acp-tui.jsonc"));
    expect(r.stdout).toContain("not allowed in a project file");
  });
});

describe("config --print-schema, --path and arguments (task 9.1)", async () => {
  test("Editor completion: the JSON Schema has mouse as an enumeration of full, wheel and off with the default full and a description", async () => {
    const r = await world().run(["--print-schema"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(configJsonSchemaText());
    const mouse = (JSON.parse(r.stdout) as { properties: Record<string, { enum?: string[]; default?: unknown; description?: string }> }).properties["mouse"]!;
    expect(mouse.enum).toEqual(["full", "wheel", "off"]);
    expect(mouse.default).toBe("full");
    expect(mouse.description).toBeTruthy();
  });

  test("Paths printed: the user's file, the themes directory, and that no project file applies", async () => {
    const w = world();
    const r = await w.run(["--path"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`user file:    ${w.configFile} (absent)\nthemes:       ${join(w.home, "acp-tui", "themes")} (present)\nproject file: none applies for ${w.cwd}\n`);
    const withFiles = world({ config: "{}", project: "{}" });
    const p = await withFiles.run(["--path"]);
    expect(p.stdout).toContain(`user file:    ${withFiles.configFile} (present)`);
    expect(p.stdout).toContain(`project file: ${join(withFiles.cwd, ".acp-tui.jsonc")} (present)`);
  });

  test("--help prints the usage; no action, two actions or an unknown argument is an error (exit 1)", async () => {
    const w = world();
    expect(await w.run(["--help"])).toMatchObject({ code: 0, stdout: expect.stringContaining("Usage: acp-tui config") });
    for (const args of [[], ["--check", "--path"], ["--wobble"], ["check"]]) {
      const r = await w.run(args);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("Usage: acp-tui config");
      expect(r.stdout).toBe("");
    }
    // The same action twice is one action.
    expect((await w.run(["--path", "--path"])).code).toBe(0);
  });
});

describe("Windows: paths, the commented default and the byte order mark (windows-support)", async () => {
  test("APPDATA location: config --path names C:\\Users\\u\\AppData\\Roaming\\acp-tui's file and themes directory", async () => {
    const w = world();
    const out: string[] = [];
    const env = { USERPROFILE: "C:\\Users\\u", APPDATA: "C:\\Users\\u\\AppData\\Roaming", HOME: w.home };
    const code = await runConfigCommand(["--path"], { stdout: { write: (t: string) => out.push(t) }, stderr: { write: () => true } }, { cwd: w.cwd, env, platform: "win32" });
    expect(code).toBe(0);
    expect(out.join("")).toBe(
      `user file:    C:\\Users\\u\\AppData\\Roaming\\acp-tui\\config.jsonc (absent)\nthemes:       C:\\Users\\u\\AppData\\Roaming\\acp-tui\\themes (absent)\nproject file: none applies for ${w.cwd}\n`,
    );
  });

  test("the commented default names the platform's location, and loads as the defaults on Windows too", () => {
    const windows = commentedDefault("win32");
    expect(commentText(windows)).toContain("This is acp-tui's configuration file: %APPDATA%\\acp-tui\\config.jsonc, or $XDG_CONFIG_HOME\\acp-tui\\config.jsonc when XDG_CONFIG_HOME is set.");
    expect(windows).toContain("file:///C:/Users/you/AppData/Roaming/acp-tui/config.schema.json");
    expect(windows).not.toContain("~/.config");
    const parsed = parseConfigText(windows, "C:\\Users\\u\\AppData\\Roaming\\acp-tui\\config.jsonc", { knownAgents: ["auggie", "claude"] });
    expect(parsed.problems).toEqual([]);
    expect(effectiveConfig({ user: nextLastGood({}, parsed), project: {} })).toEqual(defaultConfig());
    // Linux and macOS keep their text.
    for (const platform of ["linux", "darwin"] as const) {
      expect(commentText(commentedDefault(platform))).toContain("$XDG_CONFIG_HOME/acp-tui/config.jsonc, or ~/.config/acp-tui/config.jsonc when XDG_CONFIG_HOME is not set.");
      expect(commentedDefault(platform)).not.toContain("APPDATA");
    }
  });

  test("File saved with a BOM: config --check reports no problem and the setting applies", async () => {
    const w = world({ config: `\uFEFF{ "mouse": "off" }` });
    expect(await w.run(["--check"])).toEqual({ code: 0, stdout: "no configuration problems\n", stderr: "" });
    expect(readConfiguration({ env: w.env, sessionDirectory: w.cwd }).config.mouse).toBe("off");
  });

  test("a project file and a theme file saved with a BOM read as without one; positions are unchanged", async () => {
    const clean = world({ config: `{ "theme": "mine" }`, themes: { mine: `\uFEFF{ "tokens": {} }` }, project: `\uFEFF{ "density": "verbose" }` });
    expect(await clean.run(["--check"])).toEqual({ code: 0, stdout: "no configuration problems\n", stderr: "" });
    expect(readConfiguration({ env: clean.env, sessionDirectory: clean.cwd }).config.density).toBe("verbose");
    const typo = world({ config: `{ "theme": "mine" }`, themes: { mine: `\uFEFF{\n  "tokens": {\n    "acent": 4\n  }\n}\n` } });
    expect((await typo.run(["--check"])).stdout).toContain(`${typo.themeFile("mine")}:3:5: error: `);
    // The parser drops one given directly too (a test's reader), with the same columns.
    const direct = parseConfigText(`\uFEFF{ "mouse": 3 }`, "/x/config.jsonc");
    expect(direct.problems.map((p) => [p.line, p.column])).toEqual(parseConfigText(`{ "mouse": 3 }`, "/x/config.jsonc").problems.map((p) => [p.line, p.column]));
  });
});

describe("config --diff-default (interface-feedback 5.3)", () => {
  test("New setting shown: a default of an earlier version without one setting gives a hunk whose + lines hold it", async () => {
    const text = commentedDefault();
    const at = text.indexOf("markdown");
    expect(at).toBeGreaterThan(0);
    // Remove one whole line (and the lines of its comment block before it that start with //).
    const lines = text.split("\n");
    const index = lines.findIndex((l) => l.includes("table_row_rules"));
    expect(index).toBeGreaterThan(0);
    const without = lines.filter((_, i) => i !== index).join("\n");
    const w = world({ config: without });
    const r = await w.run(["--diff-default"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const out = r.stdout.split("\n");
    expect(out.slice(0, 2)).toEqual(["--- config.jsonc", "+++ default"]);
    expect(out[2]).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@$/);
    expect(out).toContain(`+${lines[index]}`);
    expect(out.filter((l) => l.startsWith("+") && !l.startsWith("+++"))).toEqual([`+${lines[index]}`]);
    expect(out.filter((l) => l.startsWith("-") && !l.startsWith("---"))).toEqual([]);
    // Three lines of context each side of the one change.
    expect(out.filter((l) => l.startsWith(" ")).length).toBe(6);
    expect(r.stdout.endsWith("\n")).toBe(true);
  });

  test("Identical: a file just written by the install says it is the same, in one line", async () => {
    const w = world({ config: commentedDefault() });
    const r = await w.run(["--diff-default"]);
    expect(r).toEqual({ code: 0, stdout: "config.jsonc is the same as the default.\n", stderr: "" });
  });

  test("Identical apart from CRLF line endings (git on Windows)", async () => {
    const w = world({ config: commentedDefault().replaceAll("\n", "\r\n") });
    expect((await w.run(["--diff-default"])).stdout).toBe("config.jsonc is the same as the default.\n");
  });

  test("No file: says so, names --print-default and exits 1", async () => {
    const w = world();
    const r = await w.run(["--diff-default"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(`acp-tui: config: no configuration file at ${w.configFile}; acp-tui config --print-default prints the default\n`);
  });

  test("An invalid file still diffs (it is read as text), and exits 0", async () => {
    const w = world({ config: `{ "mouse": "nonsense", oops` });
    const r = await w.run(["--diff-default"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('-{ "mouse": "nonsense", oops');
    expect(r.stdout).toContain("--- config.jsonc\n+++ default\n");
  });

  test("No colour and no escape sequences: control characters in the user's file are shown as U+FFFD", async () => {
    const w = world({ config: `{ "mouse": "off" } // \u001b[31mred\u001b]52;c;eA==\u0007\n` });
    const r = await w.run(["--diff-default"]);
    expect(r.code).toBe(0);
    // eslint-disable-next-line no-control-regex
    expect(r.stdout).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(r.stdout).toContain("\uFFFD[31mred");
  });

  test("The help lists it within 78 columns, and it is the only action with it", async () => {
    const w = world();
    const r = await w.run(["--help"]);
    expect(r.stdout).toContain("--diff-default");
    for (const line of r.stdout.split("\n")) expect(line.length).toBeLessThanOrEqual(78);
    const twice = await w.run(["--diff-default", "--path"]);
    expect(twice.code).toBe(1);
  });
});
