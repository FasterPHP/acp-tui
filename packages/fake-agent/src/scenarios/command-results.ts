// The "command-results" scenario (day-one-feedback task 2.1, design D12): the shapes in which
// agents report the result of a shell command, so acp-tui's command-result recogniser and its
// card can be exercised end to end. One turn, six `execute`-or-`read` calls, each started
// `in_progress` and then finished:
//
// 1. Auggie 0.36.0's failure: a text block that is a bare fence around its `launch-process`
//    envelope (return code 127, one output line, and the blank line the process's trailing
//    newline leaves before `</output>`), plus `rawOutput: { output: <envelope> }`;
// 2. Auggie's success: no content at all, only `rawOutput` with the envelope (return code 0,
//    three output lines);
// 3. `claude-agent-acp` 0.81.2's failure: a bare fence holding `Exit code 127` and the output;
// 4. its success: the output as a `console` fence, with no exit code;
// 5. a near miss: Auggie's envelope with one more line of text before it, which must stay raw;
// 6. a near miss: an `Exit code 1` fence on a `read` call, which must stay raw.
//
// The envelope texts are pinned to Auggie 0.36.0 (`augment.mjs`, `launch-process`); recheck them
// at each Auggie upgrade (design 5.6 of the technical design). No permission request is made.
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const COMMAND_RESULTS_IDS = {
  auggieFailure: "command-results-auggie-failure",
  auggieSuccess: "command-results-auggie-success",
  claudeFailure: "command-results-claude-failure",
  claudeSuccess: "command-results-claude-success",
  nearMissEnvelope: "command-results-near-miss-envelope",
  nearMissRead: "command-results-near-miss-read",
} as const;

export const COMMAND_RESULTS_TITLES = {
  auggieFailure: "model-selection --list",
  auggieSuccess: "ls docs",
  claudeFailure: "frobnicate --now",
  claudeSuccess: "git status --short",
  nearMissEnvelope: "echo envelope",
  nearMissRead: "Read missing.txt",
} as const;

/** The first line of Auggie's `launch-process` result. */
export const COMMAND_RESULTS_ENVELOPE_HEAD = "Here are the results from executing the command.";

/** Auggie's envelope around `output`, exactly as 0.36.0 builds it. */
export function auggieEnvelope(code: number, output: string): string {
  return `${COMMAND_RESULTS_ENVELOPE_HEAD}\n<return-code>\n${code}\n</return-code>\n<output>\n${output}\n</output>`;
}

/** The process output of the failing Auggie command: one line, with the trailing newline. */
export const COMMAND_RESULTS_AUGGIE_FAILURE_OUTPUT = "sh: model-selection: command not found\n";
export const COMMAND_RESULTS_AUGGIE_SUCCESS_OUTPUT = "architecture.md\nconfiguration.md\ninstall-macos.md\n";

/** Auggie's failing envelope (return code 127), as `rawOutput.output` and inside the fence. */
export const COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE = auggieEnvelope(127, COMMAND_RESULTS_AUGGIE_FAILURE_OUTPUT);
/** Auggie's successful envelope (return code 0, three output lines), only as `rawOutput.output`. */
export const COMMAND_RESULTS_AUGGIE_SUCCESS_ENVELOPE = auggieEnvelope(0, COMMAND_RESULTS_AUGGIE_SUCCESS_OUTPUT);

/** The body of `claude-agent-acp`'s failure fence: Claude Code's `Exit code <n>` then the output. */
export const COMMAND_RESULTS_CLAUDE_FAILURE_BODY = "Exit code 127\n/bin/bash: line 1: frobnicate: command not found";
export const COMMAND_RESULTS_CLAUDE_SUCCESS_LINES: readonly string[] = [" M docs/configuration.md", "?? notes.txt"];
/** Auggie's envelope with one more line of text before it: not a command result. */
export const COMMAND_RESULTS_NEAR_MISS_ENVELOPE = `Note: the command was retried once.\n${COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE}`;
/** A fence starting `Exit code 1` on a `read` call: not a command result. */
export const COMMAND_RESULTS_NEAR_MISS_READ_BODY = "Exit code 1\nENOENT: no such file or directory";

function fence(label: string, body: string): string {
  return `\`\`\`${label}\n${body}\n\`\`\``;
}

/** The text block of each call that has one, by tool call ID (the Auggie success has none). */
export function commandResultsTexts(): Readonly<Record<string, string>> {
  return {
    [COMMAND_RESULTS_IDS.auggieFailure]: fence("", COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE),
    [COMMAND_RESULTS_IDS.claudeFailure]: fence("", COMMAND_RESULTS_CLAUDE_FAILURE_BODY),
    [COMMAND_RESULTS_IDS.claudeSuccess]: fence("console", COMMAND_RESULTS_CLAUDE_SUCCESS_LINES.join("\n")),
    [COMMAND_RESULTS_IDS.nearMissEnvelope]: fence("", COMMAND_RESULTS_NEAR_MISS_ENVELOPE),
    [COMMAND_RESULTS_IDS.nearMissRead]: fence("", COMMAND_RESULTS_NEAR_MISS_READ_BODY),
  };
}

/** The `rawOutput` of each call that sends one, by tool call ID. */
export function commandResultsRawOutputs(): Readonly<Record<string, { readonly output: string }>> {
  return {
    [COMMAND_RESULTS_IDS.auggieFailure]: { output: COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE },
    [COMMAND_RESULTS_IDS.auggieSuccess]: { output: COMMAND_RESULTS_AUGGIE_SUCCESS_ENVELOPE },
  };
}

export const commandResultsScenario: Scenario = {
  name: "command-results",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    const texts = commandResultsTexts();
    const rawOutputs = commandResultsRawOutputs();
    const calls = [
      { id: COMMAND_RESULTS_IDS.auggieFailure, title: COMMAND_RESULTS_TITLES.auggieFailure, kind: "execute", status: "failed" },
      { id: COMMAND_RESULTS_IDS.auggieSuccess, title: COMMAND_RESULTS_TITLES.auggieSuccess, kind: "execute", status: "completed" },
      { id: COMMAND_RESULTS_IDS.claudeFailure, title: COMMAND_RESULTS_TITLES.claudeFailure, kind: "execute", status: "failed" },
      { id: COMMAND_RESULTS_IDS.claudeSuccess, title: COMMAND_RESULTS_TITLES.claudeSuccess, kind: "execute", status: "completed" },
      { id: COMMAND_RESULTS_IDS.nearMissEnvelope, title: COMMAND_RESULTS_TITLES.nearMissEnvelope, kind: "execute", status: "completed" },
      { id: COMMAND_RESULTS_IDS.nearMissRead, title: COMMAND_RESULTS_TITLES.nearMissRead, kind: "read", status: "failed" },
    ] as const;

    for (const call of calls) {
      if (ctx.cancelled.aborted) return { stopReason: "cancelled" };
      await ctx.send({
        sessionUpdate: "tool_call",
        toolCallId: call.id,
        title: call.title,
        kind: call.kind,
        status: "in_progress",
      });
      const text = texts[call.id];
      const rawOutput = rawOutputs[call.id];
      await ctx.send({
        sessionUpdate: "tool_call_update",
        toolCallId: call.id,
        status: call.status,
        ...(text === undefined ? {} : { content: [{ type: "content", content: { type: "text", text } }] }),
        ...(rawOutput === undefined ? {} : { rawOutput }),
      });
    }
    return { stopReason: "end_turn" };
  },
};
