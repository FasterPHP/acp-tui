// mvp-rendering task 14.3 (review C20): "the home and end buttons no longer work in either IDE,
// only page up and page down do". Home and End in every encoding a terminal may send for them,
// in each focus, under the PhpStorm (JediTerm) and Zed environments:
//
// - `CSI H` / `CSI F` (what both IDEs send, phase-1a S1 key table), `CSI 1~` / `CSI 4~` (VT220),
//   `ESC O H` / `ESC O F` (application cursor keys) and `CSI 7~` / `CSI 8~` (rxvt);
// - the conversation: the cursor to the first item with it in view, then the last with the view
//   following the bottom;
// - the prompt box: with an empty draft the same jump (PgUp and PgDn page the conversation from
//   there, and Home and End did nothing, which is what the report describes); with a draft the
//   textarea's line start and end, and the conversation does not move;
// - the palette, the session list and the permission card's preview.
import { afterEach, describe, expect, test } from "bun:test";
import { JEDITERM_ENV } from "../pty/jediterm.ts";
import type { PtySession } from "../pty/harness.ts";
import { cardRows, promptText, READY, statusRow, withoutBar } from "../pty/regions.ts";
import { sendPrompt, settle, startCli, type CliRun } from "../conversation/cli.ts";
import { startChrome, type ChromeRun } from "../overlay/cli.ts";
import { listBody, listRows, listWorld, type ListWorld } from "../session/list-world.ts";


let session: PtySession | undefined;
afterEach(async () => {
  session?.kill("SIGTERM");
  await session?.dispose();
  session = undefined;
});

/** Home and End as each encoding writes them. */
const FORMS = [
  { name: "CSI H / CSI F", home: "\x1b[H", end: "\x1b[F" },
  { name: "CSI 1~ / CSI 4~", home: "\x1b[1~", end: "\x1b[4~" },
  { name: "SS3 H / SS3 F", home: "\x1bOH", end: "\x1bOF" },
  { name: "CSI 7~ / CSI 8~", home: "\x1b[7~", end: "\x1b[8~" },
] as const;

/** The two IDE environments (PhpStorm's terminals, Zed's). */
const ENVIRONMENTS = [
  { name: "TERMINAL_EMULATOR=JetBrains-JediTerm", env: { ...JEDITERM_ENV } },
  { name: "TERM_PROGRAM=zed", env: { TERMINAL_EMULATOR: undefined, TERM_PROGRAM: "zed" } },
] as const;

/** The conversation's rows: below the top margin (mvp-chrome-and-keys task 4.1), above the prompt
 *  box. */
const above = (s: PtySession) => {
  const rows = withoutBar(s.screenText());
  const end = rows.findIndex((r) => r.startsWith("╭"));
  return rows.slice(1, end < 0 ? rows.length : end);
};
const atTop = (s: PtySession) => above(s)[1]?.trim() === "history" && /scrolled \d+%/.test(statusRow(s));
const atBottom = (s: PtySession) => above(s)[1]?.trim() !== "history" && !/scrolled/.test(statusRow(s));

/** `long-session` with 100 items, idle after its one turn. */
async function history(env: Record<string, string | undefined>): Promise<CliRun> {
  const run = startCli({ scenario: "long-session", cols: 80, rows: 24, agentArgs: ["--items", "100"], env });
  session = run.session;
  await sendPrompt(run.session, "history");
  await run.session.waitFor(/end turn/, 20000);
  await settle(run.session);
  return run;
}

for (const { name: envName, env } of ENVIRONMENTS) {
  describe(`Home and End under ${envName}`, () => {
    test("conversation focus: Home is the first item at the top, End the last, following, in every encoding", async () => {
      const { session: s } = await history(env);
      s.sendKeys("Tab");
      await s.waitFor(() => /enter toggle/.test(statusRow(s)), 5000);
      for (const form of FORMS) {
        s.write(form.home);
        await s.waitFor(atTop, 5000);
        s.write(form.end);
        await s.waitFor(atBottom, 5000);
      }
    }, 60000);

    test("prompt box, empty: Home scrolls the conversation to its first item and End to the last, following; focus stays in the prompt box", async () => {
      const { session: s } = await history(env);
      expect(atBottom(s)).toBe(true);
      for (const form of FORMS) {
        s.write(form.home);
        await s.waitFor(atTop, 5000);
        s.write(form.end);
        await s.waitFor(atBottom, 5000);
      }
      // Focus never left the prompt box: typing goes into it.
      s.sendKeys({ text: "still here" });
      await s.waitFor((p) => promptText(p)[0] === "still here", 5000);
    }, 60000);

    test("prompt box, with a draft: Home and End are the textarea's line start and end, and the conversation does not move", async () => {
      const { session: s } = await history(env);
      s.sendKeys({ text: "abc def" });
      await s.waitFor((p) => promptText(p)[0] === "abc def", 5000);
      await settle(s);
      const before = above(s);
      let draft = "abc def";
      for (const [i, form] of FORMS.entries()) {
        s.write(form.home);
        s.sendKeys({ text: `<${i}` });
        draft = `<${i}${draft}`;
        await s.waitFor((p) => promptText(p)[0] === draft, 5000);
        s.write(form.end);
        s.sendKeys({ text: `${i}>` });
        draft = `${draft}${i}>`;
        await s.waitFor((p) => promptText(p)[0] === draft, 5000);
      }
      expect(above(s)).toEqual(before);
      expect(atBottom(s)).toBe(true);
    }, 60000);
  });

  describe(`Home and End in overlays under ${envName}`, () => {
    test("the command palette: Home shows the first group, End the last, in every encoding", async () => {
      const run: ChromeRun = startChrome({ scenario: "long-session", cols: 80, rows: 30, env });
      session = run.s;
      const s = run.s;
      await s.waitFor(READY, 10000);
      s.write("?");
      await s.waitFor(/Commands \d+/, 5000);
      const first = (p: PtySession) => p.screenText().some((r) => r.includes("Open the session list"));
      const last = (p: PtySession) => p.screenText().some((r) => r.includes("Send the prompt")) && !first(p);
      await s.waitFor(first, 3000);
      for (const form of FORMS) {
        s.write(form.end);
        await s.waitFor(last, 3000);
        s.write(form.home);
        await s.waitFor(first, 3000);
      }
    }, 60000);

    test("the permission card's preview: Home is the first row, End the last, in every encoding", async () => {
      const run = startChrome({ scenario: "permission-diff", env });
      session = run.s;
      const s = run.s;
      await s.waitFor(READY, 10000);
      s.sendKeys({ text: "go" }, "Enter");
      await s.waitFor(() => cardRows(s).length > 0, 5000);
      await s.flush();
      const bottom = () => cardRows(s).at(-1) ?? "";
      for (const form of FORMS) {
        s.write(form.end);
        await s.waitFor(() => bottom().includes(" 52-53 of 53 "), 3000);
        s.write(form.home);
        await s.waitFor(() => bottom().includes(" 1-2 of 53 "), 3000);
      }
    }, 60000);

    test("the session list: Home selects the first row, End the last, in every encoding", async () => {
      const w: ListWorld = listWorld();
      const repo = w.dir("repo");
      const titles = Array.from({ length: 16 }, (_, i) => `Topic ${String.fromCharCode(65 + i)} work`);
      const fixture = w.sessions(
        "store",
        titles.map((title, i) => ({ sessionId: `s-${i}`, cwd: repo, title, updatedAt: new Date(Date.now() - (i + 1) * 7 * 60_000).toISOString(), turns: [] })),
      );
      w.configure({ fake: ["--scenario", "copy-fixtures", "--load", "--list", "--sessions", fixture] });
      const s = w.start(["-a", "fake", "--resume"], { cwd: repo, cols: 63, rows: 21 });
      session = s;
      await s.waitFor(() => listBody(s).some((r) => r.startsWith("New session with fake")), 15000);
      // The list opens before the harness is up (day-two-feedback D2): keys wait for its sessions.
      await s.waitFor(() => listBody(s).some((r) => r.startsWith("Topic A work")), 15000);
      const firstShown = (p: PtySession) => listBody(p).some((r) => r.startsWith("New session with fake"));
      const lastShown = (p: PtySession) => listBody(p).some((r) => r.startsWith(titles.at(-1)!)) && !firstShown(p);
      expect(listRows(s).length).toBeGreaterThan(0);
      for (const form of FORMS) {
        s.write(form.end);
        await s.waitFor(lastShown, 3000);
        s.write(form.home);
        await s.waitFor(firstShown, 3000);
      }
    }, 60000);
  });
}
