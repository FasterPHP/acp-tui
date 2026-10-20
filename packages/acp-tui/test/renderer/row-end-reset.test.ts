// Text attributes end with their cells (tui-theme, scenario "Reset written before the next row";
// change opentui-0-6-6 design D3). OpenTUI up to 0.6.1 ended every changed run of cells with
// `CSI 0 m` except a run that ended in a row's last column (#1633, acp-tui's report): the next
// run, on a later row, only set its colours, so it inherited the bold (the cards' bold right frame
// edge leaked into line numbers and titles in PhpStorm and Zed). acp-tui cleared the last column's
// attributes in a post-process pass (`row-end.ts`) until OpenTUI 0.6.2 fixed it (#1652), and the
// pass was removed with the upgrade to 0.6.6.
//
// This test reads the bytes acp-tui's own renderer (`createScreenRenderer`) writes for a frame
// that draws an attributed run ending in the last column and then a run on the next row, as probe
// `docs/mvp-notes/opentui-0.6-probes/rowend.ts` does: the run must be written with its attribute,
// and an attribute reset (`CSI 0 m`, or `CSI 22 m` for bold and dim, alone or within a longer SGR)
// must come between its last character and the later run's text. It asserts a reset, not a byte
// string, so a harmless change in OpenTUI's run encoding does not break it. On 0.6.1 without the
// pass it fails (checked once, 18 October 2026, docs/mvp-notes/opentui-0.6.6-audit.md, "Applying
// opentui-0-6-6").
import { describe, expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { RGBA, TextAttributes, type CliRenderer, type OptimizedBuffer } from "@opentui/core";
import { createScreenRenderer } from "../../src/renderer/create.ts";

const COLUMNS = 8;
const ROWS = 4;

/** A TTY-like stdout that keeps what is written. */
class Capture extends Writable {
  readonly isTTY = true;
  readonly columns = COLUMNS;
  readonly rows = ROWS;
  private chunks: string[] = [];
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString("utf8"));
    done();
  }
  getColorDepth(): number {
    return 24;
  }
  take(): string {
    const text = this.chunks.join("");
    this.chunks = [];
    return text;
  }
}

/** The SGR parameters that reset the attribute `flag` (bold and dim share 22), skipping the
 *  colour arguments of 38 and 48, whose zeros are not resets. */
function resets(params: string, flag: number): boolean {
  const list = params.split(";");
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!.split(":")[0]!;
    if (p === "38" || p === "48" || p === "58") {
      if (list[i]!.includes(":")) continue;
      const kind = list[i + 1];
      i += kind === "2" ? 4 : kind === "5" ? 2 : 0;
      continue;
    }
    if (p === "" || p === "0") return true;
    if (p === "22" && (flag === TextAttributes.BOLD || flag === TextAttributes.DIM)) return true;
  }
  return false;
}

/** Whether `bytes` holds an SGR sequence that resets `flag`. */
function holdsReset(bytes: string, flag: number): boolean {
  for (const match of bytes.matchAll(/\x1b\[([0-9;:]*)m/g)) if (resets(match[1]!, flag)) return true;
  return false;
}

/** Whether `bytes` holds an SGR sequence that sets `flag` (1 bold, 2 dim). */
function setsFlag(bytes: string, flag: number): boolean {
  const code = flag === TextAttributes.BOLD ? "1" : "2";
  for (const match of bytes.matchAll(/\x1b\[([0-9;:]*)m/g)) {
    const list = match[1]!.split(";");
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      if (p === "38" || p === "48" || p === "58") {
        const kind = list[i + 1];
        i += kind === "2" ? 4 : kind === "5" ? 2 : 0;
        continue;
      }
      if (p === code) return true;
    }
  }
  return false;
}

/** Whether `bytes` holds an SGR sequence that sets an RGB or indexed foreground (38;2 or 38;5). */
function setsColourFg(bytes: string): boolean {
  for (const match of bytes.matchAll(/\x1b\[([0-9;:]*)m/g)) {
    const list = match[1]!.split(";");
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      if (p === "38") return true;
      if (p === "48" || p === "58") i += list[i + 1] === "2" ? 4 : list[i + 1] === "5" ? 2 : 0;
    }
  }
  return false;
}

/** The bytes acp-tui's renderer writes for one changed frame: `ab` plain, then `|` with `flag`
 *  in the last column of row 0 (in white, or in the terminal's default foreground with
 *  `defaultFg`, as a muted token on a light background is drawn), then `NEXT` at the start of
 *  row 1. */
async function frameBytes(flag: number, defaultFg = false): Promise<string> {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin }) as unknown as NodeJS.ReadStream;
  const stdout = new Capture();
  const renderer: CliRenderer = await createScreenRenderer({ stdin, stdout: stdout as unknown as NodeJS.WriteStream, mouse: "off" });
  try {
    const red = RGBA.fromInts(220, 50, 47, 255);
    const green = RGBA.fromInts(80, 200, 80, 255);
    const white = RGBA.fromInts(255, 255, 255, 255);
    const black = RGBA.fromInts(0, 0, 0, 255);
    await Bun.sleep(100);
    renderer.requestRender();
    await renderer.idle();
    stdout.take();
    renderer.addPostProcessFn((buffer: OptimizedBuffer) => {
      buffer.fillRect(0, 0, COLUMNS, ROWS, black);
      buffer.setCell(0, 0, "a", red, black, 0);
      buffer.setCell(1, 0, "b", red, black, 0);
      buffer.setCell(COLUMNS - 1, 0, "|", defaultFg ? RGBA.defaultForeground() : white, black, flag);
      "NEXT".split("").forEach((c, x) => buffer.setCell(x, 1, c, green, black, 0));
    });
    renderer.requestRender();
    await renderer.idle();
    await Bun.sleep(50);
    return stdout.take();
  } finally {
    renderer.destroy();
    await renderer.closed.catch(() => {});
  }
}

describe("an attribute that ends in a row's last column", () => {
  for (const [name, flag] of [
    ["bold", TextAttributes.BOLD],
    ["dim", TextAttributes.DIM],
  ] as const) {
    test(`${name}: written with the run, and reset before the next row's text`, async () => {
      const frame = await frameBytes(flag);
      const last = frame.indexOf("|");
      const next = frame.indexOf("NEXT", last + 1);
      expect(last).toBeGreaterThan(-1);
      expect(next).toBeGreaterThan(last);
      // The last column draws its attribute: the SGR in front of `|` (since the previous `b`) sets it.
      expect(setsFlag(frame.slice(frame.lastIndexOf("b", last), last), flag)).toBe(true);
      // And it ends there: a reset between `|` and `NEXT`.
      expect(holdsReset(frame.slice(last + 1, next), flag)).toBe(true);
    });
  }

  // tui-theme scenario "Dim in the last column": a muted cell on a light background is the
  // default foreground dimmed; in the last column it is written with SGR 2 and no RGB foreground
  // (the row-end workaround gave it an RGB colour instead), and the dim ends there.
  test("dim in the default foreground: SGR 2 with no RGB foreground, reset before the next row's text", async () => {
    const frame = await frameBytes(TextAttributes.DIM, true);
    const last = frame.indexOf("|");
    const next = frame.indexOf("NEXT", last + 1);
    expect(last).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(last);
    // The run's own SGR: from the cursor move to the last column (`CSI 1 ; 8 H`) to the `|`.
    const move = frame.lastIndexOf(`\x1b[1;${COLUMNS}H`, last);
    expect(move).toBeGreaterThan(-1);
    const before = frame.slice(move, last);
    expect(setsFlag(before, TextAttributes.DIM)).toBe(true);
    expect(setsColourFg(before)).toBe(false);
    expect(holdsReset(frame.slice(last + 1, next), TextAttributes.DIM)).toBe(true);
  });
});
