// The commented default configuration (mvp-configuration task 9.2, revised after Marcus's reading
// in task 12.7; spec tui-config "Commented default configuration"): what `acp-tui config
// --print-default` prints. A complete `config.jsonc` with every setting at its default, each
// preceded by its description from the schema (schema.ts) and what values it takes, built by
// walking the schema, so it cannot disagree with validation or the JSON Schema.
//
// The output loads without problems and gives exactly the built-in defaults
// (test/config/config-command.test.ts). So a setting with no default, whose absence is its meaning
// (the layout's `margins`, `screen`, `prompt` and `modules`, which keep the default layout's;
// `terminals` entries; key contexts), is shown commented out with the value acp-tui uses without
// it, and objects of names (`agent_servers`, `theme.tokens`, `glyphs.overrides`, `keys`) are
// empty, with commented examples, each introduced as "Example, not active".
//
// Task 12.7 (Marcus, 13 October 2026): the header is in sections with headings; a setting whose
// values each need a meaning (`valueListOf`) prints a heading line and one line per value
// (`"full" - ...`) instead of listing its values twice; and no comment line opens a parenthesis,
// bracket, brace or quoted string that it does not close, because editors check each comment line
// on its own (PhpStorm's grammar inspection reported "Unpaired symbol" for the hard-wrapped
// lines). `comment` keeps such a group on one line, letting the line run past the width when the
// group alone is too long.
import type { z } from "zod";
import { BLOCK_NAMES, DEFAULT_LAYOUT } from "../layout/layout.ts";
import { MODULE_IDS, MODULES } from "../layout/modules.ts";
import { KEY_ACTIONS, KEY_CONTEXTS } from "../keys/keymap.ts";
import { BUILT_IN_HARNESSES } from "../agent/command.ts";
import { AGENT_EXAMPLES, type AgentExample } from "../agent/examples.ts";
import { TERMINAL_TABLE, type TerminalCapabilities } from "../renderer/capabilities.ts";
import { describeSchema } from "./load.ts";
import {
  AgentServerSchema,
  defaultConfig,
  describeOf,
  moduleDescription,
  PILL_NAMES,
  SECTIONS,
  TERMINAL_IDS,
  unwrap,
  valueListOf,
  type SectionName,
  type ValueList,
} from "./schema.ts";

type AnySchema = z.core.$ZodType;
type Def = { type: string; [key: string]: unknown };
const defOf = (schema: AnySchema): Def => (schema as unknown as { def: Def }).def;

/** Comment lines are wrapped to this width, indentation included. */
export const WIDTH = 100;
const STEP = "  ";

const OPENERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set(Object.values(OPENERS));

/**
 * The words of `text` grouped so that no group opens a parenthesis, bracket, brace or double quote
 * it does not close: a group is one word, or the words from an opening symbol to its closing one.
 * Apostrophes are not quotes. Unbalanced text ends in one group running to its end.
 */
export function unbreakableGroups(text: string): string[] {
  const groups: string[] = [];
  let group: string[] = [];
  const stack: string[] = [];
  let quoted = false;
  for (const word of text.split(/\s+/).filter((w) => w !== "")) {
    group.push(word);
    for (const ch of word) {
      if (ch === '"') quoted = !quoted;
      else if (quoted) continue;
      else if (OPENERS[ch]) stack.push(OPENERS[ch]!);
      else if (CLOSERS.has(ch) && stack[stack.length - 1] === ch) stack.pop();
    }
    if (stack.length === 0 && !quoted) {
      groups.push(group.join(" "));
      group = [];
    }
  }
  if (group.length > 0) groups.push(group.join(" "));
  return groups;
}

/**
 * `text` as `//` comment lines at `indent`, wrapped between groups (`unbreakableGroups`); a line
 * break in `text` starts a new line. A paragraph's first line starts with `first`, the lines after
 * it with `hang`.
 */
function comment(text: string, indent: string, hang = "", first = ""): string[] {
  const prefix = `${indent}// `;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    let lead = first;
    for (const group of unbreakableGroups(paragraph)) {
      if (line !== "" && prefix.length + lead.length + line.length + 1 + group.length > WIDTH) {
        lines.push(prefix + lead + line);
        line = group;
        lead = hang;
      } else line = line === "" ? group : `${line} ${group}`;
    }
    lines.push(line === "" ? `${indent}//` : prefix + lead + line);
  }
  return lines;
}

/** A blank comment line, between a header heading and its text. */
const blank = (indent: string): string => `${indent}//`;

/** Lines already in JSONC form, commented out at `indent`. */
const commentedOut = (lines: readonly string[], indent: string): string[] => lines.map((l) => `${indent}// ${l}`);

const json = (value: unknown): string => JSON.stringify(value).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{"/, '{ "').replace(/\}$/, " }").replace(/^\{ \}$/, "{}");

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The object schema of a setting (through wrappers, and the object branch of a union such as
 *  `theme`'s name-or-object), or null when it takes no object of named fields. */
function objectShape(schema: AnySchema): Record<string, AnySchema> | null {
  const inner = unwrap(schema);
  const def = defOf(inner);
  if (def.type === "object") return def["shape"] as Record<string, AnySchema>;
  if (def.type === "union") {
    for (const option of def["options"] as AnySchema[]) {
      const shape = objectShape(option);
      if (shape) return shape;
    }
  }
  return null;
}

/** A value list: the heading, one line per value with its meaning, then the note. `label` names
 *  the setting before the heading (a field of an entry: `"strikethrough" - how ...:`). */
function valueListLines(list: ValueList, indent: string, label?: string): string[] {
  const heading = label === undefined ? `${list.heading}:` : `${label} - ${clause(list.heading)}:`;
  const inner = label === undefined ? "" : STEP;
  return [
    ...comment(heading, indent),
    ...list.values.flatMap(([value, meaning]) => comment(`${JSON.stringify(value)} - ${meaning}`, indent, `${inner}${STEP}`, inner)),
    ...(list.note ? comment(list.note, indent) : []),
  ];
}

/** The comment of a leaf setting: its value list, else its description and what it takes. */
function leafComment(schema: AnySchema, indent: string): string[] {
  const list = valueListOf(schema);
  if (list) return valueListLines(list, indent);
  return comment(`${describeOf(schema) ?? ""} Takes ${describeSchema(schema)}.`.trim(), indent);
}

/** A field of an entry described in its parent's comment: `"name" - what it is`, or its value
 *  list under that label. */
function fieldLines(name: string, schema: AnySchema, indent: string): string[] {
  const label = JSON.stringify(name);
  const list = valueListOf(schema);
  if (list) return valueListLines(list, indent, label);
  return comment(`${label} - ${clause(describeOf(schema))}`, indent, STEP);
}

/** A description as a clause within a sentence: lower-case first letter, no final full stop. */
function clause(description: string | undefined): string {
  const text = (description ?? "").replace(/\.$/, "");
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** `strikethrough` as the setting names a terminal's built-in strikethrough form. */
function strikeMode(c: TerminalCapabilities): "sgr9" | "overlay" | "colour" {
  if (c.sgr9) return "sgr9";
  if (c.combiningStrike) return "overlay";
  return "colour";
}

/** The words that introduce every commented example, so it cannot be mistaken for a setting in
 *  effect. */
export const EXAMPLE = "Example, not active:";

/** What a commented-out default is, for settings whose absence is their meaning. */
const ABSENT = "The default layout's value, shown commented out, applies while this is not set:";

export { AGENT_EXAMPLES };

/** An agent example's entry as one JSONC line. */
function agentLine({ name, entry }: AgentExample): string {
  const env = entry.env ? `, "env": ${json(entry.env)}` : "";
  return `${JSON.stringify(name)}: { "command": ${JSON.stringify(entry.command)}, "args": ${JSON.stringify(entry.args).replace(/","/g, '", "')}${env} },`;
}

type Special = (key: string, schema: AnySchema, indent: string) => string[];

const SPECIALS: Readonly<Record<string, Special>> = {
  agent_servers: (key, schema, indent) => {
    const inner = indent + STEP;
    const fields = objectShape(AgentServerSchema as unknown as AnySchema)!;
    return [
      ...comment(describeOf(schema) ?? "", indent),
      ...comment("Each entry takes:", indent),
      ...(["command", "args", "env"] as const).flatMap((field) => fieldLines(field, fields[field]!, indent)),
      ...comment('The harness runs in the session directory, so give paths in "command" and "args" as absolute paths.', indent),
      ...comment(
        `With no entry, the built-in ${BUILT_IN_HARNESSES.map((h) => `"${h.name}"`).join(" and ")} are the only harnesses. Every entry below is an example, not active: install the harness, then remove the // in front of its line to add it.`,
        indent,
      ),
      `${indent}"${key}": {`,
      ...AGENT_EXAMPLES.flatMap((example, i) => [...(i > 0 ? [""] : []), ...comment(`${EXAMPLE} ${example.about}`, inner), ...commentedOut([agentLine(example)], inner)]),
      `${indent}},`,
    ];
  },

  terminals: (key, schema, indent) => {
    const inner = indent + STEP;
    const entry = objectShape(objectShape(schema)!["default"]!)!;
    const rows = TERMINAL_IDS.map((id) => {
      const row = TERMINAL_TABLE[id];
      return `"${id}": { "wheel_lines": ${row.wheelLines}, "strikethrough": "${strikeMode(row.capabilities)}", "hyperlinks": ${row.capabilities.osc8} },`;
    });
    return [
      ...comment(describeOf(schema) ?? "", indent),
      `${indent}"${key}": {`,
      ...comment(
        "Each terminal's built-in values, which apply without these lines; they are shown commented out. To replace one, uncomment that terminal's line and change the value. Each entry takes:",
        inner,
      ),
      ...(["wheel_lines", "strikethrough", "hyperlinks"] as const).flatMap((field) => fieldLines(field, entry[field]!, inner)),
      ...commentedOut(rows, inner),
      `${indent}},`,
    ];
  },

  "theme.tokens": (key, schema, indent) => [
    ...comment(
      `${describeOf(schema) ?? ""} Each value is an ANSI palette index from 0 to 255, "default", a "#rrggbb" colour, or an object of "color" and the attributes "bold", "dim", "italic" and "underline". Surfaces also take "derived". acp-tui config --print-schema lists every token with what it styles.`,
      indent,
    ),
    `${indent}"${key}": {`,
    ...comment(`${EXAMPLE} blue accents, and warnings in bold yellow.`, indent + STEP),
    ...commentedOut(['"accent": 4,', '"warning": { "color": 3, "bold": true },'], indent + STEP),
    `${indent}},`,
  ],

  "glyphs.overrides": (key, schema, indent) => [
    ...comment(`${describeOf(schema) ?? ""} acp-tui glyphs --test prints every glyph by name.`, indent),
    `${indent}"${key}": {`,
    ...comment(`${EXAMPLE} a triangle as the first-level bullet.`, indent + STEP),
    ...commentedOut(['"list.bullet.1": "▸",'], indent + STEP),
    `${indent}},`,
  ],

  "layout.margins": (key, schema, indent) => [...comment(`${describeOf(schema) ?? ""} ${ABSENT}`, indent), ...commentedOut([`"${key}": ${json(DEFAULT_LAYOUT.margins)},`], indent)],

  "layout.screen": (key, schema, indent) => [
    ...comment(
      `${describeOf(schema) ?? ""} Each region is a block, one of ${BLOCK_NAMES.map((b) => JSON.stringify(b)).join(", ")}; a spacer { "spacer": n }; or a bar { "left": [...], "center": [...], "right": [...] } of module names. ${ABSENT}`,
      indent,
    ),
    ...commentedOut([`"${key}": [`, ...DEFAULT_LAYOUT.screen.map((region) => `${STEP}${json(region)},`), "],"], indent),
  ],

  "layout.prompt": (key, schema, indent) => [
    ...comment(`${describeOf(schema) ?? ""} ${ABSENT} the three pills, and on the right the usage module, drawn there as {used}/{size}.`, indent),
    ...commentedOut([`"${key}": { "pills": ${json(PILL_NAMES)}, "right": ["usage"] },`], indent),
  ],

  "layout.modules": (key, schema, indent) => {
    // Commented out as a whole, each module's description a comment inside it (`// //`), so the
    // block stays valid JSONC when its outer comment marks are removed.
    const inner = `${indent}// ${STEP}`;
    const lines: string[] = [];
    for (const id of MODULE_IDS) {
      const { format, priority, hideWhenEmpty } = MODULES[id].defaults;
      lines.push(...comment(`${JSON.stringify(id)} - ${clause(moduleDescription(id))}.`, inner, STEP));
      lines.push(`${inner}"${id}": { "format": ${JSON.stringify(format)}, "priority": ${priority}, "hide_when_empty": ${hideWhenEmpty} },`);
    }
    return [
      ...comment(`${describeOf(schema) ?? ""} Each module takes "format", "priority" and "hide_when_empty". Each module's defaults, shown commented out, apply while this is not set:`, indent),
      `${indent}// "${key}": {`,
      ...lines,
      `${indent}// },`,
    ];
  },

  keys: (key, schema, indent) => {
    const inner = indent + STEP;
    return [
      ...comment(
        `${describeOf(schema) ?? ""} Keys are written as the key help (F1) shows them, such as "ctrl+q", "shift+tab" or "f3"; actions by their IDs. With no entry, the built-in key map applies. The contexts, each with its actions:`,
        indent,
      ),
      ...KEY_CONTEXTS.flatMap((context) => comment(`${JSON.stringify(context)} - ${KEY_ACTIONS[context].join(", ")}`, indent, STEP)),
      `${indent}"${key}": {`,
      ...comment(`${EXAMPLE} detach moved from ctrl+d to ctrl+q.`, inner),
      ...commentedOut(['"global": { "ctrl+d": null, "ctrl+q": "detach" },'], inner),
      `${indent}},`,
    ];
  },
};

/** The lines of one setting at `indent` (with its comment), its default `value`. */
function setting(path: string, key: string, schema: AnySchema, value: unknown, indent: string): string[] {
  const special = SPECIALS[path];
  if (special) return special(key, schema, indent);
  const shape = objectShape(schema);
  const isRecord = defOf(unwrap(schema)).type === "record";
  if (shape && !isRecord && isPlainObject(value)) {
    const lines = [...comment(describeOf(schema) ?? "", indent), `${indent}"${key}": {`];
    for (const [field, fieldSchema] of Object.entries(shape)) {
      if (field in value || SPECIALS[`${path}.${field}`]) lines.push(...setting(`${path}.${field}`, field, fieldSchema, value[field], indent + STEP));
    }
    lines.push(`${indent}},`);
    return lines;
  }
  return [...leafComment(schema, indent), `${indent}"${key}": ${json(value)},`];
}

/** Where the file is, as the header's first paragraph says it, per platform (tui-config
 *  "Configuration locations on Windows"). */
const LOCATION: Readonly<Record<"posix" | "win32", { readonly file: string; readonly schemaExample: string }>> = {
  posix: {
    file: "This is acp-tui's configuration file: $XDG_CONFIG_HOME/acp-tui/config.jsonc, or ~/.config/acp-tui/config.jsonc when XDG_CONFIG_HOME is not set.",
    schemaExample: "file:///home/you/.config/acp-tui/config.schema.json",
  },
  win32: {
    file: "This is acp-tui's configuration file: %APPDATA%\\acp-tui\\config.jsonc, or $XDG_CONFIG_HOME\\acp-tui\\config.jsonc when XDG_CONFIG_HOME is set.",
    schemaExample: "file:///C:/Users/you/AppData/Roaming/acp-tui/config.schema.json",
  },
};

export type FileHeader = readonly { readonly heading: string; readonly paragraphs: readonly string[] }[];

/** The header: a title, then sections, each a heading and its paragraphs (task 12.7), naming the
 *  platform's location. */
export function defaultFileHeader(platform: NodeJS.Platform = process.platform): FileHeader {
  const location = LOCATION[platform === "win32" ? "win32" : "posix"];
  return [
    {
      heading: "acp-tui configuration",
      paragraphs: [
        `${location.file} acp-tui config --path shows where acp-tui looks for it. It is JSONC: JSON that allows comments and trailing commas.`,
      ],
    },
    {
      heading: "Making changes",
      paragraphs: [
        "Lines that are not commented out are in effect. Each holds its setting's built-in default, so this file as printed changes nothing: acp-tui behaves as it does with no file. Edit a value to change that setting.",
        'Lines commented out with // are not in effect. Some show the value acp-tui uses while a setting is absent: uncomment one and change it to replace that value. The others are examples, each introduced by "Example, not active": uncomment one to use it.',
        "Delete whatever you do not need: a setting that is absent keeps its default.",
      ],
    },
    {
      heading: "Validating changes",
      paragraphs: [
        "acp-tui config --check checks this file and the project file of the current directory. It prints each problem with its line and column, and exits with status 1 if there is an error, or 0 if there are only warnings or no problems.",
        'A running acp-tui reports problems too: "config N" in the status row, and every problem in full under "Configuration problems" in the command palette (ctrl+p, or ? in an empty prompt box). A setting with a wrong value keeps its last good value; an unknown name is only a warning, and is ignored.',
      ],
    },
    {
      heading: "Live reload",
      paragraphs: [
        "A running acp-tui reloads this file within a second of a save, and most changes apply at once. Two apply later: agent_servers and default_agent_server from the next session you start, and terminals.<id>.hyperlinks from the next start of acp-tui.",
        "The command-line options --mouse, --wheel-lines, --exit-print and --clipboard win over this file for the run they are given in.",
      ],
    },
    {
      heading: "Project files",
      paragraphs: [
        "A project may have its own .acp-tui.jsonc, which applies over this file for sessions in that project. acp-tui reads the nearest one, from the session directory up to the root of its git work tree. It takes the same settings, except agent_servers, default_agent, clipboard, terminals, and the keys of the card and elicitation contexts.",
      ],
    },
    {
      heading: "Editor completion",
      paragraphs: [
        `For completion and checking in an editor, save the JSON Schema that acp-tui config --print-schema prints, and name it in a "$schema" key at the top of this file, such as "$schema": "${location.schemaExample}". acp-tui ignores "$schema".`,
      ],
    },
  ];
}

/** The header on Linux and macOS. */
export const DEFAULT_FILE_HEADER: FileHeader = defaultFileHeader("linux");

/** The header as comment lines: each heading with a blank comment line after it, and one between
 *  sections. */
function headerLines(platform: NodeJS.Platform): string[] {
  const lines: string[] = [];
  defaultFileHeader(platform).forEach(({ heading, paragraphs }, i) => {
    if (i > 0) lines.push(blank(""));
    lines.push(...comment(heading, ""), blank(""));
    for (const paragraph of paragraphs) lines.push(...comment(paragraph, ""));
  });
  return lines;
}

/** The commented default configuration file; its header names `platform`'s location. */
export function commentedDefault(platform: NodeJS.Platform = process.platform): string {
  const defaults = defaultConfig() as unknown as Record<SectionName, unknown>;
  const lines: string[] = [...headerLines(platform), "{"];
  (Object.keys(SECTIONS) as SectionName[]).forEach((section, i) => {
    if (i > 0) lines.push("");
    lines.push(...setting(section, section, SECTIONS[section] as unknown as AnySchema, defaults[section], STEP));
  });
  lines.push("}");
  return `${lines.join("\n")}\n`;
}
