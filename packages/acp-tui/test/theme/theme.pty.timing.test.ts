// parallel-tests task 3.4: the theme reload tests whose assertion is a time bound (turning theme.flat off, or editing a theme file, is drawn within one second), which run in the serial pass.
// What the file covers is in the header of theme.pty.test.ts; its helpers are in theme-pty-helpers.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { deriveSurfaces } from "../../src/theme/index.ts";
import { DARK, TRUECOLOUR_BG, configHome, start, bgAt, rowBgs, rgbCells, cardRows, openPermission, disposeSession } from "./theme-pty-helpers.ts";
import { WINDOWS } from "../windows.ts";

afterEach(disposeSession);

// Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
describe.skipIf(WINDOWS)("Flat style as a setting (task 5.4)", () => {
  test("Turned off live: theme.flat from true to false while the terminal has answered; within one second the surfaces are derived and the card is filled again", async () => {
    const cfg = configHome();
    cfg.config(`{ "theme": { "flat": true } }`);
    const s = start(cfg.home, DARK);
    await openPermission(s);
    expect(rgbCells(s)).toBe(0);
    const surfaces = deriveSurfaces(DARK);
    const saved = Date.now();
    cfg.config(`{ "theme": { "flat": false } }`);
    await s.waitFor((p) => {
      const card = cardRows(p);
      return card.length > 0 && rowBgs(p, card[0]!).every((b) => b === surfaces["surface.permission"]);
    }, 1000);
    expect(Date.now() - saved).toBeLessThan(1000);
    expect(s.rawOutput()).toMatch(TRUECOLOUR_BG);
    const fills = [surfaces["surface.permission"], surfaces["surface.permission.selected"]];
    for (const y of cardRows(s)) expect(rowBgs(s, y).every((b) => fills.includes(b))).toBe(true);
  }, 30000);
});

// Skipped on Windows: it needs the terminal's OSC 10/11 colour replies (derived surfaces, light theme), which ConPTY never passes on (it passes only OSC 4).
describe.skipIf(WINDOWS)("Theme files live (task 5.1)", () => {
  test("a theme file named by the configuration is drawn, and an edit to it is drawn within one second without a restart", async () => {
    const cfg = configHome();
    cfg.theme("mine", `{ "tokens": { "surface.user": "#203040" } }`);
    cfg.config(`{ "theme": "mine" }`);
    const s = start(cfg.home, DARK);
    await openPermission(s);
    // The user card's text after its bar and two columns of padding.
    const userRow = () => s.findLine(/^ {3}go$/);
    expect(bgAt(s, userRow(), 1)).toBe("#203040");
    const saved = Date.now();
    cfg.theme("mine", `{ "tokens": { "surface.user": "#402030" } }`);
    await s.waitFor(() => bgAt(s, userRow(), 1) === "#402030", 1000);
    expect(Date.now() - saved).toBeLessThan(1000);
  }, 30000);
});
