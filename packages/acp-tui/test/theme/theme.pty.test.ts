// mvp-configuration tasks 5.1, 5.3 and 5.4 under the PTY harness: the real CLI against fake-agent
// with a configuration home of its own per test, the harness answering OSC 10 and 11 (specs
// tui-theme "Flat style as a setting", "Theme files" and "Permission card distinct under any
// theme"). `theme.flat` replaces `--spike flat`: no test here passes `--spike`.
//
// The timing tests of this file are in theme.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { deriveSurfaces } from "../../src/theme/index.ts";
import { CARD_HEADER, READY } from "../pty/regions.ts";
import { DARK, ONE_LIGHT, TRUECOLOUR_BG, configHome, start, rowBgs, rgbCells, cardRows, openPermission, disposeSession } from "./theme-pty-helpers.ts";
import { WINDOWS } from "../windows.ts";

afterEach(disposeSession);

// Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
describe.skipIf(WINDOWS)("Flat style as a setting (task 5.4)", () => {
  test("Forced flat in a terminal that answers: theme.flat true, OSC 10 and 11 answered, a permission request open: no truecolour background SGR, the card drawn with its warning frame and marker glyph", async () => {
    const cfg = configHome();
    cfg.config(`{ "theme": { "flat": true } }`);
    const s = start(cfg.home, DARK);
    await openPermission(s);
    expect(s.oscQueries).toContain(10);
    expect(s.oscQueries).toContain(11);
    expect(s.rawOutput()).not.toMatch(TRUECOLOUR_BG);
    expect(rgbCells(s)).toBe(0);
    const rows = cardRows(s).map((y) => s.screenText()[y]!);
    expect(rows[0]).toStartWith(`╭─ ${CARD_HEADER}`);
    expect(rows[0]).toContain("◊");
    expect(rows.at(-1)).toStartWith("╰");
  }, 30000);
});

// Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
describe.skipIf(WINDOWS)("Permission card distinct under any theme (task 5.3)", () => {
  test("hostile's imitation renders without the card's fill when a theme pins surface.code to it; the real card keeps the pinned fill", async () => {
    const cfg = configHome();
    cfg.config(`{ "theme": { "tokens": { "surface.permission": "#3a2f24", "surface.code": "#3a2f24" } } }`);
    // Delay scale 20: hostile pauses 2 s between its message (with the imitations) and the request.
    const s = start(cfg.home, ONE_LIGHT, "hostile", "20");
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor(() => s.screenText().some((l) => l.includes("The same card in a code block:")), 8000);
    await s.waitFor(() => cardRows(s).length > 0, 8000);
    await s.flush();
    const card = cardRows(s);
    // Every row above the docked card: never the card's fill (the code block took its derived fill).
    for (let y = 0; y < card[0]!; y++) expect(rowBgs(s, y), `row ${y}: ${s.screenText()[y]}`).not.toContain("#3a2f24");
    const code = deriveSurfaces(ONE_LIGHT)["surface.code"];
    expect(s.screenText().some((_, y) => y < card[0]! && rowBgs(s, y).includes(code))).toBe(true);
    // The card keeps the pinned fill edge to edge on its header row.
    expect(rowBgs(s, card[0]!).every((b) => b === "#3a2f24")).toBe(true);
  }, 40000);
});
