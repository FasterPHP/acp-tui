// PTY tests for spec tui-theme "Surfaces derived from the terminal's colours" and "Flat fallback
// without colour replies" (task 5.2): the real CLI against fake-agent, with the harness answering
// OSC 10 and 11 (or not) and never OSC 4, as PhpStorm's terminals do. They check the SGR the
// terminal receives and the colour of the cells on screen.
//
// The timing tests of this file are in surfaces.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { deriveSurfaces, lightness, parseHex, type SurfaceName, type TerminalColours } from "../../src/theme/index.ts";
import { modesSet, parseModeChanges } from "./harness.ts";
import { CARD_HEADER, REQUIRES_ACTION } from "./regions.ts";
import { DARK, LIGHT, openPermission, cardLines, type Bg, bgAt, rowBg, rgb, TRUECOLOUR_BG, same, surface, showing, noneLeft, disposeSession } from "./surfaces-helpers.ts";

afterEach(disposeSession);

describe("OSC 10 and 11 answered, OSC 4 unanswered", () => {
  for (const [name, colours] of [["dark", DARK], ["light", LIGHT]] as const) {
    test(`${name} background: truecolour fills for the status row, the user message and the permission card`, async () => {
      const s = await openPermission({ ...colours, terminator: name === "light" ? "bel" : "st" });
      const surfaces = deriveSurfaces(colours);
      const fill = (surface: SurfaceName): Bg => rgb(surfaces[surface]);
      expect(parseHex(surfaces["surface.permission"])).not.toEqual(parseHex(colours.background));

      expect(s.oscQueries).toContain(10);
      expect(s.oscQueries).toContain(11);
      expect(s.rawOutput()).toMatch(TRUECOLOUR_BG);

      const status = s.findLine(REQUIRES_ACTION);
      expect(status).toBeGreaterThanOrEqual(0);
      expect(rowBg(s, status).every((b) => JSON.stringify(b) === JSON.stringify(fill("status.bg")))).toBe(true);

      // Every row of the permission card is filled, edge to edge; the selected option (focus is on
      // the card) sits on the selection surface.
      const card = cardLines(s);
      expect(card.length).toBeGreaterThanOrEqual(2);
      const cardFill = [fill("surface.permission"), fill("surface.permission.selected")].map((b) => JSON.stringify(b));
      for (const y of card) expect(rowBg(s, y).every((b) => cardFill.includes(JSON.stringify(b)))).toBe(true);
      expect(rowBg(s, card[0]!).every((b) => JSON.stringify(b) === JSON.stringify(fill("surface.permission")))).toBe(true);

      // The user message ("go", after its bar and two columns of padding) sits on the user surface
      // behind its accent cell (an ANSI colour).
      const user = s.findLine(/^ {3}go$/);
      expect(user).toBeGreaterThanOrEqual(0);
      // The bar is drawn in the `user` token, whose default is accent's: ANSI blue (index 4) on a
      // dark and a light background alike.
      expect(bgAt(s, user, 0)).toEqual({ mode: "palette", index: 4 });
      expect(bgAt(s, user, 1)).toEqual(fill("surface.user"));
      expect(bgAt(s, user, s.lineText(user).length - 1)).toEqual(fill("surface.user"));

      // Outside cards the terminal's own background shows: agent message rows are all default.
      await s.waitFor("Streamed answer", 5000);
      const agent = s.findLine("Streamed answer");
      expect(agent).toBeGreaterThanOrEqual(0);
      expect(rowBg(s, agent).every((b) => b.mode === "default")).toBe(true);
    }, 30000);
  }
});

describe("The user card's bar (mvp-configuration, 13 October 2026)", () => {
  test("a theme setting user recolours the bar without touching accent", async () => {
    const s = await openPermission({ ...DARK, terminator: "st" }, `{ "theme": { "tokens": { "user": 5 } } }`);
    const user = s.findLine(/^ {3}go$/);
    expect(user).toBeGreaterThanOrEqual(0);
    expect(bgAt(s, user, 0)).toEqual({ mode: "palette", index: 5 });
    expect(bgAt(s, user, 1)).toEqual(rgb(deriveSurfaces(DARK)["surface.user"]));
  }, 30000);
});

// S1 re-check, bug 3 (follow-up): the selected option must be clearly lighter than the card on a
// dark theme and darker on a light one. The measure is the CIE L* difference, at least 5 (the same
// threshold as the unit tests in src/theme/surfaces.test.ts).
describe("Selected permission option contrast", () => {
  const MIN_DELTA_L = 5;

  for (const [name, colours] of [["dark", DARK], ["light", LIGHT]] as const) {
    test(`${name} background: after pressing 2, the option's cells differ from the card fill by at least ${MIN_DELTA_L} L*`, async () => {
      const s = await openPermission({ ...colours, terminator: name === "light" ? "bel" : "st" });
      await Bun.sleep(700); // past the card's typing-ahead guard
      s.sendKeys("2");
      const label = "2 allow always";
      const row = () => cardLines(s).find((y) => s.lineText(y).includes(label)) ?? -1;
      const surfaces = deriveSurfaces(colours);
      await s.waitFor((p) => {
        const y = row();
        return y >= 0 && JSON.stringify(bgAt(p, y, p.lineText(y).indexOf(label))) === JSON.stringify(rgb(surfaces["surface.permission.selected"]));
      }, 3000);
      const y = row();
      const x = s.lineText(y).indexOf(label);
      const sign = name === "dark" ? 1 : -1;
      const cardFill = parseHex(surfaces["surface.permission"]);
      for (let i = x; i < x + label.length; i++) {
        const bg = bgAt(s, y, i);
        expect(bg.mode).toBe("rgb");
        const hex = (bg as { hex: string }).hex;
        expect(sign * (lightness(parseHex(hex)) - lightness(cardFill))).toBeGreaterThanOrEqual(MIN_DELTA_L);
      }
      // The first option is back on the card's own fill.
      const first = cardLines(s).find((line) => s.lineText(line).includes("1 allow once"))!;
      expect(bgAt(s, first, s.lineText(first).indexOf("1 allow once") + 2)).toEqual(rgb(surfaces["surface.permission"]));
    }, 30000);
  }
});

describe("Flat fallback without colour replies", () => {
  test("no reply: no truecolour background SGR anywhere, and the permission card is still framed", async () => {
    const s = await openPermission(undefined);
    expect(s.oscQueries).toContain(10);
    expect(s.oscQueries).toContain(11);
    expect(s.rawOutput()).not.toMatch(TRUECOLOUR_BG);
    for (let y = 0; y < s.rows; y++) {
      expect(rowBg(s, y).some((b) => b.mode === "rgb")).toBe(false);
    }
    const card = cardLines(s).map((y) => s.screenText()[y]!);
    expect(card.length).toBeGreaterThanOrEqual(2);
    expect(card[0]).toContain(CARD_HEADER);
  }, 30000);

  test("theme.flat (formerly --spike flat): the terminal answers both colours and the app stays flat, card framed with its marker", async () => {
    const s = await openPermission(DARK, `{ "theme": { "flat": true } }`);
    expect(s.oscQueries).toContain(10);
    expect(s.oscQueries).toContain(11);
    expect(s.rawOutput()).not.toMatch(TRUECOLOUR_BG);
    for (let y = 0; y < s.rows; y++) {
      expect(rowBg(s, y).some((b) => b.mode === "rgb")).toBe(false);
    }
    const card = cardLines(s).map((y) => s.screenText()[y]!);
    expect(card.length).toBeGreaterThanOrEqual(2);
    expect(card[0]).toStartWith(`╭─ ${CARD_HEADER}`);
    expect(card[0]).toContain("◊");
    expect(card.at(-1)).toStartWith("╰");
    // A colour-scheme report makes OpenTUI re-query; the answer must not leave the fallback.
    const queried = s.oscQueries.length;
    s.setColours(LIGHT);
    s.write("\x1b[?997;2n");
    await s.waitFor(() => s.oscQueries.length >= queried + 2, 5000);
    await Bun.sleep(300); // a negative check: give the replies time to be (wrongly) applied
    expect(s.rawOutput()).not.toMatch(TRUECOLOUR_BG);
  }, 30000);

  test("only one of the two colours answered: still flat", async () => {
    const s = await openPermission({ foreground: DARK.foreground });
    expect(s.rawOutput()).not.toMatch(TRUECOLOUR_BG);
    expect(s.screenText().some((row) => row.startsWith(`╭─ ${CARD_HEADER}`))).toBe(true);
  }, 30000);
});

describe("Live theme", () => {
  test("a colour-scheme report (CSI ? 997 ; n n) makes OpenTUI re-query and the fills follow the new colours", async () => {
    const s = await openPermission(DARK);
    const status = () => s.findLine(REQUIRES_ACTION);
    const surfaceOf = (colours: TerminalColours, surface: SurfaceName) => deriveSurfaces(colours)[surface];
    expect(bgAt(s, status(), 0)).toEqual(rgb(surfaceOf(DARK, "status.bg")));

    s.setColours(LIGHT);
    s.write("\x1b[?997;2n");
    await s.waitFor((p) => JSON.stringify(bgAt(p, status(), 0)) === JSON.stringify(rgb(surfaceOf(LIGHT, "status.bg"))), 3000);
    const card = s.findLine(CARD_HEADER);
    expect(bgAt(s, card, 0)).toEqual(rgb(surfaceOf(LIGHT, "surface.permission")));
  }, 30000);
});

describe("Theme switch signalled (task 5.3)", () => {
  test("OpenTUI enables colour-scheme reports (CSI ? 2031 h) itself", async () => {
    const s = await openPermission(DARK);
    expect(modesSet(parseModeChanges(s.rawOutput()))).toContain(2031);
  }, 30000);

  test("SIGUSR2 with the same colours still repaints every cell and changes nothing", async () => {
    const s = await openPermission(DARK);
    await Bun.sleep(300);
    const before = s.rawOutput().length;
    s.kill("SIGUSR2");
    await s.waitFor((p) => p.rawOutput().length - before > 1500, 1000);
    await s.flush();
    expect(showing(s, DARK)).toBe(true);
  }, 30000);

  test("Ctrl+L re-queries: a changed answer restyles the screen", async () => {
    const s = await openPermission(DARK);
    s.setColours(LIGHT);
    s.sendKeys("Ctrl+L");
    await s.waitFor((p) => showing(p, LIGHT), 1000);
    await s.flush();
    expect(noneLeft(s, DARK)).toBe(true);
  }, 30000);

  test("a resize re-queries once it settles", async () => {
    const s = await openPermission(DARK);
    s.setColours(LIGHT);
    s.resize(90, 50);
    await s.waitFor((p) => showing(p, LIGHT), 2000);
    await s.flush();
    expect(noneLeft(s, DARK)).toBe(true);
  }, 30000);

  test("an unanswered re-query keeps the surfaces already in use", async () => {
    const s = await openPermission(DARK);
    s.setColours(undefined);
    s.kill("SIGUSR2");
    await Bun.sleep(600);
    await s.flush();
    expect(showing(s, DARK)).toBe(true);
  }, 30000);
});
