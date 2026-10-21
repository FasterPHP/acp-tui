// mvp-chrome-and-keys task 7.1 and day-one-feedback tasks 9.2 and 9.3 (spec tui-screen "Terminal
// title"): the title text, the format and the instance counter, and the installer, without a
// terminal. The PTY tests are in terminal-signals.pty.test.ts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, type Session } from "acp-model";
import { displayWidth } from "../../src/layout/segments.ts";
import { installTerminalTitle, TITLE_COLUMNS, TITLE_MARKER, TITLE_POP, TITLE_PUSH, terminalTitle, titleOf, titlePart } from "../../src/renderer/title.ts";
import { createTitleSlots } from "../../src/renderer/title-slot.ts";

const base = { title: null, agent: null, cwd: null, waiting: false };
/** The format that brings the agent's title back. */
const WITH_TITLE = "{dir}{counter} · {title}";

describe("terminalTitle", () => {
  test("Directory name by default: the session directory's last component, whatever the agent reports", () => {
    expect(terminalTitle({ ...base, cwd: "/work/acp-tui" })).toBe("acp-tui");
    expect(terminalTitle({ ...base, cwd: "/work/acp-tui", agent: "Auggie", title: "Pool reuse" })).toBe("acp-tui");
    expect(terminalTitle({ ...base, cwd: "/work/acp-tui/" })).toBe("acp-tui");
  });

  test("Title follows the session: with the title in the format it appears once the agent reports it", () => {
    expect(terminalTitle({ ...base, cwd: "/work/acp-tui", format: WITH_TITLE })).toBe("acp-tui");
    expect(terminalTitle({ ...base, cwd: "/work/acp-tui", title: "Pool reuse", format: WITH_TITLE })).toBe("acp-tui · Pool reuse");
  });

  test("the old titles as formats", () => {
    expect(terminalTitle({ ...base, title: "Pool reuse", cwd: "/work/repo", format: "acp-tui | {title}" })).toBe("acp-tui | Pool reuse");
    expect(terminalTitle({ ...base, agent: "Claude Code", cwd: "/home/user/Projects/acp-tui", format: "acp-tui | {agent} | {dir}" })).toBe("acp-tui | Claude Code | acp-tui");
  });

  test("a format that leaves nothing falls back to the directory, then to acp-tui", () => {
    expect(terminalTitle({ ...base, cwd: "/work/repo", format: "acp-tui | {title}" })).toBe("repo");
    expect(terminalTitle({ ...base, format: "{title}" })).toBe("acp-tui");
    expect(terminalTitle(base)).toBe("acp-tui");
  });

  test("Second instance in the same directory: the counter follows the name from the second instance on", () => {
    expect(terminalTitle({ ...base, cwd: "/work/acp-tui", instance: 1 })).toBe("acp-tui");
    expect(terminalTitle({ ...base, cwd: "/work/acp-tui", instance: 2 })).toBe("acp-tui 2");
    expect(terminalTitle({ ...base, cwd: "/work/acp-tui", instance: 3, title: "x", format: WITH_TITLE })).toBe("acp-tui 3 · x");
  });

  test("Waiting for the user: the marker leads while the session waits", () => {
    expect(terminalTitle({ ...base, cwd: "/work/acp-tui", waiting: true })).toBe(`${TITLE_MARKER} acp-tui`);
    expect(terminalTitle({ ...base, title: "Pool reuse", format: "{title}", waiting: true })).toBe(`${TITLE_MARKER} Pool reuse`);
  });

  test("cut to 60 columns, the marker kept", () => {
    const long = "x".repeat(200);
    const plain = terminalTitle({ ...base, title: long, format: "{title}" });
    const waiting = terminalTitle({ ...base, title: long, format: "{title}", waiting: true });
    expect(displayWidth(plain)).toBe(TITLE_COLUMNS);
    expect(displayWidth(waiting)).toBe(TITLE_COLUMNS);
    expect(plain.endsWith("…")).toBe(true);
    expect(waiting.startsWith(`${TITLE_MARKER} `)).toBe(true);
    // Wide characters count as two columns.
    expect(displayWidth(terminalTitle({ ...base, title: "漢字".repeat(60), format: "{title}" }))).toBeLessThanOrEqual(TITLE_COLUMNS);
  });

  test("Hostile title: BEL, an OSC 52 sequence, ESC, C1 and line breaks leave printable text on one line", () => {
    const hostile = "Pool\x07 reuse\x1b]52;c;ZXZpbA==\x07 more\nline\r\nthree\u2028four\x1b\\ \x9d52;c;ZXZpbA==\x07 end\ttab";
    const text = terminalTitle({ ...base, title: hostile, format: "{title}" });
    expect(text).not.toMatch(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/);
    expect(text).not.toContain("52;c");
    expect(text.startsWith("Pool")).toBe(true);
    // Agent and directory names get the same treatment, and so does literal text in the format.
    const named = terminalTitle({ ...base, agent: "ev\x07il\x1b]0;x\x07", cwd: "/work/re\npo\x1b", format: "{dir} {agent}" });
    expect(named).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(terminalTitle({ ...base, title: "t", format: "\x1b]0;evil\x07{title}" })).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  });

  test("a title with nothing printable left is empty, so the format drops its literal text", () => {
    expect(titlePart("\x07\x1b]52;c;x\x07")).toBe("");
    expect(terminalTitle({ ...base, cwd: "/work/repo", title: "\x07", format: WITH_TITLE })).toBe("repo");
  });
});

describe("titleOf", () => {
  const session = (patch: Partial<Session>): Session => ({ ...createSession(), ...patch });

  test("reads the model: directory, title (when the format has it), agent (display title first) and requires_action", () => {
    const agent = { name: "claude-agent-acp", title: "Claude Code", version: null };
    expect(titleOf(session({ agent, cwd: "/work/repo" }))).toBe("repo");
    expect(titleOf(session({ agent, cwd: "/work/repo", title: "Pool reuse" }), WITH_TITLE)).toBe("repo · Pool reuse");
    expect(titleOf(session({ agent, cwd: "/work/repo" }), "{agent}")).toBe("Claude Code");
    expect(titleOf(session({ cwd: "/work/repo", state: "requires_action" }))).toBe(`${TITLE_MARKER} repo`);
    expect(titleOf(session({ cwd: "/work/repo", state: "running" }))).toBe("repo");
    expect(titleOf(session({ cwd: "/work/repo" }), undefined, 2)).toBe("repo 2");
  });
});

describe("installTerminalTitle", () => {
  function fixture(options: Parameters<typeof installTerminalTitle>[3] = {}, cwd: string | null = "/work/acp-tui") {
    let current: Session = { ...createSession(), cwd };
    const listeners = new Set<(change: { session: Session }) => void>();
    const written: string[] = [];
    const titles: string[] = [];
    const renderer = { isDestroyed: false, setTerminalTitle: (t: string) => void titles.push(t) };
    const feed = {
      snapshot: () => current,
      onChange(listener: (change: { session: Session }) => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
    const update = (patch: Partial<Session>) => {
      current = { ...current, ...patch };
      for (const l of listeners) l({ session: current });
    };
    const handle = installTerminalTitle(renderer, feed, (data) => void written.push(data), options);
    return { written, titles, update, handle, renderer, listeners };
  }

  test("pushes the title stack, sets the title, and sets it again only when it changes", () => {
    const f = fixture({ format: () => WITH_TITLE });
    expect(f.written).toEqual([TITLE_PUSH]);
    expect(f.titles).toEqual(["acp-tui"]);
    f.update({ title: "Pool reuse" });
    f.update({ title: "Pool reuse", updatedAt: "x" });
    f.update({ state: "requires_action" });
    f.update({ state: "running" });
    expect(f.titles).toEqual(["acp-tui", "acp-tui · Pool reuse", `${TITLE_MARKER} acp-tui · Pool reuse`, "acp-tui · Pool reuse"]);
  });

  test("reassert writes the current title again, though it has not changed, from the session as it is now", () => {
    const f = fixture({ format: () => WITH_TITLE });
    f.update({ title: "Pool reuse" });
    f.handle.reassert();
    f.handle.reassert();
    expect(f.titles).toEqual(["acp-tui", "acp-tui · Pool reuse", "acp-tui · Pool reuse", "acp-tui · Pool reuse"]);
    // Only the title is written again: the stack is pushed once.
    expect(f.written).toEqual([TITLE_PUSH]);
    // A later change still sets it once, as before.
    f.update({ title: "Pool reuse", updatedAt: "x" });
    expect(f.titles).toHaveLength(4);
  });

  test("current is the title last set, and empty after restore", () => {
    const f = fixture({ format: () => WITH_TITLE });
    expect(f.handle.current()).toBe("acp-tui");
    f.update({ state: "requires_action" });
    expect(f.handle.current()).toBe(`${TITLE_MARKER} acp-tui`);
    f.handle.restore();
    expect(f.handle.current()).toBe("");
  });

  test("reassert after restore writes nothing", () => {
    const f = fixture();
    f.handle.restore();
    f.handle.reassert();
    expect(f.titles).toEqual(["acp-tui"]);
  });

  test("with the default format the agent's title changes nothing", () => {
    const f = fixture();
    f.update({ title: "Pool reuse" });
    f.update({ title: "Another" });
    expect(f.titles).toEqual(["acp-tui"]);
  });

  test("restore pops the stack once and stops following", () => {
    const f = fixture();
    expect(f.handle.restore()).toBe(TITLE_POP);
    expect(f.listeners.size).toBe(0);
    f.update({ cwd: "/work/other" });
    expect(f.titles).toEqual(["acp-tui"]);
  });

  test("sets nothing once the renderer is destroyed", () => {
    const f = fixture();
    f.renderer.isDestroyed = true;
    f.update({ cwd: "/work/other" });
    expect(f.titles).toEqual(["acp-tui"]);
  });

  test("refresh sets the title again under a changed format", () => {
    let format = "{dir}{counter}";
    const f = fixture({ format: () => format });
    f.update({ title: "Pool reuse" });
    format = WITH_TITLE;
    f.handle.refresh();
    expect(f.titles).toEqual(["acp-tui", "acp-tui · Pool reuse"]);
  });

  describe("instance counter (task 9.2)", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-title-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));
    const running = new Set<number>();
    const slots = (pid: number) => {
      running.add(pid);
      return createTitleSlots({ dir, pid, alive: (p) => running.has(p) });
    };

    test("Second instance in the same directory: acp-tui, acp-tui 2 for its whole run, then a third that takes the free number", () => {
      const first = fixture({ slots: slots(1) });
      const second = fixture({ slots: slots(2) });
      expect(first.titles).toEqual(["acp-tui"]);
      expect(second.titles).toEqual(["acp-tui 2"]);
      // The first exits; the second keeps its number, and a third starts with the free one.
      first.handle.restore();
      second.update({ title: "x" });
      expect(second.titles).toEqual(["acp-tui 2"]);
      const third = fixture({ slots: slots(3) });
      expect(third.titles).toEqual(["acp-tui"]);
    });

    test("Stale slot reclaimed: an instance killed with SIGKILL leaves a slot the next start takes over", () => {
      fixture({ slots: slots(10) });
      running.delete(10);
      expect(fixture({ slots: slots(11) }).titles).toEqual(["acp-tui"]);
    });

    test("a session switch to another directory name moves the instance to that name's slots", () => {
      const a = fixture({ slots: slots(20) });
      const b = fixture({ slots: slots(21) }, "/work/other");
      expect(b.titles).toEqual(["other"]);
      // a moves to the directory b is in: it is the second one there.
      a.update({ cwd: "/work/other" });
      expect(a.titles).toEqual(["acp-tui", "other 2"]);
      // and back: the name `acp-tui` has no other instance.
      a.update({ cwd: "/work/acp-tui" });
      expect(a.titles.at(-1)).toBe("acp-tui");
    });

    test("a format without {counter} takes no slot", () => {
      const first = fixture({ slots: slots(30), format: () => "{agent}" });
      first.update({ agent: { name: "Auggie", title: null, version: null } });
      const second = fixture({ slots: slots(31) });
      expect(second.titles).toEqual(["acp-tui"]);
    });

    test("restore releases the slot", () => {
      const first = fixture({ slots: slots(40) });
      first.handle.restore();
      expect(fixture({ slots: slots(41) }).titles).toEqual(["acp-tui"]);
    });
  });
});
