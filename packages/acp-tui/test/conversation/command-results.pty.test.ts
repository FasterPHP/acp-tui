// day-one-feedback task 4.5 (spec tui-rendering "Command results drawn", "Raw output shown when a
// call has no content"): fake-agent's `command-results` turn through the real CLI under `verbose`
// at 90x40: the condensed rows, the near misses drawn raw, and no envelope tag anywhere on screen
// for the recognised calls. Under both terminals the harness emulates (xterm and JediTerm). The
// test's own configuration file sets the density, so it holds under either default.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPty, type PtySession } from "../pty/harness.ts";
import { CLI, FAKE_AGENT, PREFILL, sendPrompt, settle } from "./cli.ts";
import { withoutBar } from "../pty/regions.ts";

// Imported by a computed path: acp-tui does not depend on the fake-agent package.
const CR = (await import(join(import.meta.dir, "../../../fake-agent/src/scenarios/command-results.ts"))) as {
  COMMAND_RESULTS_TITLES: Record<"auggieFailure" | "auggieSuccess" | "claudeFailure" | "claudeSuccess" | "nearMissEnvelope" | "nearMissRead", string>;
};

let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

function tempDir(label: string): string {
  return realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), `acp-tui-${label}-`)));
}

/** Starts the CLI against `command-results` at 90x40 under `verbose`, runs the turn and settles. */
async function start(terminal: "xterm" | "jediterm"): Promise<PtySession> {
  const cwd = tempDir("command-results");
  const config = tempDir("command-results-config");
  mkdirSync(join(config, "acp-tui"));
  writeFileSync(join(config, "acp-tui", "config.jsonc"), `{ "density": "verbose" }`);
  session = startPty(["bun", CLI, "--", "bun", FAKE_AGENT, "--scenario", "command-results", "--delay-scale", "0"], {
    cols: 90,
    rows: 40,
    cwd,
    env: { XDG_CONFIG_HOME: config },
    prefill: PREFILL,
    ...(terminal === "jediterm" ? { terminal: "jediterm" as const } : {}),
  });
  await sendPrompt(session, "go");
  await session.waitFor(/end turn/, 20000);
  await settle(session);
  return session;
}

/** The conversation's rows above the prompt box. */
function conversation(s: PtySession): string[] {
  const rows = withoutBar(s.screenText());
  const end = rows.findIndex((r) => r.startsWith("╭"));
  return rows.slice(0, end < 0 ? rows.length : end);
}

/** A card row's text: the gutter and the flat card rule taken off. */
// The card's rule and its two columns of padding (`cards.padding.columns`, day-one-feedback).
const card = (row: string) => row.replace(/^ {2}┃(?: {2})?/, "");

/** The card rows after the header matching `header`, up to the first row outside the card. */
function cardOf(rows: readonly string[], header: RegExp): string[] {
  const at = rows.findIndex((r) => header.test(r));
  if (at < 0) throw new Error(`no row matches ${header}\n${rows.join("\n")}`);
  const out: string[] = [];
  for (const row of rows.slice(at + 1)) {
    if (!row.startsWith("  ┃")) break;
    out.push(card(row));
  }
  return out;
}

describe.each(["xterm", "jediterm"] as const)("command results under %s (task 4.5)", (terminal) => {
  test("verbose: the condensed rows, the near misses raw, no envelope tags for the recognised calls", async () => {
    const s = await start(terminal);
    // The top of the conversation: the three recognised calls.
    s.sendKeys("Home");
    await settle(s, 60);
    const top = conversation(s);
    expect(top.find((r) => r.includes(CR.COMMAND_RESULTS_TITLES.auggieFailure))).toMatch(/✗ execute .*exit 127 +#1$/);
    // Auggie's failure: one line of output and the return code, no blank row between them.
    expect(cardOf(top, /#1$/)).toEqual(["", "Output: sh: model-selection: command not found", "Return code: 127", ""]);
    // Auggie's success (no content, rawOutput only): three lines.
    expect(top.find((r) => r.includes(CR.COMMAND_RESULTS_TITLES.auggieSuccess))).toMatch(/✓ execute .*3 lines +#2$/);
    expect(cardOf(top, /#2$/)).toEqual(["", "Output:", "  architecture.md", "  configuration.md", "  install-macos.md", "Return code: 0", ""]);
    // claude-agent-acp's failure.
    expect(top.find((r) => r.includes(CR.COMMAND_RESULTS_TITLES.claudeFailure))).toMatch(/✗ execute .*exit 127 +#3$/);
    expect(cardOf(top, /#3$/)).toEqual(["", "Output: /bin/bash: line 1: frobnicate: command not found", "Return code: 127", ""]);

    // The bottom: the success as a console fence and the two near misses, drawn raw.
    s.sendKeys("End");
    await settle(s, 60);
    const bottom = conversation(s);
    expect(cardOf(bottom, /✓ execute .*#4$/).join("\n")).toContain("?? notes.txt");
    const bare = (row: string) => row.trimEnd();
    const envelope = cardOf(bottom, /#5$/).map(bare);
    expect(envelope).toContain("Note: the command was retried once.");
    expect(envelope).toContain("Here are the results from executing the command.");
    expect(envelope).toContain("<return-code>");
    expect(envelope).toContain("</output>");
    expect(cardOf(bottom, /#6$/).map(bare)).toContain("Exit code 1");

    // The recognised calls show no envelope anywhere: each tag is on screen once, in the near miss.
    const shown = [...top, ...bottom];
    for (const tag of ["<return-code>", "</return-code>", "<output>", "</output>", "Here are the results"]) {
      expect([tag, new Set(shown.filter((r) => r.includes(tag))).size]).toEqual([tag, 1]);
    }
    expect(shown.join("\n")).not.toContain("```");
  }, 60000);
});
