// mvp-configuration task 3.5 under the PTY harness: state that lives outside the configuration
// signal survives a live reload, and an armed two-press state does not (spec tui-config "Live
// reload"; design D6 and the risk "Reload during a drag, a find or an open card"). The real CLI
// against fake-agent, with a configuration home of its own, rewritten during the run the way an
// editor saves (a temporary file renamed over the original).
//
// - A selection (made by a drag, copy on release off) survives a reload that changes something
//   visible, and Ctrl+C then copies the same text; also across a reload of `keys`, which
//   registers the selection layer again.
// - The find bar keeps its query, its hit counter and the current hit across a module format
//   reload and a layout reload (the bar's region is laid out again).
// - A docked permission card keeps focus and its selected option across both, and the answer
//   still carries the option that was selected.
// - An armed double Esc and an armed Ctrl+D are disarmed by a reload that changes `keys`, and
//   left armed by one that does not.
//
// Nothing reaches the user's clipboard: the child has no display (selection/pty.ts), so a copy
// goes to the PTY as OSC 52, read back from the output.
//
// The timing tests of this file are in reload-state.pty.timing.test.ts (parallel-tests: they run in the serial pass).
import { afterEach, describe, expect, test } from "bun:test";
import { configHome } from "../pty/config-home.ts";
import type { PtySession } from "../pty/harness.ts";
import { cardRows, CARD_HEADER, READY, REQUIRES_ACTION, statusRow } from "../pty/regions.ts";
import { sendPrompt, settle } from "../conversation/cli.ts";
import { osc52Payloads } from "../selection/pty.ts";
import { start, reload, connectionMark, laidOut, rowOf, drag, selected, nextPayload, CTRL_F, findBar, selectedOptions, promptFocused, responses, disposeRun } from "./reload-state-helpers.ts";

afterEach(disposeRun);

describe("a selection across a reload (task 3.5)", () => {
  test("a drag across two items, copy on release off: a module format reload changes the status row, the selection stays highlighted and Ctrl+C copies the same text", async () => {
    const cfg = configHome({ selection: { copy_on_release: false } });
    const r = start(cfg, "copy-fixtures", 60, 70);
    const s = r.session;
    await sendPrompt(s, "give me things to copy");
    await s.waitFor((p) => laidOut(p) && READY.test(p.screenText().join("\n")), 15000);
    const first = rowOf(s, "  The first paragraph");
    const second = rowOf(s, "  The third paragraph");
    await drag(s, [2, first], [[4, first + 1]], [8, second]);
    await Bun.sleep(300);
    await s.flush();
    expect(selected(s, first, 3)).toBe(true);
    expect(osc52Payloads(s.rawOutput())).toEqual([]);

    const event = await reload(r, cfg, { selection: { copy_on_release: false }, layout: { modules: { connection: { format: "link {state}" } } } });
    expect(event["changed"]).toEqual(["layout"]);
    // Something visible changed, and the selection did not.
    expect(connectionMark(s, "link connected")).toBe(true);
    expect(selected(s, first, 3)).toBe(true);
    expect(selected(s, second, 3)).toBe(true);
    expect(osc52Payloads(s.rawOutput())).toEqual([]);

    s.sendKeys("Ctrl+C");
    const copied = await nextPayload(s, 0);
    expect(copied.startsWith("The first paragraph")).toBe(true);
    expect(copied.endsWith("The thi")).toBe(true);
    expect(r.events("clipboard")[0]).toMatchObject({ trigger: "ctrl+c" });

    // The same text again after a second reload, of the theme this time.
    await reload(r, cfg, { selection: { copy_on_release: false }, theme: { flat: true }, glyphs: "ascii" });
    s.sendKeys("Ctrl+C");
    expect(await nextPayload(s, 1)).toBe(copied);
  }, 40000);

  test("a reload of keys registers the selection layer again: the selection stays and Ctrl+C, the extra key bound to copy and Esc all still work", async () => {
    const cfg = configHome({ selection: { copy_on_release: false } });
    const r = start(cfg, "copy-fixtures", 60, 70);
    const s = r.session;
    await sendPrompt(s, "give me things to copy");
    await s.waitFor((p) => laidOut(p) && READY.test(p.screenText().join("\n")), 15000);
    const row = rowOf(s, "  The first paragraph");
    await drag(s, [2, row], [], [2 + 8, row]);
    await Bun.sleep(300);
    await s.flush();
    expect(selected(s, row, 3)).toBe(true);

    const event = await reload(r, cfg, { selection: { copy_on_release: false }, keys: { selection: { "ctrl+k": "copy" } } });
    expect(event["changed"]).toEqual(["keys"]);
    expect(selected(s, row, 3)).toBe(true);
    s.sendKeys("Ctrl+C");
    expect(await nextPayload(s, 0)).toBe("The first");
    s.sendKeys({ text: "\x0b" });
    expect(await nextPayload(s, 1)).toBe("The first");
    // Esc clears it.
    s.sendKeys("Esc");
    await s.waitFor((p) => !selected(p, row, 3), 5000);
  }, 40000);
});

describe("the find bar across a reload (task 3.5)", () => {
  test("query, hit counter and current hit survive a module format reload and a layout reload that moves the status row", async () => {
    const cfg = configHome({});
    const r = start(cfg, "copy-fixtures", 60, 70);
    const s = r.session;
    await sendPrompt(s, "give me things to copy");
    await s.waitFor((p) => laidOut(p) && READY.test(p.screenText().join("\n")), 15000);
    s.sendKeys(CTRL_F);
    await s.waitFor((p) => findBar(p) !== null, 5000);
    s.sendKeys({ text: "paragraph" });
    await s.waitFor((p) => /\b[3-9] hits\b/.test(findBar(p) ?? ""), 5000);
    s.sendKeys("Enter");
    await s.waitFor((p) => /\b1 of \d+\b/.test(findBar(p) ?? ""), 5000);
    s.sendKeys("Enter");
    await s.waitFor((p) => /\b2 of \d+\b/.test(findBar(p) ?? ""), 5000);
    await settle(s, 200);
    const bar = findBar(s)!;
    expect(bar).toContain("paragraph");
    const hitRow = (p: PtySession) => p.screenText().findIndex((l) => /^ {2}The second paragraph/.test(l));
    const hitY = hitRow(s);
    expect(hitY).toBeGreaterThanOrEqual(0);
    const hitCells = (p: PtySession) => {
      const y = hitRow(p);
      const x = p.screenText()[y]!.indexOf("paragraph");
      return Array.from({ length: 9 }, (_, i) => p.cell(p.term.buffer.active.baseY + y, x + i)!.isBold() && Boolean(p.cell(p.term.buffer.active.baseY + y, x + i)!.isInverse()));
    };
    expect(hitCells(s).every(Boolean)).toBe(true);

    await reload(r, cfg, { layout: { modules: { connection: { format: "link {state}" } } } });
    expect(connectionMark(s, "link connected")).toBe(true);
    expect(findBar(s)).toBe(bar);
    expect(hitCells(s).every(Boolean)).toBe(true);
    // The bar still has focus: typing continues the query, Enter steps on.
    s.sendKeys("Enter");
    await s.waitFor((p) => /\b3 of \d+\b/.test(findBar(p) ?? ""), 5000);
    s.sendKeys("Shift+Enter");
    await s.waitFor((p) => /\b2 of \d+\b/.test(findBar(p) ?? ""), 5000);

    // A layout that moves the status row to the top lays the bar's region out again.
    await reload(r, cfg, {
      layout: { screen: [{ left: ["cwd", "turn-state"], right: ["position", "connection"] }, "conversation", "activity", "card", "prompt", { spacer: 1 }, "find"] },
    });
    await s.waitFor((p) => READY.test(p.screenText()[1] ?? ""), 5000);
    expect(findBar(s)).toBe(bar);
    expect(hitCells(s).every(Boolean)).toBe(true);
    s.sendKeys({ text: "s" });
    await s.waitFor((p) => (findBar(p) ?? "").includes("paragraphs"), 5000);
    s.sendKeys("Esc");
    await s.waitFor((p) => findBar(p) === null, 5000);
  }, 60000);
});

describe("the permission card across a reload (task 3.5)", () => {
  test("a docked card keeps focus and its selected option across a module format reload, a layout reload and a keys reload, and the answer carries that option", async () => {
    const cfg = configHome({});
    const r = start(cfg, "basic", 80, 30);
    const s = r.session;
    await s.waitFor(READY, 10000);
    s.sendKeys({ text: "go" }, "Enter");
    await s.waitFor(CARD_HEADER, 5000);
    await Bun.sleep(400); // the card's 300 ms guard
    // The answer row has focus with its first option selected; move to the second.
    await s.waitFor((p) => selectedOptions(p).length === 1, 5000);
    expect(selectedOptions(s)).toEqual(["1 allow once"]);
    s.sendKeys("Right");
    await s.waitFor((p) => selectedOptions(p).join() === "2 allow always", 5000);
    expect(promptFocused(s)).toBe(false);
    const card = cardRows(s);

    await reload(r, cfg, { layout: { modules: { connection: { format: "link {state}" } } } });
    expect(connectionMark(s, "link connected")).toBe(true);
    expect(selectedOptions(s)).toEqual(["2 allow always"]);
    expect(promptFocused(s)).toBe(false);
    expect(cardRows(s)).toEqual(card);
    expect(REQUIRES_ACTION.test(statusRow(s))).toBe(true);

    await reload(r, cfg, {
      layout: { screen: [{ left: ["cwd", "turn-state"], right: ["position", "connection"] }, "conversation", "activity", "card", "prompt", { spacer: 1 }, "find"] },
    });
    await s.waitFor((p) => REQUIRES_ACTION.test(p.screenText()[1] ?? ""), 5000);
    expect(selectedOptions(s)).toEqual(["2 allow always"]);
    expect(promptFocused(s)).toBe(false);

    // The card's layer is registered again by a keys reload; focus and selection stay.
    await reload(r, cfg, { keys: { card: { "ctrl+k": "confirm" } } });
    expect(selectedOptions(s)).toEqual(["2 allow always"]);
    expect(promptFocused(s)).toBe(false);
    expect(responses(r)).toEqual([]);

    s.sendKeys("Enter");
    await s.waitFor(() => responses(r).length === 1, 5000);
    expect(responses(r)).toEqual([{ outcome: { outcome: "selected", optionId: "allow-always" } }]);
  }, 60000);
});
