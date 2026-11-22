// auggie-1x-support, spec tui-agent-session "Reasons in agent errors": the reason in a JSON-RPC
// error's data, shown after its message.
import { describe, expect, test } from "bun:test";
import { agentErrorReason, agentErrorText } from "../../src/agent/errors.ts";

function rpc(message: string, data: unknown, code = -32603): Error {
  return Object.assign(new Error(message), { code, data });
}

describe("agentErrorText", () => {
  test("data.details: the first non-empty line follows the message, the advice does not", () => {
    const error = rpc("Internal error", { details: "\n  Unknown model probe  \n\nTry /model for the list" });
    expect(agentErrorText(error)).toBe("Internal error: Unknown model probe");
  });

  test("data.message and a string data", () => {
    expect(agentErrorText(rpc("Internal error", { message: "disk full" }))).toBe("Internal error: disk full");
    expect(agentErrorText(rpc("Internal error", "plain reason\nsecond"))).toBe("Internal error: plain reason");
  });

  test("details win over message", () => {
    expect(agentErrorText(rpc("Internal error", { details: "a", message: "b" }))).toBe("Internal error: a");
  });

  test("a reason equal to the message is not repeated", () => {
    expect(agentErrorText(rpc("Internal error", { details: "Internal error" }))).toBe("Internal error");
    expect(agentErrorText(rpc("Internal error", { details: " Internal error " }))).toBe("Internal error");
  });

  test("no usable data leaves the message", () => {
    expect(agentErrorText(rpc("Internal error", undefined))).toBe("Internal error");
    expect(agentErrorText(rpc("Internal error", null))).toBe("Internal error");
    expect(agentErrorText(rpc("Internal error", { details: 42 }))).toBe("Internal error");
    expect(agentErrorText(rpc("Internal error", { details: " \n\n " }))).toBe("Internal error");
    expect(agentErrorText(rpc("Internal error", 7))).toBe("Internal error");
  });

  test("not an Error: the string form", () => {
    expect(agentErrorText("boom")).toBe("boom");
    expect(agentErrorReason(undefined)).toBeNull();
  });

  test("a hostile, long reason: no escape sequence, at most 240 characters ending with an ellipsis", () => {
    const reason = `\u001b]52;c;ZXZpbA==\u0007${"x".repeat(2000)}`;
    const shown = agentErrorReason(rpc("Internal error", { details: reason }));
    expect(shown).not.toBeNull();
    expect(shown).not.toContain("\u001b");
    expect(shown).not.toContain("\u0007");
    expect(shown).not.toContain("52;c");
    expect(Array.from(shown as string).length).toBeLessThanOrEqual(240);
    expect(shown as string).toEndWith("…");
  });

  test("a reason of exactly 240 characters is kept whole", () => {
    expect(agentErrorReason(rpc("e", { details: "y".repeat(240) }))).toBe("y".repeat(240));
  });
});
