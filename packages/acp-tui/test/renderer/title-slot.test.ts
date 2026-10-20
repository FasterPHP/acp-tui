// day-one-feedback task 9.2 (spec tui-screen "Second instance in the same directory", "Stale slot
// reclaimed"): the title's instance counter, over a temporary state directory (never the user's).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTitleSlots, titleSlotDir } from "../../src/renderer/title-slot.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-slots-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const running = new Set<number>();
const alive = (pid: number) => running.has(pid);
const slots = (pid: number) => {
  running.add(pid);
  return createTitleSlots({ dir: join(dir, "titles"), pid, alive });
};
const files = () => {
  try {
    return readdirSync(join(dir, "titles")).sort();
  } catch {
    return [];
  }
};

describe("title slots", () => {
  test("the state directory is the one the test preload set, not the user's", () => {
    expect(titleSlotDir()).toBe(join(process.env.XDG_STATE_HOME!, "acp-tui", "titles"));
  });

  test("two holders of one name get 1 and 2; a release is reused by the next start", () => {
    const a = slots(101);
    const b = slots(102);
    expect(a.acquire("acp-tui")).toBe(1);
    expect(b.acquire("acp-tui")).toBe(2);
    // The number is held for the run: asking again, or the first one going, renumbers nothing.
    expect(b.acquire("acp-tui")).toBe(2);
    a.release();
    expect(b.acquire("acp-tui")).toBe(2);
    expect(slots(103).acquire("acp-tui")).toBe(1);
    expect(files()).toHaveLength(2);
  });

  test("names are separate; a changed name releases the old slot", () => {
    const a = slots(111);
    expect(a.acquire("one")).toBe(1);
    expect(slots(112).acquire("two")).toBe(1);
    expect(a.acquire("two")).toBe(2);
    expect(slots(113).acquire("one")).toBe(1);
  });

  test("release removes the file, twice is harmless, and a slot taken over is not removed", () => {
    const a = slots(121);
    a.acquire("acp-tui");
    expect(files()).toHaveLength(1);
    a.release();
    a.release();
    expect(files()).toHaveLength(0);
    const b = slots(122);
    b.acquire("acp-tui");
    const [file] = files();
    // Another instance took the slot over after b's process was thought gone.
    writeFileSync(join(dir, "titles", file!), "999");
    b.release();
    expect(files()).toEqual([file!]);
  });

  test("a stale slot (its PID no longer runs) is taken over", () => {
    const killed = slots(131);
    expect(killed.acquire("acp-tui")).toBe(1);
    running.delete(131);
    expect(slots(132).acquire("acp-tui")).toBe(1);
    // The takeover left one slot, now held by the new instance.
    expect(files()).toHaveLength(1);
    expect(slots(133).acquire("acp-tui")).toBe(2);
  });

  test("a slot file that holds no PID is stale", () => {
    const first = slots(141);
    first.acquire("acp-tui");
    const [file] = files();
    writeFileSync(join(dir, "titles", file!), "not a pid");
    expect(slots(142).acquire("acp-tui")).toBe(1);
  });

  test("a race of creators: every one of many gets its own number", () => {
    const all = Array.from({ length: 12 }, (_, i) => slots(200 + i));
    const numbers = all.map((s) => s.acquire("acp-tui"));
    expect(new Set(numbers).size).toBe(12);
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers)).toBe(12);
  });

  test("processes starting at once (real PIDs) each get a different number", async () => {
    const script = `
      import { createTitleSlots } from ${JSON.stringify(join(import.meta.dir, "../../src/renderer/title-slot.ts"))};
      const n = createTitleSlots({ dir: process.argv[1] }).acquire("acp-tui");
      console.log(n);
      await Bun.sleep(600);`;
    const procs = Array.from({ length: 6 }, () => Bun.spawn(["bun", "-e", script, join(dir, "race")], { stdout: "pipe", stderr: "ignore" }));
    const numbers = await Promise.all(procs.map(async (p) => Number((await new Response(p.stdout).text()).trim())));
    await Promise.all(procs.map((p) => p.exited));
    expect(numbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  }, 20000);

  test("an unwritable state directory gives 1 and fails nothing", () => {
    writeFileSync(join(dir, "file"), "x");
    const blocked = createTitleSlots({ dir: join(dir, "file", "titles"), pid: 1, alive });
    expect(blocked.acquire("acp-tui")).toBe(1);
    blocked.release();
  });
});
