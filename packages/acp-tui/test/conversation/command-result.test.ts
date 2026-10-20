// day-one-feedback task 4.1 (design D2, spec tui-rendering "Command results recognised"): the
// recogniser over fake-agent's `command-results` texts, the near misses and the edges.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { commandResult, resultOutputLines, resultProjectionLines } from "../../src/conversation/command-result.ts";

// Imported by a computed path: acp-tui does not depend on the fake-agent package.
const FAKE_AGENT = join(import.meta.dir, "../../../fake-agent/src");
const CR = (await import(join(FAKE_AGENT, "scenarios/command-results.ts"))) as {
  COMMAND_RESULTS_IDS: Record<"auggieFailure" | "auggieSuccess" | "claudeFailure" | "claudeSuccess" | "nearMissEnvelope" | "nearMissRead", string>;
  COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE: string;
  COMMAND_RESULTS_AUGGIE_SUCCESS_ENVELOPE: string;
  COMMAND_RESULTS_CLAUDE_FAILURE_BODY: string;
  COMMAND_RESULTS_NEAR_MISS_ENVELOPE: string;
  COMMAND_RESULTS_NEAR_MISS_READ_BODY: string;
  auggieEnvelope(code: number, output: string): string;
  commandResultsTexts(): Record<string, string>;
};
const texts = CR.commandResultsTexts();
const fence = (body: string, info = "") => `\`\`\`${info}\n${body}\n\`\`\``;

describe("commandResult (task 4.1)", () => {
  test("Auggie failure recognised: the fence is unwrapped, the output trimmed, the code read", () => {
    const result = commandResult(texts[CR.COMMAND_RESULTS_IDS.auggieFailure]!, "execute", "failed");
    expect(result).toEqual({ output: "sh: model-selection: command not found", code: 127 });
  });

  test("Auggie success: the bare envelope (rawOutput) is recognised without a fence, for any kind and status", () => {
    expect(commandResult(CR.COMMAND_RESULTS_AUGGIE_SUCCESS_ENVELOPE, "execute", "completed")).toEqual({
      output: "architecture.md\nconfiguration.md\ninstall-macos.md",
      code: 0,
    });
    for (const kind of ["read", "other", null, undefined] as const) {
      for (const status of ["pending", "in_progress", "completed", "failed", null, undefined] as const) {
        expect(commandResult(CR.auggieEnvelope(2, "x\n"), kind, status)).toEqual({ output: "x", code: 2 });
      }
    }
  });

  test("Claude failure recognised: Exit code and its output lines", () => {
    const result = commandResult(texts[CR.COMMAND_RESULTS_IDS.claudeFailure]!, "execute", "failed");
    expect(result).toEqual({ output: "/bin/bash: line 1: frobnicate: command not found", code: 127 });
    expect(commandResult(fence("Exit code 2\nls: cannot access 'x'\nls: cannot access 'y'"), "execute", "failed")).toEqual({
      output: "ls: cannot access 'x'\nls: cannot access 'y'",
      code: 2,
    });
  });

  test("Claude failure with no output: the output is empty", () => {
    expect(commandResult(fence("Exit code 1"), "execute", "failed")).toEqual({ output: "", code: 1 });
  });

  test("Near misses stay raw: an extra line before the envelope, an Exit code fence on a read call", () => {
    expect(commandResult(texts[CR.COMMAND_RESULTS_IDS.nearMissEnvelope]!, "execute", "completed")).toBeNull();
    expect(commandResult(CR.COMMAND_RESULTS_NEAR_MISS_ENVELOPE, "execute", "failed")).toBeNull();
    expect(commandResult(texts[CR.COMMAND_RESULTS_IDS.nearMissRead]!, "read", "failed")).toBeNull();
  });

  test("the Exit code form is gated: kind execute, status failed and a fence without an info string", () => {
    const body = "Exit code 3\nboom";
    expect(commandResult(fence(body), "execute", "failed")).not.toBeNull();
    expect(commandResult(fence(body), "execute", "completed")).toBeNull();
    expect(commandResult(fence(body), "execute", "in_progress")).toBeNull();
    expect(commandResult(fence(body), "other", "failed")).toBeNull();
    expect(commandResult(fence(body), null, "failed")).toBeNull();
    // Not in a fence: ordinary text.
    expect(commandResult(body, "execute", "failed")).toBeNull();
    // A fence with an info string is code.
    expect(commandResult(fence(body, "console"), "execute", "failed")).toBeNull();
    // Only the first line is the code; `Exit code` later is output.
    expect(commandResult(fence("some output\nExit code 3"), "execute", "failed")).toBeNull();
    // The code must be the whole first line.
    expect(commandResult(fence("Exit code 3 (killed)\nboom"), "execute", "failed")).toBeNull();
    expect(commandResult(fence("Exit code -1\nboom"), "execute", "failed")).toBeNull();
  });

  test("a fence with an info string around the Auggie envelope is code, not a result", () => {
    expect(commandResult(fence(CR.COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE, "console"), "execute", "failed")).toBeNull();
  });

  test("anything else around the Auggie envelope is not a result", () => {
    const envelope = CR.COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE;
    expect(commandResult(`${envelope}\nand more`, "execute", "failed")).toBeNull();
    expect(commandResult(`${envelope}\n`, "execute", "failed")).not.toBeNull();
    expect(commandResult(`${envelope}\n\n`, "execute", "failed")).toBeNull();
    expect(commandResult(envelope.replace("<return-code>\n127", "<return-code>\nabc"), "execute", "failed")).toBeNull();
    expect(commandResult(envelope.replace("executing the command.", "executing the command"), "execute", "failed")).toBeNull();
    expect(commandResult(envelope.replace("</output>", ""), "execute", "failed")).toBeNull();
    expect(commandResult("", "execute", "failed")).toBeNull();
    expect(commandResult("plain text", "execute", "completed")).toBeNull();
  });

  test("output containing </output> stays whole (the last closing tag ends it)", () => {
    const output = "before\n</output>\nafter </output> tail\n";
    expect(commandResult(CR.auggieEnvelope(0, output), "execute", "completed")).toEqual({ output: "before\n</output>\nafter </output> tail", code: 0 });
  });

  test("an empty output: the envelope with only the process's newline, or none", () => {
    expect(commandResult(CR.auggieEnvelope(0, ""), "execute", "completed")).toEqual({ output: "", code: 0 });
    expect(commandResult(CR.auggieEnvelope(0, "\n"), "execute", "completed")).toEqual({ output: "", code: 0 });
    expect(commandResult(CR.auggieEnvelope(0, "\n\n  \n"), "execute", "completed")).toEqual({ output: "", code: 0 });
  });

  test("the output loses leading blank lines and trailing whitespace, not the first line's indentation or inner blank lines", () => {
    expect(commandResult(CR.auggieEnvelope(1, "\n  \n    indented\n\nsecond   \n\n"), "execute", "failed")).toEqual({
      output: "    indented\n\nsecond",
      code: 1,
    });
  });

  test("CRLF line ends are read as line feeds, in the envelope and in a fence", () => {
    const crlf = CR.auggieEnvelope(5, "one\ntwo\n").replace(/\n/g, "\r\n");
    expect(commandResult(crlf, "execute", "failed")).toEqual({ output: "one\ntwo", code: 5 });
    expect(commandResult(fence(crlf), "execute", "failed")).toEqual({ output: "one\ntwo", code: 5 });
    expect(commandResult(fence("Exit code 4\r\nboom\r\n"), "execute", "failed")).toEqual({ output: "boom", code: 4 });
  });

  test("a negative return code is read (Auggie reports signals so)", () => {
    expect(commandResult(CR.auggieEnvelope(-1, "killed\n"), "execute", "failed")).toEqual({ output: "killed", code: -1 });
  });

  test("hostile output passes through unchanged: the text is already sanitised and nothing is added or removed", () => {
    const output = "ok \u202eexe.dangerous\u202c file [31mred[0m <return-code> \u200b";
    expect(commandResult(CR.auggieEnvelope(0, `${output}\n`), "execute", "completed")?.output).toBe(output);
  });

  test("the claude success (a console fence) and ordinary fences are not results", () => {
    expect(commandResult(texts[CR.COMMAND_RESULTS_IDS.claudeSuccess]!, "execute", "completed")).toBeNull();
    expect(commandResult(fence("just text"), "execute", "failed")).toBeNull();
  });
});

describe("result lines as drawn and projected (task 4.1)", () => {
  test("one output line: `Output: <line>` then `Return code: <code>`", () => {
    expect(resultProjectionLines({ output: "sh: x: not found", code: 127 })).toEqual({ output: ["Output: sh: x: not found"], code: "Return code: 127" });
  });

  test("several lines: `Output:` and each line indented two cells, blank lines empty", () => {
    expect(resultProjectionLines({ output: "a\n\n  b", code: 2 })).toEqual({ output: ["Output:", "  a", "", "    b"], code: "Return code: 2" });
  });

  test("an empty output: the return code alone", () => {
    expect(resultProjectionLines({ output: "", code: 0 })).toEqual({ output: [], code: "Return code: 0" });
  });

  test("tabs expand to stops every 8 columns and trailing spaces go", () => {
    expect(resultOutputLines("a\tb  \nxx\tyy")).toEqual(["a       b", "xx      yy"]);
  });
});
