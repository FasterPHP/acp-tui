// Exit text (phase-1a task 4.3, design D3; mvp-sessions tasks 8.1 and 12.2,
// design decision 12; spec tui-screen "Exit text below the command line"):
// the resume line alone when the session can be resumed, nothing otherwise,
// `none`, sanitising and POSIX quoting. The PTY scenarios are in
// exit.pty.test.ts and test/session/resume-line.pty.test.ts.
import { describe, expect, test } from "bun:test";
import { exitText, resumeLine, shellQuote } from "../../src/renderer/exit-text.ts";

const session = { id: "sess-42" };
const reopenable = { canReopen: true, hadPromptOrOpened: true } as const;

describe("exit text: the resume line only", () => {
  test("Summary in the main screen: one line from the cursor, `\\r` first, `\\n` last, no escape sequences", () => {
    const text = exitText("summary", { ...reopenable, session });
    expect(text).toBe("\rresume: acp-tui --resume sess-42\n");
    expect(text).not.toContain("\x1b");
  });

  test("no summary line: no session ID line, title, agent or directory", () => {
    const text = exitText("summary", { ...reopenable, session: { id: "sess-42" } });
    expect(text).not.toContain("acp-tui: session");
    expect(text.split("\n")).toHaveLength(2);
  });

  test("Nothing without a prompt (or an open by load or resume)", () => {
    expect(exitText("summary", { ...reopenable, hadPromptOrOpened: false, session })).toBe("");
  });

  test("Nothing for an agent that cannot resume", () => {
    expect(exitText("summary", { ...reopenable, canReopen: false, session })).toBe("");
  });

  test("defaults: nothing (no resume line without the inputs for it)", () => {
    expect(resumeLine({ session })).toBeNull();
    expect(exitText("summary", { session })).toBe("");
  });

  test("no session ID (the agent never started): nothing", () => {
    expect(exitText("summary", { ...reopenable, session: null })).toBe("");
    expect(exitText("summary", { ...reopenable, session: { id: null } })).toBe("");
  });

  test("none prints nothing, even for a resumable session", () => {
    expect(exitText("none", { ...reopenable, session, adHocCommand: ["x"] })).toBe("");
  });

  test("ad hoc agent: the command repeated after `--`, plain words unquoted", () => {
    const text = exitText("summary", { ...reopenable, session, adHocCommand: ["bun", "packages/fake-agent/src/main.ts", "--scenario", "basic"], platform: "linux" });
    expect(text).toBe("\rresume: acp-tui --resume sess-42 -- bun packages/fake-agent/src/main.ts --scenario basic\n");
  });

  test("ad hoc agent: arguments with spaces, `$`, `'` and `;` are quoted for a POSIX shell", () => {
    const line = resumeLine({
      ...reopenable,
      session,
      platform: "linux",
      adHocCommand: ["my agent", "--flag=a b", "$HOME", "it's", "a;b", "plain", "", "x'y'z", "`id`", "a&&b", "~/x"],
    })!;
    expect(line).toBe(
      "resume: acp-tui --resume sess-42 -- 'my agent' '--flag=a b' '$HOME' 'it'\\''s' 'a;b' plain '' 'x'\\''y'\\''z' '`id`' 'a&&b' '~/x'",
    );
  });

  test("an ID that starts with `-` is given as --resume=<id>, so it is not read as an option", () => {
    expect(resumeLine({ ...reopenable, session: { id: "-x1" } })).toBe("resume: acp-tui --resume=-x1");
    expect(resumeLine({ ...reopenable, session: { id: "-a b" }, platform: "linux" })).toBe("resume: acp-tui --resume='-a b'");
    expect(resumeLine({ ...reopenable, session: { id: "-a b" }, platform: "win32" })).toBe("resume: acp-tui --resume='-a b'");
  });

  describe("quoted for PowerShell on Windows", () => {
    const windows = { ...reopenable, platform: "win32" } as const;

    test("scenario: an ad hoc harness with a space in its path", () => {
      const line = resumeLine({ ...windows, session, adHocCommand: ["C:\\Program Files\\agent\\agent.exe", "--acp"] });
      expect(line).toBe("resume: acp-tui --resume sess-42 -- 'C:\\Program Files\\agent\\agent.exe' --acp");
    });

    test("an argument with a single quote has it doubled", () => {
      const line = resumeLine({ ...windows, session, adHocCommand: ["agent.exe", "--title=it's", "x'y'z"] });
      expect(line).toBe("resume: acp-tui --resume sess-42 -- agent.exe '--title=it''s' 'x''y''z'");
    });

    test("plain words, drive paths and backslashes stay bare; PowerShell's own operators are quoted", () => {
      const line = resumeLine({
        ...windows,
        session,
        adHocCommand: ["bun", "C:\\x\\y.ts", "--n=1", "$HOME", "a;b", "a,b", "@list", "%PATH%", "(x)", "a&b", "`id`", "", 'say "hi"', "{x}", "#c", "~"],
      })!;
      expect(line).toBe(
        "resume: acp-tui --resume sess-42 -- bun C:\\x\\y.ts --n=1 '$HOME' 'a;b' 'a,b' '@list' '%PATH%' '(x)' 'a&b' '`id`' '' 'say \"hi\"' '{x}' '#c' '~'",
      );
    });

    test("the typographic single quotes PowerShell reads as quotes are doubled too", () => {
      expect(shellQuote("a\u2018b\u2019c", "win32")).toBe("'a\u2018\u2018b\u2019\u2019c'");
    });

    test("nothing in the line is POSIX-quoted, and POSIX quoting is unchanged elsewhere", () => {
      expect(shellQuote("it's", "win32")).toBe("'it''s'");
      expect(shellQuote("it's", "linux")).toBe("'it'\\''s'");
      expect(shellQuote("it's", "darwin")).toBe("'it'\\''s'");
      expect(shellQuote("a,b@c%d", "linux")).toBe("a,b@c%d");
    });

    test("an ID that starts with `-` still gives --resume=<id>", () => {
      expect(resumeLine({ ...windows, session: { id: "-x1" } })).toBe("resume: acp-tui --resume=-x1");
    });

    test("the exit text carries the PowerShell line", () => {
      const text = exitText("summary", { ...windows, session, adHocCommand: ["C:\\My Tools\\a.exe"] });
      expect(text).toBe("\rresume: acp-tui --resume sess-42 -- 'C:\\My Tools\\a.exe'\n");
    });
  });

  test("shellQuote round trips through sh", () => {
    for (const word of ["a b", "$HOME", "it's", "a;b", "$(echo hi)", "back\\slash", '"dq"', "*", "x=y", "a|b"]) {
      const out = Bun.spawnSync(["sh", "-c", `printf %s ${shellQuote(word, "linux")}`]).stdout.toString();
      expect(out).toBe(word);
    }
  });

  const withAnswer = (id: string | null) => ({
    id,
    order: ["a"],
    items: new Map([["a", { id: "a", kind: "agent_message", text: "The answer.", status: "final", origin: "self" }]]) as never,
  });

  test("the resume line comes first, then a blank line and any other exit text", () => {
    const text = exitText("last-answer", { ...reopenable, session: withAnswer("sess-42") });
    const lines = text.split("\n");
    expect(lines[0]).toBe("\rresume: acp-tui --resume sess-42");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("The answer.");
  });

  test("without a resume line, the other exit text starts at once", () => {
    const text = exitText("last-answer", { canReopen: false, hadPromptOrOpened: true, session: withAnswer("sess-42") });
    expect(text).toBe("\rThe answer.\n");
  });

  test("Hostile session ID: printable characters, quoted, no ESC or BEL", () => {
    const text = exitText("summary", { ...reopenable, session: { id: "id\x1b]52;c;aGVsbG8=\x07 1" } });
    expect(text).not.toContain("\x1b");
    expect(text).not.toContain("\x07");
    expect(text).toBe("\rresume: acp-tui --resume 'id 1'\n");
  });

  test("Hostile agent name: never printed (the line names no agent)", () => {
    // The input has no agent at all: nothing the agent names itself can reach the exit text.
    const text = exitText("summary", { ...reopenable, session: { id: "s" } });
    expect(text).toBe("\rresume: acp-tui --resume s\n");
  });

  test("hostile ad hoc arguments: sanitised, one line, no ESC", () => {
    const text = exitText("summary", { ...reopenable, session, adHocCommand: ["agent\x1b[2J", "a\nb", "c‮d"] });
    expect(text).not.toContain("\x1b");
    expect(text).not.toContain("‮");
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("-- agent 'a b' cd");
  });
});
