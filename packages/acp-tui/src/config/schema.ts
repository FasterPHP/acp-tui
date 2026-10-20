// The configuration schema (mvp-configuration design D1, D2 and D4; spec
// tui-config "Configuration schema"). One zod 4 schema holds every setting with
// its type, allowed values, default and description, so validation, the
// defaults, the generated JSON Schemas (`schema/config.schema.json`,
// `schema/theme.schema.json`), `config --print-default` and the user guide all
// come from here and cannot disagree.
//
// Rules for adding a setting:
//
// - Put it in the section it belongs to (a top-level key of `SECTIONS`), or add
//   a section. Every setting, nested ones included, carries a description
//   (`.describe(...)`, after `.default(...)` is fine: `describeOf` looks
//   through the wrappers), and a default unless "unset" is its meaning.
// - Classify it for the per-project file in `PROJECT_FILE_RULES` (design D4):
//   the type of that table makes a new section a compile error until it is
//   classified, and `test/config/schema.test.ts` checks every rule.
// - Sections are the unit of "keep the last good value" (design D3): a value
//   that fails validation rejects its whole top-level section. Checks that zod's
//   types cannot express belong in the section's `superRefine`, so they reject
//   the section the same way and are reported with a line and column.
// - Objects are zod's default (non-strict) objects: an unknown name in them is
//   a warning with a suggestion, found by the loader, and ignored. Use
//   `z.strictObject` only where an unknown name must be an error.
//
// The effective configuration (`Config`) is plain data: no functions, no
// native resources, so it can be compared, logged and printed.
import { z } from "zod";
import { BLOCK_NAMES, CONVERSATION_MIN_ROWS, DEFAULT_CONVERSATION_MIN_ROWS, MARGIN_ROWS, SPACER_ROWS } from "../layout/layout.ts";
import { configLayoutErrors } from "../layout/from-config.ts";
import { MODULE_IDS, MODULES, type ModuleId } from "../layout/modules.ts";
import { templateFields } from "../layout/template.ts";
import { DEFAULT_TITLE_FORMAT, titleFormatIssue, titlePlaceholderList } from "../renderer/title-format.ts";
import { KEY_ACTIONS, KEY_CONTEXTS, type KeyContext } from "../keys/keymap.ts";
import { BUILT_IN_AGENT_NAME } from "../agent/command.ts";
import { CLIPBOARD_MODES, EXIT_PRINTS, MOUSE_POLICIES } from "../renderer/options.ts";
import { TERMINAL_IDS, type TerminalId } from "../renderer/terminal-ids.ts";
import { suggest } from "./problems.ts";
import { retiredReplacement, TOKEN_NAMES, TOKENS, type TokenName } from "../theme/tokens.ts";

// -- Shared pieces ------------------------------------------------------------------------------

/** A whole number from `min` (to `max`). */
const whole = (min: number, max?: number) => (max === undefined ? z.int().min(min) : z.int().min(min).max(max));

/** Theme names are names, never paths (design D4): a project file reads no file outside the
 *  themes directory. */
export const THEME_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ThemeName = z.string().regex(THEME_NAME_PATTERN, "a theme name: letters, digits, '.', '_' and '-', no path");

export const GLYPH_SETS = ["unicode", "ascii", "nerd-font"] as const;
export type GlyphSetName = (typeof GLYPH_SETS)[number];

/** Terminal IDs of the per-terminal table (design D12), shared with `renderer/capabilities.ts`. */
export { TERMINAL_IDS, type TerminalId };

export const STRIKE_MODES = ["sgr9", "overlay", "colour"] as const;
export const DENSITIES = ["compact", "verbose", "focus"] as const;
export const CODE_WRAPS = ["word", "prose", "column"] as const;
export const INTERRUPT_MODES = ["double", "single"] as const;
export const ATTENTION_SIGNALS = ["bell", "osc9", "osc777", "none"] as const;
export const BUSY_STYLES = ["gap", "colour", "border"] as const;
export const PILL_NAMES = ["mode", "model", "thought_level"] as const;
export const PROMPT_CURSORS = ["bar", "block", "block_at_end"] as const;

// -- Theme tokens (spec tui-theme "Token values in a theme"; the names are the catalogue of
//    `src/theme/tokens.ts`, so the JSON Schema completes them and this file never lists them) -----

const HEX = /^#[0-9a-fA-F]{6}$/;
const Hex = z.string().regex(HEX, "a #rrggbb colour").describe("a \"#rrggbb\" colour");
const TextColour = z
  .union([whole(0, 255), z.literal("default"), Hex])
  .describe("An ANSI palette index from 0 to 255, \"default\" (the terminal's own foreground) or a \"#rrggbb\" colour.");
const SurfaceColour = z
  .union([whole(0, 255), z.literal("default"), z.literal("derived"), Hex])
  .describe("An ANSI palette index from 0 to 255, \"default\" (the terminal's own background), \"derived\" (from the terminal's colours) or a \"#rrggbb\" colour.");

/** A token's style: a colour and only the safe attributes (spec tui-theme "Token values in a
 *  theme"). Strict, so any other attribute (`strikethrough`, `blink`) is an error, not a warning. */
const tokenStyle = (colour: typeof TextColour | typeof SurfaceColour) =>
  z
    .strictObject({
      color: colour.optional().describe("The token's colour; omitted keeps the colour it would otherwise have."),
      bold: z.boolean().optional().describe("Bold text."),
      dim: z.boolean().optional().describe("Dim (faint) text."),
      italic: z.boolean().optional().describe("Italic text."),
      underline: z.boolean().optional().describe("Underlined text."),
    })
    .describe("A colour with the safe text attributes bold, dim, italic and underline.");

/** A text token's value: a colour, or a colour with attributes; never `derived`. */
export const TextTokenValueSchema = z.union([TextColour, tokenStyle(TextColour)]).meta({ id: "textTokenValue", description: "A colour, or a colour with text attributes." });
/** A surface token's value: as a text token's, or `derived`. */
export const SurfaceTokenValueSchema = z.union([SurfaceColour, tokenStyle(SurfaceColour)]).meta({ id: "surfaceTokenValue", description: "A colour (or \"derived\"), or a colour with text attributes." });
/** The value schema of one token by its role. */
export const tokenValueSchema = (name: TokenName) => (TOKENS[name].role === "bg" ? SurfaceTokenValueSchema : TextTokenValueSchema);

/**
 * Token values by name: every catalogue token is a property (so an editor completes the names and
 * shows what each one styles), and any other name is reported by the check below: a retired token
 * with its replacement, another with the closest known name. Errors reject the section (design D3);
 * a theme file is checked token by token instead (src/theme/theme-file.ts).
 */
export const TokensSchema = z
  .object(Object.fromEntries(TOKEN_NAMES.map((name) => [name, tokenValueSchema(name).optional().describe(TOKENS[name].use)])) as Record<TokenName, z.ZodOptional<typeof TextTokenValueSchema>>)
  .catchall(z.unknown())
  .superRefine((tokens, ctx) => {
    for (const name of Object.keys(tokens)) {
      const problem = tokenNameProblem(name);
      if (problem) ctx.addIssue({ code: "custom", message: problem, path: [name] });
    }
  })
  .describe("Token values by token name (the catalogue of spec tui-theme \"Theme tokens, never literal colours\").");

/** Why a token name cannot be set, or null when it is a catalogue token. */
export function tokenNameProblem(name: string): string | null {
  if (Object.hasOwn(TOKENS, name)) return null;
  const replacement = retiredReplacement(name);
  if (replacement) return `is retired: use ${replacement}`;
  const close = suggest(name, TOKEN_NAMES);
  return `is not a known token${close ? ` (did you mean ${close}?)` : ""}`;
}

const SurfaceContrast = z
  .number()
  .min(0.5)
  .max(2)
  .describe("Scales every derived surface's lightness step from the background, within the 40 per cent cap: 1 is the default step, and 1.2 makes cards stronger.");

/** A theme file, `themes/<name>.jsonc` (design D7); its JSON Schema is `schema/theme.schema.json`. */
export const ThemeFileSchema = z
  .object({
    $schema: z.string().optional().describe("Ignored; lets an editor find the theme file's JSON Schema."),
    extends: ThemeName.optional().describe("Another theme this one starts from (the built-in \"default\" at the root)."),
    surface_contrast: SurfaceContrast.optional(),
    tokens: TokensSchema.optional(),
    light: z.object({ tokens: TokensSchema.optional() }).optional().describe("Tokens applied over `tokens` when the terminal reports a light background."),
    dark: z.object({ tokens: TokensSchema.optional() }).optional().describe("Tokens applied over `tokens` when the terminal reports a dark background."),
  })
  .describe("An acp-tui theme file.");

// -- Value lists --------------------------------------------------------------------------------

/**
 * A setting whose values each need a meaning (task 12.7, Marcus's reading): a heading, one line
 * per value and an optional note after them. The commented default prints it as
 *
 *     // Mouse policy:
 *     // "full" - acp-tui handles clicks, drags and the wheel ...
 *
 * and the setting's description (the JSON Schema, the user guide) is the same text run together
 * (`valueListText`), so each value is listed once with its meaning, never twice.
 */
export interface ValueList {
  readonly heading: string;
  /** Each allowed value with what it means, in the order of the setting's enumeration. */
  readonly values: readonly (readonly [value: string, meaning: string])[];
  readonly note?: string;
}

const VALUE_LISTS = new WeakMap<object, ValueList>();

/** A value list as one description: `Heading: "a" - meaning; "b" - meaning. Note.` */
export function valueListText(list: ValueList): string {
  const values = list.values.map(([value, meaning]) => `${JSON.stringify(value)} - ${meaning}`).join("; ");
  return `${list.heading}: ${values}.${list.note ? ` ${list.note}` : ""}`;
}

/** `schema` described by a value list (its description is `valueListText(list)`). */
function listed<S extends z.ZodType>(schema: S, list: ValueList): S {
  const described = schema.describe(valueListText(list)) as S;
  VALUE_LISTS.set(described, list);
  return described;
}

// -- Sections -----------------------------------------------------------------------------------

const AgentServer = z
  .object({
    command: z.string().min(1).describe("The program to run (looked up on the PATH when it has no slash)."),
    args: z.array(z.string()).default([]).describe("Its arguments."),
    env: z.record(z.string(), z.string()).default({}).describe("Environment variables added to acp-tui's own for the harness."),
    // Zed writes `"type": "custom"` on the agents it runs from a command (design 6.8: entries copy
    // across from Zed's settings), so the key is accepted and ignored rather than reported.
    type: z.literal("custom").optional().describe("Ignored; Zed's entry type, so entries copied from Zed's settings load unchanged."),
  })
  .describe("A harness in Zed's shape (Zed calls it an agent server): command, args and env.");

export const AgentServerSchema = AgentServer;

const ThemeObject = z
  .object({
    name: ThemeName.default("default").describe("The theme: \"default\" (built in) or a file themes/<name>.jsonc in the configuration directory."),
    flat: z.boolean().default(false).describe("Always draw the flat style (no background fills; cards by their frames), whatever the terminal answers."),
    // Multiplies the theme file's own `surface_contrast` (design D7), so the default 1 leaves a
    // theme's choice as it is.
    surface_contrast: SurfaceContrast.default(1).describe(
      "Scales every derived surface's lightness step from the background, within the 40 per cent cap: 1 is the default step, and 1.2 makes cards stronger. Multiplies a theme file's own surface_contrast.",
    ),
    tokens: TokensSchema.default({}).describe("Token values applied over the theme, last."),
  })
  .describe("The theme: its name, the flat style, the surface contrast and inline token values.");

const GlyphsObject = z
  .object({
    set: listed(z.enum(GLYPH_SETS).default("unicode"), {
      heading: "The glyph set",
      values: [
        ["unicode", "symbols that common terminal fonts have"],
        ["ascii", "plain ASCII characters only"],
        ["nerd-font", "Nerd Font icons for tool kinds and statuses, which needs a Nerd Font in the terminal"],
      ],
    }),
    overrides: z.record(z.string(), z.string()).default({}).describe("Single glyphs replaced by name, such as \"list.bullet.1\": \"▸\"."),
  })
  .describe("The glyph set and per-glyph overrides.");

const TerminalEntry = z
  .object({
    wheel_lines: whole(1).optional().describe("Rows scrolled per wheel event in this terminal."),
    // Quoted, and the modes not named after the attribute: strike.test.ts keeps the attribute to
    // the one file that draws it.
    "strikethrough": listed(z.enum(STRIKE_MODES).optional(), {
      heading: "How struck-through text is drawn",
      values: [
        ["sgr9", "the terminal's own line through the text"],
        ["overlay", "a combining stroke character, U+0336, after each character"],
        ["colour", "no line: struck text is told apart by its colour and italic"],
      ],
    }),
    hyperlinks: z.boolean().optional().describe("Whether links are written as OSC 8 hyperlinks, which the terminal makes clickable; applies from the next start."),
  })
  .describe("Values replacing the built-in ones for this terminal; unset values keep the built-in ones.");

const ModuleName = z.enum(MODULE_IDS);
const ModuleList = z.array(ModuleName);
const BarRegion = z
  .strictObject({
    left: ModuleList.optional().describe("Modules on the bar's left."),
    center: ModuleList.optional().describe("Modules in the bar's centre."),
    right: ModuleList.optional().describe("Modules on the bar's right."),
  })
  .describe("A bar: module lists on the left, centre and right.");
const SpacerRegion = z.strictObject({ spacer: whole(SPACER_ROWS.min, SPACER_ROWS.max).describe("Blank rows.") }).describe("Blank rows between two regions.");
const Region = z
  .union([z.enum(BLOCK_NAMES), SpacerRegion, BarRegion])
  .describe("A block (conversation, activity, card, prompt, find), a spacer or a bar.");

const ModuleSettingsEntry = z
  .strictObject({
    format: z.string().optional().describe("A template of the module's fields in braces, such as \"dir {basename}\"."),
    priority: z.int().optional().describe("Higher numbers are kept longer when a bar does not fit."),
    hide_when_empty: z.boolean().optional().describe("Hide the module while its fields are empty."),
  })
  .describe("A module's format, priority and hide_when_empty.");

/** What each module shows, for its entry's description (the commented default, the JSON Schema
 *  and the user guide; task 6.2). Its fields and defaults are added from the module registry. */
const MODULE_PURPOSES: Readonly<Record<ModuleId, string>> = {
  agent: "The harness's name and version.",
  model: "The model in use.",
  mode: "The agent's mode.",
  cwd: "The session directory: {cwd} and {path} with ~ for home, {basename} its last component.",
  connection: "The connection to the harness.",
  "turn-state": "The turn's state: idle, running with the time, requires_action, loading or an armed key; its format must keep {state}.",
  usage: "The context window used and its size.",
  cost: "The session's cost, as the agent reports it.",
  hints: "Key hints for what can be done now.",
  mouse: "The mouse policy, while it is not full.",
  density: "The conversation's density, while it differs from the density setting.",
  position: "How far the conversation is scrolled, while it does not follow the end.",
  config: "How many configuration problems there are, while there are any.",
  text: "Fixed text: its format, with no fields.",
};

/** A module's fields as its format may name them: `{cwd}, {path}, {basename}`; `none`. */
export function moduleFieldList(id: ModuleId): string {
  const fields = MODULES[id].fields;
  return fields.length === 0 ? "none" : fields.map((f) => `{${f}}`).join(", ");
}

/** The description of a module's entry under `layout.modules`: what it shows, its fields, and its
 *  default format and priority. `config --print-default` (task 9.2) lists each module with it. */
export function moduleDescription(id: ModuleId): string {
  const { format, priority } = MODULES[id].defaults;
  return `${MODULE_PURPOSES[id]} Fields: ${moduleFieldList(id)}. Default format ${JSON.stringify(format)}, priority ${priority}.`;
}

/** The problems with configured module formats: a field the module does not have (spec tui-layout
 *  "Module settings from the configuration"). */
function moduleFormatIssues(modules: Partial<Record<ModuleId, { format?: string | undefined }>> | undefined): { id: ModuleId; message: string }[] {
  const out: { id: ModuleId; message: string }[] = [];
  for (const id of MODULE_IDS) {
    const format = modules?.[id]?.format;
    if (format === undefined) continue;
    let fields: string[];
    try {
      fields = templateFields(format);
    } catch (error) {
      out.push({ id, message: `is not a valid format: ${(error as Error).message}` });
      continue;
    }
    const unknown = fields.filter((f) => !MODULES[id].fields.includes(f));
    if (unknown.length > 0) {
      const named = unknown.map((f) => `{${f}}`).join(", ");
      out.push({ id, message: `names ${named}, which ${id} does not have; the fields of ${id} are ${moduleFieldList(id)}` });
    }
  }
  return out;
}

const LayoutSection = z
  .object({
    margins: z
      .strictObject({
        top: whole(MARGIN_ROWS.min, MARGIN_ROWS.max).optional().describe("Blank rows above everything (1 to 3)."),
        bottom: whole(MARGIN_ROWS.min, MARGIN_ROWS.max).optional().describe("Blank rows below everything (1 to 3)."),
      })
      .optional()
      .describe("The top and bottom margins; omitted ones keep the default layout's."),
    screen: z.array(Region).optional().describe("The regions from top to bottom; omitted keeps the default layout's."),
    prompt: z
      .object({
        pills: z.array(z.enum(PILL_NAMES)).optional().describe("The pills in the prompt box's bottom border, in order: mode, model, thought_level. The model pill also shows a harness's older model state, as Auggie reports its models."),
        right: ModuleList.optional().describe("Modules on the right of the prompt box's bottom border."),
      })
      .optional()
      .describe("The prompt box's bottom border; omitted parts keep the default layout's."),
    modules: z
      .strictObject(Object.fromEntries(MODULE_IDS.map((id) => [id, ModuleSettingsEntry.optional().describe(moduleDescription(id))])) as Record<ModuleId, z.ZodOptional<typeof ModuleSettingsEntry>>)
      .optional()
      .describe("Module settings by module name; each applies wherever the module appears."),
    conversation_min_rows: whole(CONVERSATION_MIN_ROWS.min, CONVERSATION_MIN_ROWS.max)
      .default(DEFAULT_CONVERSATION_MIN_ROWS)
      .describe("Conversation rows kept when the prompt box's resting height is chosen."),
    scrollbar: z.boolean().default(true).describe("Draw the conversation's scroll bar."),
  })
  .superRefine((layout, ctx) => {
    // A format naming a field its module does not have (spec tui-layout "Module settings from the
    // configuration"), at the format itself.
    const formats = moduleFormatIssues(layout.modules);
    for (const { id, message } of formats) ctx.addIssue({ code: "custom", message, path: ["modules", id, "format"] });
    if (formats.length > 0) return;
    // "Layout validation" (spec tui-layout) over the layout as it would be used: omitted parts keep
    // the default layout's (design D11). Every failure is named; the section keeps its last good
    // value (design D3), so the layout in use is unchanged. One problem naming them all, since the
    // loader reports one problem per place.
    const errors = configLayoutErrors(layout);
    const at = layout.screen !== undefined ? "screen" : layout.margins !== undefined ? "margins" : layout.prompt !== undefined ? "prompt" : "modules";
    if (errors.length > 0) ctx.addIssue({ code: "custom", message: `is not a valid layout: ${errors.join("; ")}`, path: [at] });
  }, { when: (payload) => payload.issues.length === 0 })
  .describe("The screen layout: margins, regions, the prompt box's border, module settings, the conversation's row floor and scroll bar.");

/** A context's bindings. The action names are enumerated from the command catalogue (`KEY_ACTIONS`,
 *  mvp-chrome-and-keys design D16; task 8.4) in the JSON Schema only, through metadata, so an
 *  editor completes them; the loader takes any string and the key map checks each entry on its own
 *  (src/keys/overrides.ts), so one unknown action rejects that binding, not the whole `keys`
 *  section (spec tui-keymap "Key override validation"). */
const keyBindings = (context: KeyContext) =>
  z
    .record(z.string(), z.string().meta({ enum: [...KEY_ACTIONS[context]] }).nullable())
    .describe(`Keys of the ${context} context, each mapped to one of its actions or to null to remove the binding. Its actions: ${KEY_ACTIONS[context].join(", ")}.`);
const KeysSection = z
  .object(Object.fromEntries(KEY_CONTEXTS.map((context) => [context, keyBindings(context).optional()])) as Record<KeyContext, z.ZodOptional<ReturnType<typeof keyBindings>>>)
  .describe("Key bindings by context, over the built-in key map: a key replaces that key's default binding in the context; null removes it.");

/** The top-level sections, each the unit of "keep the last good value" (design D3). */
export const SECTIONS = {
  agent_servers: z
    .record(z.string(), AgentServer)
    .default({})
    .describe("Harnesses by name (Zed calls them agent servers, hence the key), launched with a harness name or --harness <name>. Entries have Zed's shape, so they copy across from Zed's settings. Read only from the user's own file, never from a project file."),
  default_agent_server: z.string().min(1).default(BUILT_IN_AGENT_NAME).describe("The harness launched without a harness name or command: \"claude\" (built in) or the name of an agent_servers entry. The older name default_agent is still accepted."),
  mouse: listed(z.enum(MOUSE_POLICIES).default("full"), {
    heading: "Mouse policy",
    values: [
      ["full", "acp-tui handles clicks, drags and the wheel, and Shift+drag selects text in the terminal"],
      ["wheel", "acp-tui handles only the wheel, and clicks and drags do nothing"],
      ["off", "the terminal keeps the mouse: a drag selects its text, and the wheel does nothing in acp-tui"],
    ],
    note: "F2 switches between this policy and \"off\" while acp-tui runs.",
  }),
  wheel_lines: whole(1).nullable().default(null).describe("Rows scrolled per wheel event in every terminal; null uses the per-terminal table."),
  terminals: z
    .object(Object.fromEntries(TERMINAL_IDS.map((id) => [id, TerminalEntry.optional()])) as Record<TerminalId, z.ZodOptional<typeof TerminalEntry>>)
    .default({})
    .describe("Per-terminal values (jetbrains, zed, ghostty, kitty, wezterm, iterm2, windows-terminal, default) over the built-in table: wheel_lines, strikethrough and hyperlinks."),
  exit: z
    .object({
      print: listed(z.enum(EXIT_PRINTS).default("summary"), {
        heading: "What is printed below the command line on exit",
        values: [
          ["summary", "the command that resumes the session, when it can be resumed"],
          ["none", "nothing"],
          ["last-answer", "that command, then the agent's last answer as plain text"],
          ["transcript", "that command, then the whole conversation as plain text"],
        ],
      }),
    })
    .prefault({})
    .describe("What happens on exit."),
  clipboard: listed(z.enum(CLIPBOARD_MODES).default("auto"), {
    heading: "Where copied text goes",
    values: [
      ["auto", "the system clipboard, else through the terminal by OSC 52"],
      ["host", "only the system clipboard (Wayland or X11 on Linux, the pasteboard on macOS, the Windows clipboard)"],
      ["osc52", "only through the terminal by OSC 52, which also works over SSH"],
      ["none", "nowhere: copying is turned off"],
    ],
  }),
  selection: z
    .object({ copy_on_release: z.boolean().default(true).describe("Releasing a drag copies the selection; with false the selection stays highlighted until it is copied with Ctrl+C.") })
    .prefault({})
    .describe("Selection behaviour."),
  prompt: z
    .object({
      cursor: listed(z.enum(PROMPT_CURSORS).default("block_at_end"), {
        heading: "The shape of the cursor in the prompt box",
        values: [
          ["block_at_end", "a bar inside the text and a block after its end, so the terminal's hollow unfocused block shows when the cursor is at the end"],
          ["bar", "a bar everywhere"],
          ["block", "a block everywhere"],
        ],
        note: "Where the terminal reports focus (Zed), the terminal's default cursor is shown while another window has focus.",
      }),
    })
    .prefault({})
    .describe("The prompt box."),
  density: listed(z.enum(DENSITIES).default("focus"), {
    heading: "How much of the conversation a session starts by showing",
    values: [
      ["compact", "one line per tool call, thought or plan, runs of reads and searches grouped, failures included"],
      ["verbose", "everything expanded, nothing grouped"],
      ["focus", "each turn's tool calls, thoughts and plans behind one line, leaving the messages"],
    ],
    note: "The v key in the conversation cycles them.",
  }),
  interrupt: listed(z.enum(INTERRUPT_MODES).default("double"), {
    heading: "How Esc interrupts a running turn",
    values: [
      ["double", "the first Esc arms the interrupt and a second Esc cancels the turn"],
      ["single", "one Esc cancels the turn"],
    ],
  }),
  attention: z
    .object({
      signal: listed(z.enum(ATTENTION_SIGNALS).default("bell"), {
        heading: "How acp-tui asks for attention when a permission request opens or a long turn ends",
        values: [
          ["bell", "the terminal bell"],
          ["osc9", "a desktop notification, in terminals that support OSC 9"],
          ["osc777", "a desktop notification, in terminals that support OSC 777"],
          ["none", "nothing"],
        ],
      }),
      long_turn_seconds: whole(1).default(30).describe("A turn longer than this many seconds is signalled when it ends."),
    })
    .prefault({})
    .describe("Attention signals while the pane is unfocused."),
  busy: z
    .object({
      track_percent: whole(5, 50).default(40).describe("The share of the prompt box's top border, in per cent, that the busy indicator's track takes; at least 10 cells."),
      style: listed(z.enum(BUSY_STYLES).default("gap"), {
        heading: "How the busy indicator's moving segment is drawn",
        values: [
          ["gap", "a moving gap in the border's line, drawn in blank cells"],
          ["colour", "the heavy line in the busy token's colour"],
          ["border", "the heavy line in the frame's own colour"],
        ],
        note: "While the session waits for you, every style stands still as the heavy line in the warning colour.",
      }),
    })
    .prefault({})
    .describe("The busy indicator."),
  activity: z
    .object({
      linger_seconds: z
        .number()
        .min(0)
        .max(5)
        .default(1.5)
        .describe("How many seconds the activity line shows the finished call muted, after the last tool call in progress finishes while the turn still runs, before it goes blank (the line keeps its row either way); 0 turns the linger off."),
    })
    .prefault({})
    .describe("The activity bar."),
  title: z
    .object({
      format: z
        .string()
        .superRefine((format, ctx) => {
          const issue = titleFormatIssue(format);
          if (issue !== null) ctx.addIssue({ code: "custom", message: issue });
        })
        .default(DEFAULT_TITLE_FORMAT)
        .describe(
          `The terminal title, a template over ${titlePlaceholderList()}: the session directory's name, a counter that is empty for the first acp-tui instance showing that name and " 2", " 3" and so on for the next ones, the agent's name and the agent's session title (empty until it sends one). Literal text directly before an empty placeholder is dropped with it. The default is ${JSON.stringify(DEFAULT_TITLE_FORMAT)}; "acp-tui | {title}" gives the agent's title.`,
        ),
    })
    .prefault({})
    .describe("The terminal title (the tab's name in an IDE terminal)."),
  markdown: z
    .object({
      heading_markers: z.boolean().default(false).describe("Show a heading's # markers, muted, before its text."),
      table_min_column_width: whole(3).default(10).describe("The column width below which a table switches to the record layout."),
      code_wrap: listed(z.enum(CODE_WRAPS).default("word"), {
        heading: "How long lines in code blocks break",
        values: [
          ["word", "at the last space that fits, in every block"],
          ["prose", "at spaces in text, txt, plaintext, plain, markdown and md blocks only, and at the column elsewhere"],
          ["column", "at the column, mid-word, in every block"],
        ],
        note: "A word longer than a row always breaks at the column. A broken row of a code block ends with the continuation mark; a prose block shows none, unless the value is column.",
      }),
    })
    .prefault({})
    .describe("Markdown rendering."),
  tool_output: z
    .object({ snippet_rows: whole(3).default(10).describe("Rows of a tool call's output shown in its expanded card.") })
    .prefault({})
    .describe("Tool call output."),
  cards: z
    .object({
      padding: z
        .object({
          rows: whole(0, 1).default(1).describe("Blank rows at the top and the bottom of a card (a user message, an expanded thought, tool call or plan, the permission and question cards) and of a code block in an agent's answer: 0 or 1."),
          columns: whole(1, 3).default(2).describe("Blank columns between a card's edge and its content, on both sides, and the same inset in a code block in an agent's answer: 1 to 3."),
        })
        .prefault({})
        .describe("The padding inside a card's fill."),
    })
    .prefault({})
    .describe("Cards: the user's messages, the expanded thoughts, tool calls and plans, and the permission and question cards; code blocks in an agent's answer take the same padding."),
  theme: z
    .union([ThemeName.transform((name) => ThemeObject.parse({ name })), ThemeObject])
    .prefault({})
    .describe("The theme, as a name or an object of name, flat, surface_contrast and tokens."),
  glyphs: z
    .union([z.enum(GLYPH_SETS).transform((set) => GlyphsObject.parse({ set })), GlyphsObject])
    .prefault({})
    .describe("The glyph set, as a name or an object of set and overrides."),
  layout: LayoutSection.prefault({}),
  keys: KeysSection.default({}),
} as const;

export type SectionName = keyof typeof SECTIONS;
export const SECTION_NAMES = Object.keys(SECTIONS) as SectionName[];

/** The configuration file's schema (`config.jsonc`, `.acp-tui.jsonc`). `$schema` is accepted and
 *  ignored (spec tui-config "Configuration schema"). */
export const ConfigSchema = z
  .object({
    $schema: z.string().optional().describe("Ignored; lets an editor find the configuration's JSON Schema."),
    ...SECTIONS,
  })
  .describe("acp-tui configuration (config.jsonc, or a project's .acp-tui.jsonc).");

/** The effective configuration: every section with its defaults filled in; plain data. */
export type Config = Omit<z.output<typeof ConfigSchema>, "$schema">;
export type LayoutConfig = Config["layout"];
export type ThemeConfig = Config["theme"];
export type GlyphsConfig = Config["glyphs"];
export type AgentServerConfig = z.output<typeof AgentServer>;

/** The built-in defaults, as a fresh object. */
export function defaultConfig(): Config {
  const { $schema: _ignored, ...config } = ConfigSchema.parse({});
  return config;
}

// -- The per-project file (design D4) ------------------------------------------------------------

/**
 * Whether a project file may set a setting: `allowed`, `{ denied: reason }`, or per entry for an
 * object section (`entries` by key, `otherwise` for the rest).
 */
export type ProjectRule =
  | "allowed"
  | { readonly denied: string }
  | { readonly entries: Readonly<Record<string, ProjectRule>>; readonly otherwise: ProjectRule };

const AGENTS_DENIED = "a project file cannot run anything, so it cannot define or choose harnesses";
const CARD_KEYS_DENIED = "a project file cannot bind the keys that answer a permission request or a question";

/** Design D4: the deny-list, each entry with its reason; everything else is presentation and
 *  behaviour, which a project file may set. Typed over every section, so a new section does not
 *  compile until it is classified. */
export const PROJECT_FILE_RULES: { readonly [K in SectionName | "$schema"]: ProjectRule } = {
  $schema: "allowed",
  agent_servers: { denied: AGENTS_DENIED },
  default_agent_server: { denied: AGENTS_DENIED },
  mouse: "allowed",
  wheel_lines: "allowed",
  terminals: { denied: "a project file cannot change what the terminal is trusted to draw (OSC 8 links, strikethrough)" },
  exit: "allowed",
  clipboard: { denied: "a project file cannot decide where copied text goes" },
  selection: "allowed",
  prompt: "allowed",
  density: "allowed",
  interrupt: "allowed",
  attention: "allowed",
  busy: "allowed",
  activity: "allowed",
  title: "allowed",
  markdown: "allowed",
  tool_output: "allowed",
  cards: "allowed",
  theme: "allowed",
  glyphs: "allowed",
  layout: "allowed",
  keys: { entries: { card: { denied: CARD_KEYS_DENIED }, elicitation: { denied: CARD_KEYS_DENIED } }, otherwise: "allowed" },
};

// -- Introspection (descriptions, defaults, the commented default, messages) ----------------------

type AnySchema = z.core.$ZodType;

/** The schema inside wrappers that do not change what a value may be (default, prefault,
 *  optional, nullable is kept). */
export function unwrap(schema: AnySchema): AnySchema {
  let current = schema;
  for (;;) {
    const def = (current as z.ZodType).def as { type: string; innerType?: AnySchema; in?: AnySchema };
    if ((def.type === "default" || def.type === "prefault" || def.type === "optional" || def.type === "readonly" || def.type === "nonoptional") && def.innerType) current = def.innerType;
    else if (def.type === "pipe" && def.in) current = def.in;
    else return current;
  }
}

/** A setting's description, looking through its wrappers. */
export function describeOf(schema: AnySchema): string | undefined {
  let current: AnySchema | undefined = schema;
  while (current) {
    const description = (current as z.ZodType).description;
    if (description) return description;
    const def = (current as z.ZodType).def as { type: string; innerType?: AnySchema; in?: AnySchema };
    current = def.innerType ?? (def.type === "pipe" ? def.in : undefined);
  }
  return undefined;
}

/** A setting's value list (`listed`), looking through its wrappers like `describeOf`. */
export function valueListOf(schema: AnySchema): ValueList | undefined {
  let current: AnySchema | undefined = schema;
  while (current) {
    const list = VALUE_LISTS.get(current);
    if (list) return list;
    if ((current as z.ZodType).description) return undefined;
    const def = (current as z.ZodType).def as { type: string; innerType?: AnySchema; in?: AnySchema };
    current = def.innerType ?? (def.type === "pipe" ? def.in : undefined);
  }
  return undefined;
}

/** The project-file rule for a path of keys (`["keys", "card", "escape"]`). */
export function projectRule(path: readonly (string | number)[]): ProjectRule {
  let rule: ProjectRule = PROJECT_FILE_RULES[path[0] as SectionName] ?? "allowed";
  for (const key of path.slice(1)) {
    if (typeof rule === "string" || "denied" in rule) return rule;
    rule = rule.entries[String(key)] ?? rule.otherwise;
  }
  return rule;
}
