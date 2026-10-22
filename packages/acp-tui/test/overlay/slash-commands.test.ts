// day-one-feedback task 10.1 and 10.3 (spec tui-palette "acp-tui commands in the slash menu",
// "Typed acp-tui commands"; design D10): the slash table, which entries are listed, and which typed
// prompt runs a command. Pure, over the full command catalogue as palette.test.ts builds it.
import { describe, expect, test } from "bun:test";
import { COMMAND_TITLES, DEFAULT_KEY_MAP, KEY_ACTIONS, KEY_CONTEXTS, keyLabel, keysFor } from "../../src/keys/keymap.ts";
import type { CatalogueEntry } from "../../src/keys/register.ts";
import { ACP_TUI_GROUP, agentItems, completionOf, enterCompletes, paletteItems, SLASH_COMMANDS, slashItems, typedAddDirectory, typedSlashCommand } from "../../src/overlay/palette.ts";

function fullCatalogue(): CatalogueEntry[] {
  return KEY_CONTEXTS.flatMap((context) =>
    (KEY_ACTIONS[context] as readonly string[]).map((action) => ({
      name: `${context}.${action}`,
      context,
      action,
      title: (COMMAND_TITLES[context] as Record<string, string>)[action]!,
      keys: keysFor(DEFAULT_KEY_MAP, context, action as never).map(keyLabel),
    })),
  );
}

const select = (id: string, category = id) => ({ type: "select" as const, id, name: id, category, currentValue: "a", options: [{ value: "a", name: "A" }] });
const state = (over: Partial<Parameters<typeof slashItems>[1]> = {}) => ({ configOptions: [], agentCommands: [] as string[], ...over });
const names = (items: ReturnType<typeof slashItems>) => items.map((i) => i.title);

describe("the slash table", () => {
  test("lists /model, /mode, /effort, /sessions, /find, /export, /add-dir, /help and /exit, each running a catalogue action", () => {
    expect(SLASH_COMMANDS.map((c) => c.name)).toEqual(["model", "mode", "effort", "sessions", "find", "export", "add-dir", "help", "exit"]);
    const catalogue = new Set(fullCatalogue().map((e) => e.name));
    for (const command of SLASH_COMMANDS) expect(catalogue.has(command.command)).toBe(true);
  });
});

describe("acp-tui commands in the slash menu (task 10.1)", () => {
  test("Auggie without built-ins: a model and a mode but no effort option leaves out /effort", () => {
    const items = slashItems(fullCatalogue(), state({ configOptions: [select("model"), select("mode")], agentCommands: ["review"] }));
    expect(names(items)).toEqual(["/model", "/mode", "/sessions", "/find", "/export", "/add-dir", "/help", "/exit"]);
    for (const item of items) {
      expect(item.group).toBe(ACP_TUI_GROUP);
      expect(item.action.kind).toBe("command");
      expect(item.description).toBeTruthy();
    }
    // The key column shows the action's key.
    expect(items.find((i) => i.title === "/find")?.keys).toEqual(keysFor(DEFAULT_KEY_MAP, "global", "find").map(keyLabel));
  });

  test("an entry is listed only while its action is available: no option, no picker; an unregistered command is left out", () => {
    expect(names(slashItems(fullCatalogue(), state()))).toEqual(["/sessions", "/find", "/export", "/add-dir", "/help", "/exit"]);
    const noSessions = fullCatalogue().filter((e) => e.name !== "global.sessions");
    expect(names(slashItems(noSessions, state()))).not.toContain("/sessions");
    const all = slashItems(fullCatalogue(), state({ configOptions: [select("model"), select("mode"), select("effort", "thought_level")] }));
    expect(names(all)).toEqual(["/model", "/mode", "/effort", "/sessions", "/find", "/export", "/add-dir", "/help", "/exit"]);
  });

  test("The agent's name wins: an advertised command of the same name leaves acp-tui's out", () => {
    const items = slashItems(fullCatalogue(), state({ configOptions: [select("model")], agentCommands: ["model", "help"] }));
    expect(names(items)).not.toContain("/model");
    expect(names(items)).not.toContain("/help");
    expect(names(items)).toContain("/exit");
  });

  test("each entry runs the catalogue command the table names, with its context", () => {
    const items = slashItems(fullCatalogue(), state({ configOptions: [select("model")] }));
    expect(items.find((i) => i.title === "/model")?.action).toEqual({ kind: "command", name: "global.pickModel", context: "global" });
    expect(items.find((i) => i.title === "/export")?.action).toEqual({ kind: "command", name: "conversation.export", context: "conversation" });
    expect(items.find((i) => i.title === "/exit")?.action).toEqual({ kind: "command", name: "global.detach", context: "global" });
  });
});

describe("typed acp-tui commands (task 10.3)", () => {
  const options = { configOptions: [select("model")], agentCommands: [] as string[] };

  test("Exit typed: exactly /exit, surrounding white space allowed, runs detach", () => {
    expect(typedSlashCommand("/exit", fullCatalogue(), options)?.command).toBe("global.detach");
    expect(typedSlashCommand("  /exit \n", fullCatalogue(), options)?.command).toBe("global.detach");
    expect(typedSlashCommand("/model", fullCatalogue(), options)?.command).toBe("global.pickModel");
  });

  test("Arguments are text: anything else after or around the name is sent", () => {
    for (const text of ["/model sonnet", "/exit now", "please /exit", "/exit/", "/EXIT", "/", "//exit", "/unknown"]) {
      expect(typedSlashCommand(text, fullCatalogue(), options)).toBeNull();
    }
  });

  test("Advertised name is sent: the agent's /help is not acp-tui's", () => {
    expect(typedSlashCommand("/help", fullCatalogue(), { ...options, agentCommands: ["help"] })).toBeNull();
    expect(typedSlashCommand("/help", fullCatalogue(), options)?.command).toBe("global.keyHelp");
  });

  test("an unavailable command is sent as text: /effort without a thinking level option", () => {
    expect(typedSlashCommand("/effort", fullCatalogue(), options)).toBeNull();
  });
});

describe("/add-dir (harness-feedback task 7.1; spec tui-palette \"Directory typed\")", () => {
  const options = { configOptions: [], agentCommands: [] as string[] };

  test("/add-dir with a path runs the command with that path; quotes round it are dropped; alone it is the plain command", () => {
    expect(typedAddDirectory("/add-dir ../lib", fullCatalogue(), options)).toBe("../lib");
    expect(typedAddDirectory("  /add-dir   ~/my docs  \n", fullCatalogue(), options)).toBe("~/my docs");
    expect(typedAddDirectory('/add-dir "../my lib"', fullCatalogue(), options)).toBe("../my lib");
    expect(typedAddDirectory("/add-dir", fullCatalogue(), options)).toBeNull();
    expect(typedAddDirectory("/add-dir ", fullCatalogue(), options)).toBeNull();
    expect(typedSlashCommand("/add-dir", fullCatalogue(), options)?.command).toBe("global.addDirectory");
    // The path is one line, and the name is exact.
    for (const text of ["/add-dir ../a\nmore", "/add-dirs ../a", "please /add-dir ../a", "/ADD-DIR ../a", "/add-dir\t"]) expect(typedAddDirectory(text, fullCatalogue(), options)).toBeNull();
    expect(typedSlashCommand("/add-dir ../lib", fullCatalogue(), options)).toBeNull();
  });

  test("The agent's name wins: an advertised add-dir command is sent as text", () => {
    expect(typedAddDirectory("/add-dir ../lib", fullCatalogue(), { ...options, agentCommands: ["add-dir"] })).toBeNull();
    expect(names(slashItems(fullCatalogue(), { ...options, agentCommands: ["add-dir"] }))).not.toContain("/add-dir");
  });

  test("The palette lists `Add a directory…` with the directory count as its value, and none when there are no directories", () => {
    const entry = (directories?: number) => paletteItems(fullCatalogue(), { configOptions: [], mouse: "full", permissionOptions: [], ...(directories === undefined ? {} : { directories }) }).find((i) => i.id === "global.addDirectory");
    expect(entry()?.title).toBe("Add a directory…");
    expect(entry()?.value ?? null).toBeNull();
    expect(entry(0)?.value ?? null).toBeNull();
    expect(entry(2)?.value).toBe("2");
    expect(entry(2)?.keys).toEqual([]);
  });
});

describe("completing a slash menu entry (slash-command-completion)", () => {
  test("an agent command completes to `/<name> ` with its input hint, and Enter completes it", () => {
    const [review, compact] = agentItems([
      { name: "review", description: "Review a pull request", inputHint: "PR number" },
      { name: "compact", description: "Compact the conversation", inputHint: null },
    ]);
    expect(completionOf(review!)).toEqual({ text: "/review ", hint: "PR number" });
    expect(completionOf(compact!)).toEqual({ text: "/compact ", hint: null });
    expect(enterCompletes(review!)).toBe(true);
    expect(enterCompletes(compact!)).toBe(true);
  });

  test("an acp-tui command completes to its slash name, never its title, with no hint; Enter completes only /add-dir", () => {
    const items = slashItems(fullCatalogue(), state({ configOptions: [select("model")] }));
    const byTitle = new Map(items.map((i) => [i.title, i]));
    expect(completionOf(byTitle.get("/model")!)).toEqual({ text: "/model ", hint: null });
    expect(completionOf(byTitle.get("/add-dir")!)).toEqual({ text: "/add-dir ", hint: null });
    expect(completionOf(byTitle.get("/exit")!)).toEqual({ text: "/exit ", hint: null });
    expect(items.filter(enterCompletes).map((i) => i.title)).toEqual(["/add-dir"]);
  });

  test("a palette entry is not a slash command", () => {
    const [entry] = paletteItems(fullCatalogue(), { configOptions: [], mouse: "full", permissionOptions: [] });
    expect(completionOf(entry!)).toBeNull();
    expect(enterCompletes(entry!)).toBe(false);
  });

  test("a completed command is still a typed command: `/exit ` and `/model ` match with the space left", () => {
    const catalogue = fullCatalogue();
    expect(typedSlashCommand("/exit ", catalogue, state())?.name).toBe("exit");
    expect(typedSlashCommand("/model \n", catalogue, state({ configOptions: [select("model")] }))?.name).toBe("model");
  });
});
