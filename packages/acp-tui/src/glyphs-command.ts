// `acp-tui glyphs --test [set]` (mvp-configuration task 7.3, design D9 and D16; spec tui-config
// "Glyph test"). Prints each glyph set's glyphs by name on the main screen, one group per row, so
// the user can see which glyphs the terminal's font draws (tools/glyph-check.py checks the fonts
// themselves). No renderer, no alternate screen and no agent: plain text on stdout, then the exit
// status. A row reads the group (`tool.kind`) and then `suffix glyph` pairs, the full name being the
// group, a dot and the suffix (`tool.kind.read`); a glyph with no group of its own (`thought`) is
// the group alone.
import { GLYPH_NAMES, GLYPH_SET_NAMES, GLYPH_SETS, glyphGroup, type GlyphSetName } from "./conversation/glyphs.ts";

export interface GlyphsIo {
  readonly stdout: { write(text: string): unknown; columns?: number };
  readonly stderr: { write(text: string): unknown };
}

export const GLYPHS_HELP = `Usage: acp-tui glyphs --test [set]

Prints the glyphs of each glyph set (${GLYPH_SET_NAMES.join(", ")}) by name, one group per row, on
the normal screen, so you can see which glyphs your terminal's font draws.
With a set name, only that set. A row is a group (such as tool.kind) and
pairs of a name and its glyph; the full name of a glyph is the group, a
dot and its name (tool.kind.read). Blank glyphs are shown in quotes.
`;

/** A glyph as printed: blank or padded values in quotes, so they can be seen. */
const shown = (glyph: string): string => (glyph === "" || /^\s|\s$|\s\s/.test(glyph) ? JSON.stringify(glyph) : glyph);

/** The rows of one set, each a group and its `name glyph` pairs, wrapped to `columns`. */
export function glyphRows(set: GlyphSetName, columns = 100): string[] {
  const values = GLYPH_SETS[set];
  const groups = new Map<string, string[]>();
  for (const name of GLYPH_NAMES) {
    const group = glyphGroup(name);
    const suffix = name === group ? "" : name.slice(group.length + 1);
    const pair = suffix === "" ? shown(values[name]!) : `${suffix} ${shown(values[name]!)}`;
    groups.set(group, [...(groups.get(group) ?? []), pair]);
  }
  const labelWidth = Math.max(...[...groups.keys()].map((g) => g.length)) + 2;
  const rows: string[] = [];
  for (const [group, pairs] of groups) {
    let line = `  ${group.padEnd(labelWidth)}`;
    let first = true;
    for (const pair of pairs) {
      // Wrap on a pair, never inside one. Width here is only a layout aid, so code units are enough.
      if (!first && line.length + 2 + pair.length > columns) {
        rows.push(line);
        line = `  ${"".padEnd(labelWidth)}`;
        first = true;
      }
      line += first ? pair : `  ${pair}`;
      first = false;
    }
    rows.push(line);
  }
  return rows;
}

/** Runs `acp-tui glyphs ...`; returns the exit status. */
export function runGlyphsCommand(args: readonly string[], io: GlyphsIo): number {
  const wanted: string[] = [];
  let test = false;
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      io.stdout.write(GLYPHS_HELP);
      return 0;
    }
    if (arg === "--test") test = true;
    else if (arg.startsWith("-")) {
      io.stderr.write(`acp-tui: glyphs: unknown option ${arg}\n${GLYPHS_HELP}`);
      return 1;
    } else wanted.push(arg);
  }
  if (!test) {
    io.stderr.write(`acp-tui: glyphs: nothing to do without --test\n${GLYPHS_HELP}`);
    return 1;
  }
  if (wanted.length > 1) {
    io.stderr.write("acp-tui: glyphs: --test takes at most one glyph set\n");
    return 1;
  }
  const sets = wanted.length === 0 ? [...GLYPH_SET_NAMES] : GLYPH_SET_NAMES.filter((s) => s === wanted[0]);
  if (sets.length === 0) {
    io.stderr.write(`acp-tui: glyphs: unknown glyph set '${wanted[0]}'; the sets are ${GLYPH_SET_NAMES.join(", ")}\n`);
    return 1;
  }
  const columns = io.stdout.columns && io.stdout.columns > 20 ? io.stdout.columns : 100;
  const text = sets.map((set) => `${set}\n${glyphRows(set, columns).join("\n")}\n`).join("\n");
  io.stdout.write(text);
  return 0;
}
