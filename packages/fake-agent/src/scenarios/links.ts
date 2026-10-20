// The "links" scenario (mvp-rendering tasks 6.3 and 6.4): two short agent
// messages for the link PTY tests, small enough to be on screen at once. The
// first holds one link (the `openLink` action opens it at once); the second
// holds several allowed ones (a labelled link, a bare URL, a mail link, a
// relative path, a deceptive label that is a URL to another host (review C9:
// in PhpStorm the terminal opens the label's text) and a URL long enough to
// wrap at 100 columns) and one refused `javascript:` link (the chooser lists
// the allowed ones; nothing may open or get OSC 8 for the refused one).
import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { Scenario, ScenarioContext } from "../scenario.ts";

export const LINKS_ONE_ID = "links-one";
export const LINKS_MANY_ID = "links-many";

export const LINKS_ONE_TEXT = "One link: [the docs](https://example.com/docs).";

export const LINKS_DECEPTIVE = "[https://bank.example](https://evil.example/login)";

export const LINKS_LONG_URL = "https://example.com/a/very/long/path/that/keeps/going/and/going/well/past/the/width/of/the/terminal/pane?query=string";

export const LINKS_MANY_TEXT = [
  "Several: [inline link](https://example.com/inline), a bare URL https://example.com/bare/url, [mail us](mailto:team@example.com),",
  "a [readme](README.md) and a [script link](javascript:alert(1)).",
  "",
  `A deceptive one: ${LINKS_DECEPTIVE}.`,
  "",
  `A long one: ${LINKS_LONG_URL}`,
  "",
].join("\n");

export const linksScenario: Scenario = {
  name: "links",

  async prompt(ctx: ScenarioContext): Promise<PromptResponse> {
    await ctx.send({ sessionUpdate: "agent_message_chunk", messageId: LINKS_ONE_ID, content: { type: "text", text: LINKS_ONE_TEXT } });
    await ctx.send({ sessionUpdate: "agent_message_chunk", messageId: LINKS_MANY_ID, content: { type: "text", text: LINKS_MANY_TEXT } });
    return { stopReason: "end_turn" };
  },
};
