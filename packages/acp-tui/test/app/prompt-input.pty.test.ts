// The prompt box's input rule under the real CLI (opentui-0-6 tasks 4.1 and 4.2, design D5; spec
// tui-layout "Prompt box", scenarios "Paste with control characters" and "Clipboard with control
// characters"): what the terminal pastes is shown without escape sequences or control
// characters (no `^G` notation from OpenTUI 0.6.1's editor), nothing is sent until Enter, and
// what is sent is exactly what is shown. fake-agent redacts prompt text from its log, so the
// agent here is fake-agent behind `tee`, which records the JSON-RPC lines acp-tui writes to it.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bracketedPaste, startPty, type PtySession } from "../pty/harness.ts";
import { promptText, READY } from "../pty/regions.ts";

const ROOT = resolve(import.meta.dir, "../../../..");
const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

/** acp-tui against fake-agent's `basic`, with every line acp-tui sends the agent kept in a file. */
function start(): { s: PtySession; sent: () => { method?: string; params?: { prompt?: { type: string; text?: string }[] } }[] } {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-prompt-input-"));
  const wire = join(dir, "to-agent.jsonl");
  const agent = ["sh", "-c", `tee '${wire}' | exec bun '${FAKE_AGENT}' --scenario basic --delay-scale 0`];
  const s = startPty(["bun", CLI, "--", ...agent], { cols: 80, rows: 24, cwd: dir, env: { WAYLAND_DISPLAY: undefined, DISPLAY: undefined } });
  session = s;
  const sent = () =>
    existsSync(wire)
      ? readFileSync(wire, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { method?: string; params?: { prompt?: { type: string; text?: string }[] } })
      : [];
  return { s, sent };
}

describe("Prompt box input (opentui-0-6 task 4.1)", () => {
  test("Paste with control characters: abcdef, a tab, g, then h on a second line; no ^ notation; nothing sent; Enter sends exactly that text", async () => {
    const { s, sent } = start();
    await s.waitFor(READY, 10000);
    s.write(bracketedPaste("a\x07b\x00c\x1b[31md\x7fe\u0085f\tg\r\nh"));
    await s.waitFor((p) => promptText(p).length === 2 && promptText(p)[1] === "h", 5000);
    const rows = promptText(s);
    // The tab is drawn as spaces up to the next tab stop.
    expect(rows[0]).toMatch(/^abcdef +g$/);
    expect(s.screenText().join("\n")).not.toMatch(/\^[@A-Z\[\\\]^_?]|<8[0-9a-f]>/);
    await Bun.sleep(300);
    expect(sent().some((m) => m.method === "session/prompt")).toBe(false);
    s.sendKeys("Enter");
    await s.waitFor(() => sent().some((m) => m.method === "session/prompt"), 5000);
    const prompt = sent().find((m) => m.method === "session/prompt")!.params!.prompt!;
    expect(prompt).toEqual([{ type: "text", text: "abcdef\tg\nh" }]);
  }, 30000);
});
