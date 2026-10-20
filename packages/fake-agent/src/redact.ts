// Strips prompt text before logging session/prompt params, per the
// fake-agent log contract in AGENTS.md: every received method is logged
// minus any prompt text, so the log is safe to inspect without leaking
// whatever a test happened to prompt with.
import type { PromptRequest } from "@agentclientprotocol/sdk";

export function redactPromptParams(request: PromptRequest): unknown {
  return {
    sessionId: request.sessionId,
    promptBlockCount: request.prompt.length,
  };
}
