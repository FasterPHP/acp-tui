// The login message (spec tui-agent-session "Harness needs a login") and the logged-out rules of the
// harness profiles ("Auggie 1.x not logged in at the start" and "on a prompt"), as pure rules.
import { describe, expect, test } from "bun:test";
import { RequestError } from "@agentclientprotocol/sdk";
import { auggieLoginCommand } from "../../src/agent/command.ts";
import { profileFor } from "../../src/agent/harness-profiles.ts";
import { AUGGIE_LOGIN_STEP, isAuthRequired, isLoggedOutSignature, isNoApiKey, loggedOutStartMessage, loginCommandFor, loginMessage, loginStep, noApiKeyMessage } from "../../src/agent/login.ts";

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
    expect(message).toBe(`harness 'auggie' needs you to log in: Authentication required; ${loginStep("auggie login")}`);
    expect(message).toEndWith("run auggie login in a terminal, then start acp-tui again");
  });

  test("Auggie's login step names auggie.cmd on Windows, where PowerShell's default policy refuses npm's auggie.ps1", () => {
    expect(auggieLoginCommand("win32")).toBe("auggie.cmd login");
    expect(auggieLoginCommand("linux")).toBe("auggie login");
    expect(auggieLoginCommand("darwin")).toBe("auggie login");
    expect(AUGGIE_LOGIN_STEP).toBe(loginStep(auggieLoginCommand()));
    const message = loginMessage(new RequestError(-32000, AUGGIE_TEXT), { harness: "auggie", loginHint: auggieLoginCommand("win32") });
    expect(message).toEndWith("; run auggie.cmd login in a terminal, then start acp-tui again");
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

describe("login for harness profiles", () => {
  test("the profile's command wins over the program's", () => {
    const one = profileFor({ name: "auggie", version: "1.2.2" });
    const zero = profileFor({ name: "auggie", version: "0.37.1 (commit 1a2b3c4d)" });
    // The profile names the program as the platform runs it (`auggie.cmd` on Windows).
    const program = process.platform === "win32" ? "auggie.cmd" : "auggie";
    expect(loginCommandFor(one, "auggie login")).toBe(`${program} auth login`);
    expect(loginCommandFor(zero, undefined)).toBe(`${program} login`);
    expect(loginCommandFor(null, "opencode auth login")).toBe("opencode auth login");
    expect(loginCommandFor(null, undefined)).toBeUndefined();
    expect(one!.loginCommand("win32")).toBe("auggie.cmd auth login");
    expect(zero!.loginCommand("win32")).toBe("auggie.cmd login");
  });

  test("a start that fails on the signature names the login command and no message", () => {
    expect(loggedOutStartMessage({ harness: "auggie", loginHint: "auggie auth login" })).toBe(`harness 'auggie' needs you to log in; ${loginStep("auggie auth login")}`);
  });

  test("the model signature: exact, and only for auggie-1", () => {
    const one = profileFor({ name: "auggie", version: "1.2.2" });
    const empty = { type: "select", id: "model", category: "model", currentValue: "unknown/unknown", options: [] };
    expect(isLoggedOutSignature(one, [empty])).toBe(true);
    expect(isLoggedOutSignature(one, [{ ...empty, options: [{ value: "a", name: "A" }] }])).toBe(false);
    expect(isLoggedOutSignature(one, [{ ...empty, currentValue: "gpt" }])).toBe(false);
    expect(isLoggedOutSignature(one, [{ ...empty, category: "mode", id: "mode" }])).toBe(false);
    expect(isLoggedOutSignature(one, undefined)).toBe(false);
    expect(isLoggedOutSignature(profileFor({ name: "auggie", version: "0.37.1" }), [empty])).toBe(false);
    expect(isLoggedOutSignature(null, [empty])).toBe(false);
  });

  test("a prompt error whose reason starts No API key found, for auggie-1 only", () => {
    const one = profileFor({ name: "auggie", version: "1.2.2" });
    const error = new RequestError(-32603, "Internal error", { details: "No API key found for unknown.\n\nUse /login or see docs/providers.md" });
    expect(isNoApiKey(one, error)).toBe(true);
    expect(isNoApiKey(null, error)).toBe(false);
    expect(isNoApiKey(one, new RequestError(-32603, "Internal error", { details: "Other" }))).toBe(false);
    expect(noApiKeyMessage(error, { harness: "auggie", loginHint: "auggie auth login" })).toBe(`harness 'auggie' needs you to log in: No API key found for unknown.; ${loginStep("auggie auth login")}`);
  });
});
