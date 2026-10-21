// Each bar module against session views with and without data (Phase 0 task
// 6.5; phase-1a task 6.2: `mouse`, `position`, and the armed states and
// elapsed time in `turn-state`).
import { describe, expect, test } from "bun:test";
// Unit tests import the .ts modules directly: `bun test` does not apply the
// root bunfig's Solid JSX preload, so the .tsx components stay out of them.
import { DEFAULT_HINTS, MODULES, formatCost, formatCount, formatElapsed, shortenHome, type ModuleId, type ModuleSettings } from "../../src/layout/modules.ts";
import { DEFAULT_LAYOUT, resolveLayout, type ResolvedBar } from "../../src/layout/layout.ts";
import { deriveSessionView, type SessionView } from "../../src/layout/view.ts";
import { createSession } from "acp-model";
import { hintsForKeyMap } from "../../src/keys/hints.ts";
import { loadKeyMap } from "../../src/keys/keymap.ts";
import { EMPTY_VIEW, FULL_VIEW, view } from "./fixtures.ts";

function run(id: ModuleId, v: SessionView, settings: ModuleSettings = {}) {
  const def = MODULES[id];
  return def.render(v, { ...def.defaults, ...settings });
}

function text(id: ModuleId, v: SessionView, settings: ModuleSettings = {}): string | null {
  const segments = run(id, v, settings);
  return segments ? segments.map((s) => s.text).join("") : null;
}

describe("agent", () => {
  test("shows the agent name", () => {
    expect(run("agent", FULL_VIEW)).toEqual([{ text: "Claude Code", token: "accent" }]);
  });
  test("format template with version", () => {
    expect(text("agent", FULL_VIEW, { format: "{agent} v{version}" })).toBe("Claude Code v0.81.2");
  });
  test("hidden without data", () => {
    expect(run("agent", EMPTY_VIEW)).toBeNull();
  });
  test("hideWhenEmpty false shows a placeholder", () => {
    expect(text("agent", EMPTY_VIEW, { hideWhenEmpty: false })).toBe("-");
  });
});

describe("model", () => {
  test("shows the model", () => {
    expect(text("model", FULL_VIEW)).toBe("sonnet-4.5");
  });
  test("hidden when the agent reported no model option", () => {
    expect(run("model", EMPTY_VIEW)).toBeNull();
  });
});

describe("model module follows the model pill (session-models)", () => {
  test("No current model: the status row says default", () => {
    const v = deriveSessionView({ ...createSession(), models: { currentModelId: "", availableModels: [{ modelId: "sonnet", name: "Claude Sonnet", description: null }] } });
    expect(text("model", v)).toBe("default");
  });

  test("Legacy model in the status row", () => {
    const v = deriveSessionView({ ...createSession(), models: { currentModelId: "sonnet", availableModels: [{ modelId: "sonnet", name: "Claude Sonnet", description: null }] } });
    expect(text("model", v)).toBe("Claude Sonnet");
  });
  test("No model at all: empty, and hidden where hide_when_empty is set", () => {
    const v = deriveSessionView(createSession());
    expect(run("model", v)).toBeNull();
    expect(text("model", v, { hideWhenEmpty: false })).toBe("-");
  });
});

describe("mode", () => {
  test("shows the mode with its default label", () => {
    expect(text("mode", FULL_VIEW)).toBe("mode:Accept Edits");
  });
  test("hidden without data, even though the format has literal text", () => {
    expect(run("mode", EMPTY_VIEW)).toBeNull();
  });
});

describe("cwd", () => {
  test("shortens the home directory to ~", () => {
    expect(run("cwd", FULL_VIEW)).toEqual([{ text: "~/Projects/acp-tui", token: "muted" }]);
    expect(shortenHome("/home/user", "/home/user")).toBe("~");
    expect(shortenHome("/home/userx/a", "/home/user")).toBe("/home/userx/a");
    expect(shortenHome("/srv/repo", null)).toBe("/srv/repo");
  });

  test("Windows: `~` for the profile with either separator and any case; the name is the last component", () => {
    const home = "C:\\Users\\u";
    expect(shortenHome("C:\\Users\\u\\src\\app", home, "win32")).toBe("~\\src\\app");
    expect(shortenHome("c:\\users\\U\\src", home, "win32")).toBe("~\\src");
    expect(shortenHome("C:/Users/u/src/app", home, "win32")).toBe("~/src/app");
    expect(shortenHome("C:\\Users\\u", `${home}\\`, "win32")).toBe("~");
    expect(shortenHome("C:\\Users\\u2\\src", home, "win32")).toBe("C:\\Users\\u2\\src");
    expect(shortenHome("D:\\Users\\u\\src", home, "win32")).toBe("D:\\Users\\u\\src");
    expect(shortenHome("C:\\x", "C:\\", "win32")).toBe("C:\\x");
    expect(shortenHome("C:\\x", null, "win32")).toBe("C:\\x");
    const win = view({ cwd: "C:\\Users\\u\\src\\app", home, platform: "win32" });
    expect(text("cwd", win)).toBe("~\\src\\app");
    expect(text("cwd", win, { format: "{basename}" })).toBe("app");
    expect(text("cwd", view({ cwd: "C:\\Users\\u\\src\\app\\", home, platform: "win32" }), { format: "{basename}" })).toBe("app");
    // Elsewhere a backslash is an ordinary character.
    expect(text("cwd", view({ cwd: "/home/u/a\\b", home: "/home/u", platform: "linux" }), { format: "{basename}" })).toBe("a\\b");
  });
  test("middle-truncates long paths to maxWidth", () => {
    const long = view({ cwd: "/home/user/Projects/some/deeply/nested/directory/structure/repo" });
    const out = text("cwd", long, { maxWidth: 24 })!;
    expect(Bun.stringWidth(out)).toBe(24);
    expect(out.startsWith("~/Projects/")).toBe(true);
    expect(out.endsWith("ure/repo")).toBe(true);
    expect(out).toContain("…");
  });
  test("hidden without data", () => {
    expect(run("cwd", EMPTY_VIEW)).toBeNull();
  });
});

describe("connection", () => {
  test("connected in the module token", () => {
    expect(run("connection", FULL_VIEW)).toEqual([{ text: "connected", token: "muted" }]);
  });
  test("disconnected in the danger token and never dropped", () => {
    const v = view({ connection: "disconnected" });
    expect(run("connection", v)).toEqual([{ text: "disconnected", token: "danger" }]);
    expect(MODULES.connection.neverDrop?.(v)).toBe(true);
    expect(MODULES.connection.neverDrop?.(FULL_VIEW)).toBe(false);
  });
  test("always has data", () => {
    expect(text("connection", EMPTY_VIEW)).toBe("connected");
  });
});

describe("turn-state", () => {
  test("each state reads its name in its own token", () => {
    expect(run("turn-state", FULL_VIEW)).toEqual([{ text: "idle", token: "muted" }]);
    expect(run("turn-state", view({ turnState: "running" }))).toEqual([{ text: "running", token: "tool.running" }]);
    expect(run("turn-state", view({ turnState: "requires_action" }))).toEqual([{ text: "requires_action", token: "permission" }]);
  });
  test("while a session is opened: loading N by load (the items so far), opening by resume (mvp-sessions task 6.2)", () => {
    expect(run("turn-state", view({ opening: "load", loaded: 1234 }))).toEqual([{ text: "loading 1234", token: "tool.running" }]);
    expect(run("turn-state", view({ opening: "load", loaded: 0 }))).toEqual([{ text: "loading 0", token: "tool.running" }]);
    expect(run("turn-state", view({ opening: "resume" }))).toEqual([{ text: "opening", token: "tool.running" }]);
    expect(run("turn-state", view({ opening: null, loaded: 1234 }))).toEqual([{ text: "idle", token: "muted" }]);
  });
  test("running shows the elapsed time", () => {
    const v = view({ turnState: "running", turnStartedAt: 1_000, now: 66_500 });
    expect(run("turn-state", v)).toEqual([{ text: "running 1m05s", token: "tool.running" }]);
    expect(text("turn-state", v, { format: "{state} ({elapsed})" })).toBe("running 1m05s (1m05s)");
    expect(formatElapsed(7_900)).toBe("7s");
    expect(formatElapsed(3_723_000)).toBe("1h02m");
    // requires_action keeps its name, so the state reads the same in every width.
    expect(text("turn-state", view({ turnState: "requires_action", turnStartedAt: 0, now: 5_000 }))).toBe("requires_action");
  });
  test("an armed two-press state replaces the state, names its key, in the warning token", () => {
    expect(run("turn-state", view({}, { armed: { kind: "detach", key: "ctrl+d" } }))).toEqual([{ text: "ctrl+d again to detach and stop the turn", token: "warning" }]);
    expect(text("turn-state", view({ turnState: "running" }, { armed: { kind: "detach", key: "ctrl+q" } }))).toBe(
      "ctrl+q again to detach and stop the turn",
    );
    expect(text("turn-state", view({ turnState: "running" }, { armed: { kind: "interrupt", key: "esc" } }))).toBe("esc again to interrupt");
  });
  test("never dropped while requires_action or armed", () => {
    expect(MODULES["turn-state"].neverDrop?.(view({ turnState: "requires_action" }))).toBe(true);
    expect(MODULES["turn-state"].neverDrop?.(view({ turnState: "running" }))).toBe(false);
    expect(MODULES["turn-state"].neverDrop?.(view({}, { armed: { kind: "detach", key: "ctrl+d" } }))).toBe(true);
  });
});

describe("mouse", () => {
  test("hidden while the effective policy is full", () => {
    expect(run("mouse", FULL_VIEW)).toBeNull();
  });
  test("names the policy otherwise", () => {
    expect(text("mouse", view({ mouse: "off" }))).toBe("mouse off");
    expect(text("mouse", view({ mouse: "wheel" }))).toBe("mouse: wheel");
    expect(text("mouse", view({ mouse: "off" }), { format: "[{policy}]" })).toBe("[off]");
  });
});

describe("position", () => {
  test("hidden while the conversation follows the bottom", () => {
    expect(run("position", FULL_VIEW)).toBeNull();
  });
  test("scrolled up: how far down the reader is, and rows below", () => {
    const v = view({ scroll: { following: false, percent: 62.4, below: 31, newBelow: 0 } });
    expect(text("position", v)).toBe("scrolled 62%");
    expect(text("position", v, { format: "{below} below" })).toBe("31 below");
  });
});

describe("density", () => {
  test("hidden while the density is the one the density setting names (focus by default), or not reported", () => {
    expect(run("density", FULL_VIEW)).toBeNull();
    expect(run("density", view({ density: "focus" }))).toBeNull();
    expect(run("density", view({ density: "compact", densitySetting: "compact" }))).toBeNull();
  });
  test("names the density otherwise, the name in the accent colour", () => {
    const v = view({ density: "compact" });
    expect(text("density", v)).toBe("density: compact");
    expect(run("density", v)!.find((s) => s.text === "compact")?.token).toBe("accent");
    expect(text("density", view({ density: "verbose" }), { format: "[{name}]" })).toBe("[verbose]");
    // The mark follows the setting (spec tui-conversation "Mark follows the setting").
    expect(text("density", view({ density: "focus", densitySetting: "compact" }))).toBe("density: focus");
  });
  test("the default layout places it in the status row", () => {
    const status = resolveLayout(DEFAULT_LAYOUT).regions.at(-1) as ResolvedBar;
    expect(status.right.map((m) => m.id)).toContain("density");
  });
});

describe("usage", () => {
  test("context used over size", () => {
    expect(text("usage", FULL_VIEW)).toBe("ctx 38k/200k");
    expect(text("usage", FULL_VIEW, { format: "{percent}" })).toBe("19%");
  });
  test("hidden without data", () => {
    expect(run("usage", EMPTY_VIEW)).toBeNull();
  });
  test("count formatting", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(1_500)).toBe("1.5k");
    expect(formatCount(38_400)).toBe("38k");
    expect(formatCount(1_200_000)).toBe("1.2M");
  });
});

describe("cost", () => {
  test("currency symbol for known currencies", () => {
    expect(text("cost", FULL_VIEW)).toBe("$0.41");
    expect(formatCost(1.5, "GBP")).toBe("£1.50");
    expect(formatCost(2, "CHF")).toBe("2.00 CHF");
  });
  test("hidden without data", () => {
    expect(run("cost", EMPTY_VIEW)).toBeNull();
  });
});

describe("hints", () => {
  test("empty prompt box (mvp-chrome-and-keys tasks 4.6 and 12.1): the agent's commands, the palette, the mode key and detach; no send or newline", () => {
    expect(text("hints", FULL_VIEW)).toBe("shift+tab mode  / commands  ? help  ctrl+d detach");
  });
  test("running turn: Esc Esc interrupt alone", () => {
    expect(text("hints", view({ turnState: "running" }))).toBe("esc esc interrupt");
  });
  test("no send or newline hint: a prompt box with a draft shows only the mode key (task 12.8: `/` and `?` are text there)", () => {
    expect(text("hints", view({}, { promptEmpty: false }))).toBe("shift+tab mode");
  });

  test("mode hint with a draft (task 12.8): the mode key stays while the prompt box holds a draft; the `/`, `?` and detach hints leave", () => {
    const empty = text("hints", view({}, { promptEmpty: true }));
    const draft = text("hints", view({}, { promptEmpty: false }));
    expect(empty).toContain("shift+tab mode");
    expect(draft).toContain("shift+tab mode");
    for (const gone of ["/ commands", "? help", "ctrl+d detach"]) expect(draft).not.toContain(gone);
    // Only while idle: a running turn shows the interrupt key alone.
    expect(text("hints", view({ turnState: "running" }, { promptEmpty: false }))).toBe("esc esc interrupt");
  });
  test("permission card focused", () => {
    const v = view({ turnState: "requires_action" }, { focus: "card", permissionOpen: true });
    expect(text("hints", v)).toBe("1-9 select  enter answer  tab prompt  esc esc interrupt");
  });
  test("permission open while the prompt box keeps focus", () => {
    const v = view({ turnState: "requires_action" }, { focus: "prompt", permissionOpen: true, promptEmpty: false });
    expect(text("hints", v)).toBe("tab tab permission  esc esc interrupt");
  });
  test("permission open with the conversation focused: the card is one Tab away", () => {
    const v = view({ turnState: "requires_action" }, { focus: "conversation", permissionOpen: true });
    expect(text("hints", v)).toBe("enter toggle  esc prompt  tab permission");
  });
  test("conversation focused with no card open: no card hint", () => {
    expect(text("hints", view({}, { focus: "conversation" }))).toBe("enter toggle  esc prompt");
  });
  test("the card hint follows a rebound focus key", () => {
    const hints = hintsForKeyMap(loadKeyMap({ global: { "ctrl+k": "toggleFocus", tab: "repaint" } }));
    const v = view({ turnState: "requires_action" }, { focus: "prompt", permissionOpen: true });
    expect(text("hints", v, { hints })).toContain("ctrl+k ctrl+k permission");
  });
  test("conversation focused: only its own keys, even while a turn runs (Esc returns to the prompt box)", () => {
    expect(text("hints", view({ turnState: "running" }, { focus: "conversation" }))).toBe("enter toggle  esc prompt");
  });
  test("hidden while a two-press state is armed (turn-state names the key)", () => {
    expect(run("hints", view({}, { armed: { kind: "detach", key: "ctrl+d" } }))).toBeNull();
  });
  test("keys in accent, labels in hint, cut points between hints", () => {
    const segments = run("hints", FULL_VIEW)!;
    expect(segments[0]).toEqual({ text: "shift+tab", token: "accent", breakBefore: false });
    expect(segments[1]).toEqual({ text: " mode", token: "hint" });
    expect(segments.filter((s) => s.breakBefore).length).toBe(3);
  });
  test("hint rules are data: a custom list replaces the defaults", () => {
    expect(text("hints", FULL_VIEW, { hints: [{ key: "f1", label: "help" }] })).toBe("f1 help");
    expect(text("hints", FULL_VIEW, { hints: [{ key: "f1", label: "help", when: { turn: "running" } }] })).toBeNull();
    expect(DEFAULT_HINTS.length).toBeGreaterThan(0);
  });
});

describe("text", () => {
  test("literal text in the module token", () => {
    expect(run("text", FULL_VIEW, { format: "acp-tui" })).toEqual([{ text: "acp-tui", token: "status.fg" }]);
    expect(run("text", EMPTY_VIEW, { format: "{{literal}}", token: "muted" })).toEqual([{ text: "{literal}", token: "muted" }]);
  });
  test("hidden when empty", () => {
    expect(run("text", FULL_VIEW)).toBeNull();
  });
});

// harness-feedback task group 6 (spec tui-layout "Additional directories module").
describe("dirs", () => {
  const withDirs = (additionalDirectories: readonly string[]) => view({ additionalDirectories });

  test("Two directories: +2 dirs; one directory: +1 dir; both in the muted token", () => {
    expect(run("dirs", withDirs(["/work/lib", "/work/docs"]))).toEqual([{ text: "+2 dirs", token: "muted" }]);
    expect(text("dirs", withDirs(["/work/lib"]))).toBe("+1 dir");
  });

  test("None: hidden, with or without the field", () => {
    expect(run("dirs", withDirs([]))).toBeNull();
    expect(run("dirs", EMPTY_VIEW)).toBeNull();
  });

  test("count and list fields serve a custom format; the list has ~ for home, comma-separated", () => {
    const v = view({ home: "/home/user", additionalDirectories: ["/home/user/shared", "/work/lib"] });
    expect(text("dirs", v, { format: "{count}: {list}" })).toBe("2: ~/shared, /work/lib");
  });

  test("The session's own record reaches the view", () => {
    const session = { ...createSession(), additionalDirectories: ["/work/lib"] };
    expect(deriveSessionView(session).additionalDirectories).toEqual(["/work/lib"]);
  });

  test("The default status row places it after cwd, with a lower priority than cwd", () => {
    const status = resolveLayout(DEFAULT_LAYOUT).regions.find((r): r is ResolvedBar => r.kind === "bar")!;
    const ids = status.left.map((m) => m.id);
    expect(ids.indexOf("dirs")).toBe(ids.indexOf("cwd") + 1);
    expect(MODULES.dirs.defaults.priority).toBeLessThan(MODULES.cwd.defaults.priority);
  });
});
