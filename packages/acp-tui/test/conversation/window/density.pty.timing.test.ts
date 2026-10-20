// parallel-tests task 3.2: the density switch whose first frame must come within 100 ms (spec tui-conversation, densities), run in the serial pass.
// What the file covers is in the header of density.pty.test.ts; its helpers are in density-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { sendPrompt, settle, startCli, type CliRun } from "../cli.ts";
import { cursorRow, press, density, expectFirstFrameWithin100 } from "./density-helpers.ts";

let run: CliRun | undefined;
afterEach(async () => {
  run?.session.kill("SIGTERM");
  await run?.session.dispose();
  run = undefined;
});

describe("densities switched by v (task 12.5)", () => {
  test("no console error or warning and a first frame within 100 ms on any switch: B2's walk at 61x20 over 1000 items, then two cycles while following (S3, IDE session B2 finding 1; IDE check 9.4 finding F1)", async () => {
    // The switch to `focus` logged 21 console events: entries mounted inside the frame's layout
    // step had NaN by NaN layout, and OpenTUI failed to create their Markdown tables' buffers.
    run = startCli({ scenario: "long-session", cols: 61, rows: 20, agentArgs: ["--items", "1000"] });
    const s = run.session;
    await sendPrompt(s, "go");
    await s.waitFor(/end turn/, 30000);
    await settle(s);
    await press(s, "Tab");
    for (let i = 0; i < 150; i++) s.sendKeys("Up");
    await settle(s, 300);
    await press(s, "Enter");
    // The expanded card 150 entries back is on the top row (the cursor moved up to it), and stays
    // there through each switch (in `focus` the line that holds it), each drawn within 100 ms of
    // its key. The first switch to `verbose` took 90 to 106 ms (IDE check 9.4, finding F1) while
    // it redrew all 160 mounted entries expanded; a switch now mounts only the viewport and its
    // margins before its first frame.
    const row = cursorRow(s);
    // The top conversation row is screen row 2, below the top margin (mvp-chrome-and-keys task 4.1).
    expect(row).toBe(1);
    const times: string[] = [];
    for (const name of ["verbose", "focus", "compact"]) {
      const frames = run.events("frame").length;
      await density(s, name);
      await settle(s, 200);
      expect(cursorRow(s)).toBe(row);
      times.push(expectFirstFrameWithin100(run, name));
      const slow = run.events("frame").slice(frames).filter((e) => Number(e["work"]) >= 100);
      expect({ name, slow }).toEqual({ name, slow: [] });
      expect({ name, console: run.events("console") }).toEqual({ name, console: [] });
    }
    // Following: Esc to the prompt box, End, and two more cycles from the conversation.
    await press(s, "Esc");
    await press(s, "Tab");
    await press(s, "End");
    for (const name of ["verbose", "focus", "compact", "verbose", "focus", "compact"]) {
      await density(s, name);
      await settle(s, 200);
      times.push(expectFirstFrameWithin100(run, name));
      expect({ name, console: run.events("console") }).toEqual({ name, console: [] });
    }
    console.log(`density switches, key to first frame (ms): ${times.join(", ")}`);
  }, 90000);
});
