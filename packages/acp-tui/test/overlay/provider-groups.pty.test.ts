// Model lists grouped by provider against fake-agent's `config-options-providers` (an OpenCode-like
// flat model list over three providers), with the real CLI under a PTY: the picker's headings, the
// filter by full name, and the pill after a choice.
import { afterEach, describe, expect, test } from "bun:test";
import type { PtySession } from "../pty/harness.ts";
import { promptBox, promptText, READY } from "../pty/regions.ts";
import { startCli } from "../keys/cli-pty.ts";

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

const bottom = (s: PtySession): string => promptBox(s).at(-1) ?? "";
const screen = (s: PtySession): string => s.screenText().join("\n");

describe("model picker by provider", () => {
  test("headings, the filter by full name, the choice and the pill", async () => {
    const run = startCli("config-options-providers", 0, { cols: 100, rows: 30 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    // The pill names the current model with its provider.
    await run.s.waitFor((p) => bottom(p).includes("anthropic / Claude X"), 5000);

    run.s.sendKeys({ text: "/model" });
    await run.s.waitFor((p) => promptText(p).join(" ").includes("/model"), 5000);
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => /openrouter/.test(screen(p)) && /openai/.test(screen(p)), 5000);
    const rows = run.s.screenText().map((row) => row.trim());
    const at = (needle: string) => rows.findIndex((row) => row.includes(needle));
    expect(at("anthropic")).toBeGreaterThanOrEqual(0);
    expect(at("Claude Y")).toBeGreaterThan(at("anthropic"));
    expect(at("openrouter")).toBeGreaterThan(at("Claude Y"));
    expect(at("Qwen: Qwen3 Coder")).toBeGreaterThan(at("openrouter"));
    // Titles are drawn without their provider prefix.
    expect(screen(run.s)).not.toContain("anthropic/Claude Y");

    // The filter matches the full name.
    run.s.sendKeys({ text: "openrouter/q" });
    await run.s.waitFor((p) => !screen(p).includes("Claude Y") && screen(p).includes("Qwen: Qwen3 Coder"), 5000);
    expect(screen(run.s)).toContain("openrouter");

    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => bottom(p).includes("openrouter / Qwen: Qwen3 Coder"), 5000);
    expect(run.methods()).toContain("session/set_config_option");
  }, 30000);

  test("a model chosen between turns sends one session/set_config_option and nothing else; the next Enter sends one prompt", async () => {
    const run = startCli("config-options-providers", 0, { cols: 100, rows: 30 });
    session = run.s;
    await run.s.waitFor(READY, 10000);
    run.s.sendKeys({ text: "first" });
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => screen(p).includes("model=anthropic/claude-x"), 5000);
    await run.s.waitFor(READY, 5000);

    run.s.sendKeys({ text: "/model" });
    await run.s.waitFor((p) => promptText(p).join(" ").includes("/model"), 5000);
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => screen(p).includes("GPT X Mini"), 5000);
    run.s.sendKeys({ text: "openai/gpt-x-mini" });
    await run.s.waitFor((p) => !screen(p).includes("Claude Y"), 5000);
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => bottom(p).includes("openai / GPT X Mini"), 5000);

    run.s.sendKeys({ text: "second" });
    run.s.sendKeys("Enter");
    await run.s.waitFor((p) => screen(p).includes("model=openai/gpt-x-mini"), 5000);
    await run.s.waitFor(READY, 5000);

    const after = run.methods().slice(run.methods().indexOf("session/new") + 1);
    expect(after).toEqual(["session/prompt", "session/set_config_option", "session/prompt"]);
    // fake-agent logs no prompt text, only the block count: one text block each, nothing empty.
    const blocks = run.entries().filter((e) => e.method === "session/prompt").map((e) => (e.params as { promptBlockCount: number }).promptBlockCount);
    expect(blocks).toEqual([1, 1]);
  }, 30000);
});
