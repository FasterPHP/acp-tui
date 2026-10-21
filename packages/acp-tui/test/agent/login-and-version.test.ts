// colleague-preview: the login message (spec tui-agent-session "Harness needs a login") and the
// notice for an unchecked Auggie ("Harness version not yet checked"), as pure rules.
import { describe, expect, test } from "bun:test";
import { RequestError } from "@agentclientprotocol/sdk";
import { AUGGIE_LOGIN_STEP, isAuthRequired, loginMessage } from "../../src/agent/login.ts";
import { majorAtLeastOne, uncheckedAuggieNotice } from "../../src/agent/harness-version.ts";

const AUGGIE_TEXT = "Authentication required: Auggie does not currently support authenticating over ACP. Please run `auggie login` from your terminal then try again.";

describe("login message", () => {
  test("only -32000 is an authentication-required answer", () => {
    expect(isAuthRequired(new RequestError(-32000, "x"))).toBe(true);
    expect(isAuthRequired(new RequestError(-32603, "x"))).toBe(false);
    expect(isAuthRequired(new Error("x"))).toBe(false);
    expect(isAuthRequired(null)).toBe(false);
  });

  test("names the harness and keeps the harness's text; the built-in adds nothing when the text names auggie login", () => {
    const message = loginMessage(new RequestError(-32000, AUGGIE_TEXT), { harness: "auggie", loginHint: "auggie login" });
    expect(message).toBe(`harness 'auggie' needs you to log in: ${AUGGIE_TEXT}`);
  });

  test("Login hint added: the built-in auggie with the bare message gets the login step", () => {
    const message = loginMessage(new RequestError(-32000, "Authentication required"), { harness: "auggie", loginHint: "auggie login" });
    expect(message).toBe(`harness 'auggie' needs you to log in: Authentication required; ${AUGGIE_LOGIN_STEP}`);
    expect(message).toEndWith("run auggie login in a terminal, then start acp-tui again");
  });

  test("a configured harness never gets the step", () => {
    expect(loginMessage(new RequestError(-32000, "Authentication required"), { harness: "auggie", loginHint: undefined })).toBe("harness 'auggie' needs you to log in: Authentication required");
  });

  test("the text is sanitised, on one line and cut at 300 columns", () => {
    const hostile = new RequestError(-32000, `bad\n\x1b]52;c;ZXZpbA==\x07line two ${"x".repeat(400)}`);
    const message = loginMessage(hostile, { harness: "other", loginHint: undefined });
    expect(message).not.toContain("\x1b");
    expect(message).not.toContain("\n");
    expect(message.startsWith("harness 'other' needs you to log in: bad")).toBe(true);
    expect(message.length).toBeLessThan(360);
    expect(message.endsWith("…")).toBe(true);
  });

  test("an ad hoc harness has no name to quote", () => {
    expect(loginMessage(new RequestError(-32000, "no"), { harness: "ad hoc", loginHint: undefined })).toBe("the ad hoc harness needs you to log in: no");
  });
});

describe("version rule", () => {
  test("major version of 1 or more", () => {
    for (const version of ["1.2.0", "1.2.0-prerelease.202610191214", "2", "v1.0", "10.1"]) expect(majorAtLeastOne(version)).toBe(true);
    for (const version of ["0.36.0", "0", "", "beta", "0.9.9"]) expect(majorAtLeastOne(version)).toBe(false);
  });

  test("the notice for auggie 1.x, once worded, with the version sanitised and cut to 40 columns", () => {
    expect(uncheckedAuggieNotice({ name: "auggie", version: "1.2.0-prerelease.202610191214" })).toBe("auggie 1.2.0-prerelease.202610191214 has not been checked with acp-tui; testers use 0.36.0");
    expect(uncheckedAuggieNotice({ name: "auggie", version: "2" })).toBe("auggie 2 has not been checked with acp-tui; testers use 0.36.0");
    const hostile = uncheckedAuggieNotice({ name: "auggie", version: `1.0\x1b]52;c;ZXZpbA==\x07${"9".repeat(80)}` })!;
    expect(hostile).not.toContain("\x1b");
    expect(hostile).toContain("…");
    expect(hostile.length).toBeLessThan(110);
  });

  test("no notice for 0.36.0, another harness, a missing version or no agentInfo", () => {
    expect(uncheckedAuggieNotice({ name: "auggie", version: "0.36.0" })).toBeNull();
    expect(uncheckedAuggieNotice({ name: "other", version: "3.0.0" })).toBeNull();
    expect(uncheckedAuggieNotice({ name: "auggie" })).toBeNull();
    expect(uncheckedAuggieNotice(null)).toBeNull();
    expect(uncheckedAuggieNotice(undefined)).toBeNull();
  });
});
