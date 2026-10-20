// Golden screen dumps of the whole `markdown-gallery` (mvp-rendering task 4.7, and 10.3's
// "Streamed gallery"): the real acp-tui under the PTY harness against fake-agent, on a screen
// tall enough for the whole message (600 rows), read back cell by cell from the emulator and
// held per gallery tag in `test/conversation/golden/screen/<tag>.txt`.
//
// Each drawn row is two lines, as in the rendered-rows goldens (test/conversation/markdown/
// golden.ts): the row's text between bars, then its cells as runs, each opened by
// «fg bg flags» where it changes:
//
// - fg: `default`, an ANSI palette colour by name (`cyan`, `bright-black`, ...) or `#rrggbb`;
// - bg: left out when it is the terminal's own, else the surface token whose derived colour it is
//   (`bg:surface.code`, from `deriveSurfaces` of the answered OSC 10 and 11 colours) or `#rrggbb`;
// - flags: `+b` bold, `+i` italic, `+d` dim, `+u` underline, `+v` inverse, `+s` struck.
//
// The runs end at the row's last cell that shows a character, a fill or an attribute, so a code
// block's fill to the right edge is part of the row. A blank row shows as an empty pair of bars.
// The dark and light answers give the same dump wherever their tokens and surfaces agree (the
// fills are named, not given as colours); a tag whose dumps differ holds both.
//
// Rows are split per tag like the rendered-rows goldens: a tag's rows run from the row that
// starts with it (`M01 `, behind the gutter) to the next tag, blank rows at the end left out; the
// rows before `M01` (the gallery's heading and introduction) are `preamble`; the footnote
// definitions drawn at the end of the message belong to `M25` (the footnotes sample), after a
// blank row, and not to `M99`.
import { DEFAULT_GLYPHS } from "../../src/conversation/glyphs.ts";
import { deriveSurfaces } from "../../src/theme/index.ts";
import type { OscColours, PtySession } from "../pty/harness.ts";
import { READY } from "../pty/regions.ts";
import { sendPrompt, startCli, type CliRun } from "./cli.ts";

export const DARK = { foreground: "#bcbec4", background: "#191a1c" } as const satisfies OscColours;
export const LIGHT = { foreground: "#383a42", background: "#fafafa" } as const satisfies OscColours;
/** Both OSC 10 and 11 answered (the dumps name fills by the surfaces derived from them). */
export interface AnsweredColours extends OscColours {
  readonly foreground: string;
  readonly background: string;
}
export const SCREEN_ROWS = 600;
/** The tag of the footnotes sample, whose dump ends with the definitions. */
export const FOOTNOTE_TAG = "M25";
export const PREAMBLE = "preamble";
/** Every tag of the gallery: M01 to M36, the last line M99, and the rows before M01. */
export const SCREEN_TAGS: readonly string[] = [PREAMBLE, ...Array.from({ length: 36 }, (_, i) => `M${String(i + 1).padStart(2, "0")}`), "M99"];

const PALETTE = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright-black",
  "bright-red",
  "bright-green",
  "bright-yellow",
  "bright-blue",
  "bright-magenta",
  "bright-cyan",
  "bright-white",
];

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

type Cell = NonNullable<ReturnType<PtySession["cell"]>>;

interface CellStyle {
  /** The run label (`default` for the terminal's own style). */
  readonly label: string;
  /** What a space shows of it: the fill and the attributes drawn on a blank cell. */
  readonly onSpace: string;
}

/** A cell's style. A space shows no foreground, bold, italic or dim, so a space takes the run
 *  before it when what it shows agrees (OpenTUI writes blank cells in white, which no one sees). */
function cellStyle(cell: Cell, surfaces: ReadonlyMap<string, string>): CellStyle {
  const fg = cell.isFgDefault() ? "default" : cell.isFgPalette() ? (PALETTE[cell.getFgColor()] ?? `p${cell.getFgColor()}`) : hex(cell.getFgColor());
  let bg = "";
  if (!cell.isBgDefault()) {
    const value = cell.isBgPalette() ? `p${cell.getBgColor()}` : hex(cell.getBgColor());
    bg = `bg:${surfaces.get(value) ?? value}`;
  }
  const shown = [cell.isUnderline() ? "+u" : "", cell.isInverse() ? "+v" : "", cell.isStrikethrough() ? "+s" : ""];
  const flags = [cell.isBold() ? "+b" : "", cell.isItalic() ? "+i" : "", cell.isDim() ? "+d" : "", ...shown].filter(Boolean);
  return { label: [fg, bg, ...flags].filter(Boolean).join(" "), onSpace: [bg, ...shown].filter(Boolean).join(" ") };
}

function onSpaceOf(label: string): string {
  return label
    .split(" ")
    .filter((part) => part.startsWith("bg:") || part === "+u" || part === "+v" || part === "+s")
    .join(" ");
}

/** The derived surfaces by colour (`#rrggbb` to token name), the first name for a shared value. */
function surfaceNames(colours: AnsweredColours): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of Object.entries(deriveSurfaces(colours))) {
    const key = String(value).toLowerCase();
    if (!out.has(key)) out.set(key, name);
  }
  return out;
}

/** One screen row as its text line and its style line; a blank row as empty bars. */
function formatRow(s: PtySession, y: number, n: number, surfaces: ReadonlyMap<string, string>): string {
  const absY = s.term.buffer.active.baseY + y;
  const cells: { ch: string; style: CellStyle }[] = [];
  for (let x = 0; x < s.term.cols; x++) {
    const cell = s.cell(absY, x);
    if (!cell || cell.getWidth() === 0) continue;
    cells.push({ ch: cell.getChars() || " ", style: cellStyle(cell, surfaces) });
  }
  let end = cells.length;
  while (end > 0 && cells[end - 1]!.ch === " " && cells[end - 1]!.style.onSpace === "") end--;
  const shown = cells.slice(0, end);
  const num = String(n).padStart(3);
  if (shown.length === 0) return `${num} ││`;
  let styled = "";
  let last = "default";
  shown.forEach(({ ch, style }, i) => {
    let label = style.label;
    if (ch === " " && style.onSpace === onSpaceOf(last)) label = last;
    else if (ch === " " && style.onSpace === "") label = "default";
    if (label !== last || i === 0) styled += `«${label}»`;
    last = label;
    styled += ch;
  });
  return `${num} │${shown.map((c) => c.ch).join("")}│\n    ${styled}`;
}

const TAG = new RegExp(`^ {${DEFAULT_GLYPHS.gutterWidth}}(M\\d\\d) `);

/**
 * The gallery message's rows on screen, formatted, per tag (see the module header): from the
 * gallery's heading to the row above the turn-end line.
 */
export function galleryDump(s: PtySession, colours: AnsweredColours): Map<string, string[]> {
  const surfaces = surfaceNames(colours);
  const lines = s.screenText();
  const first = lines.findIndex((l) => l.trim() === "Markdown gallery");
  const end = lines.findIndex((l, i) => i > first && /^ {2}end turn\b/.test(l));
  if (first < 0 || end < 0) throw new Error("the gallery is not on screen whole");
  let last = end - 1;
  while (last > first && lines[last]!.trim() === "") last--;
  const byTag = new Map<string, number[]>();
  let tag = PREAMBLE;
  let footnotes: number[] | null = null;
  for (let y = first; y <= last; y++) {
    const m = TAG.exec(lines[y]!);
    if (m) tag = m[1]!;
    // M99 is one paragraph; what follows its blank row is the footnote section.
    if (tag === "M99" && footnotes === null && lines[y]!.trim() === "") footnotes = [];
    if (footnotes !== null) {
      footnotes.push(y);
      continue;
    }
    const list = byTag.get(tag) ?? [];
    list.push(y);
    byTag.set(tag, list);
  }
  const out = new Map<string, string[]>();
  for (const [name, ys] of byTag) {
    const rows = [...ys];
    while (rows.length > 0 && lines[rows[rows.length - 1]!]!.trim() === "") rows.pop();
    if (name === FOOTNOTE_TAG && footnotes) {
      const section = footnotes.filter((y, i) => i > 0 || lines[y]!.trim() !== "");
      while (section.length > 0 && lines[section[0]!]!.trim() === "") section.shift();
      rows.push(-1, ...section);
    }
    out.set(name, rows.map((y, i) => (y < 0 ? `${String(i + 1).padStart(3)} ││` : formatRow(s, y, i + 1, surfaces))));
  }
  return out;
}

export interface GalleryRun {
  readonly run: CliRun;
  readonly dump: Map<string, string[]>;
}

/** Waits until the screen, colours included, stays the same for `quietMs` (highlighting lands
 *  after the text). */
async function settleCells(s: PtySession, colours: AnsweredColours, quietMs = 400): Promise<void> {
  let before = "";
  for (let i = 0; i < 50; i++) {
    await Bun.sleep(quietMs);
    await s.flush();
    const now = [...galleryDump(s, colours).values()].flat().join("\n");
    if (now === before) return;
    before = now;
  }
  throw new Error("the gallery's screen never settled");
}

/** Runs the gallery (sent whole, or streamed in chunks of `chunk` characters) at `cols` x 600
 *  with `colours` answered, and dumps it once the screen has settled. The caller disposes `run`. */
export async function runGallery(cols: number, colours: AnsweredColours, chunk?: number): Promise<GalleryRun> {
  const run = startCli({
    scenario: "markdown-gallery",
    cols,
    rows: SCREEN_ROWS,
    colours,
    ...(chunk === undefined ? {} : { agentArgs: ["--chunk", String(chunk)] }),
  });
  const s = run.session;
  await sendPrompt(s, "go");
  await s.waitFor((p) => p.screenText().some((l) => /^ {2}end turn\b/.test(l)) && READY.test(p.screenText().join("\n")), 120000);
  await settleCells(s, colours);
  return { run, dump: galleryDump(s, colours) };
}

/** A tag's golden file: its dump at each width, the dark and light dumps as one section where
 *  they agree. `dumps` maps `<cols>/<dark|light>` to the dumps per tag. */
export function screenGoldenText(tag: string, widths: readonly number[], dumps: ReadonlyMap<string, Map<string, string[]>>): string {
  const parts = [`${tag} (markdown-gallery), the screen cell by cell; see test/conversation/gallery-screen.ts for the format.`];
  const colourText = (c: OscColours) => `OSC 10 ${c.foreground}, OSC 11 ${c.background}`;
  for (const width of widths) {
    const dark = (dumps.get(`${width}/dark`)?.get(tag) ?? []).join("\n");
    const light = (dumps.get(`${width}/light`)?.get(tag) ?? []).join("\n");
    if (dark === light) {
      parts.push("", `at ${width}x${SCREEN_ROWS}, dark (${colourText(DARK)}) and light (${colourText(LIGHT)}) alike:`, dark);
    } else {
      parts.push("", `at ${width}x${SCREEN_ROWS}, dark (${colourText(DARK)}):`, dark);
      parts.push("", `at ${width}x${SCREEN_ROWS}, light (${colourText(LIGHT)}):`, light);
    }
  }
  return parts.join("\n") + "\n";
}
