// The configuration loader (mvp-configuration design D1 and D3; spec tui-config
// "Validation errors name the place and the fix" and "Invalid settings keep the
// last good value"). One file's text becomes the values of its valid sections
// and a list of problems, each with the file, line and column:
//
// - JSONC (comments, trailing commas) is parsed with `jsonc-parser`, which gives
//   an offset for every node and syntax error. A syntax error makes the whole
//   file contribute nothing (`status: "syntax"`); only the first is reported,
//   since the rest usually follow from it.
// - Each top-level section is validated on its own with its zod schema
//   (`SECTIONS`); an invalid value rejects that section only (`rejected`), which
//   the caller then keeps at its last good value. A zod issue's path is looked
//   up in the parse tree for its line and column, and its message is written
//   from the schema at that path ("takes ... not ...").
// - Unknown names are warnings with the closest known name, and are ignored.
// - `agent_servers` is checked entry by entry: an invalid entry is reported by
//   name and is not launchable, and the valid ones stay (spec tui-sessions
//   "Agents are defined only in the user's configuration").
// - A project file (`kind: "project"`) may not set the settings the schema's
//   `PROJECT_FILE_RULES` deny: each is reported and ignored, and the rest of the
//   file applies (design D4).
//
// Pure: no file is read here (see sources.ts and store.ts).
import { findNodeAtLocation, parseTree, printParseErrorCode, type Node, type ParseError } from "jsonc-parser";
import type { z } from "zod";
import { checkOverrides, type GlyphSetName } from "../conversation/glyphs.ts";
import { formatProblem, suggest, type ConfigProblem, type ProblemSeverity } from "./problems.ts";
import { AgentServerSchema, projectRule, SECTION_NAMES, SECTIONS, unwrap, type SectionName } from "./schema.ts";

export type ConfigSourceKind = "user" | "project";

/** One file, loaded. */
export interface ParsedSource {
  readonly file: string;
  readonly kind: ConfigSourceKind;
  /** `absent`: no file (every section from the layers below); `syntax`: the file did not parse, or
   *  is not an object, so it contributes nothing new (the caller keeps its last good sections);
   *  `ok`: parsed, each section valid or rejected on its own. */
  readonly status: "absent" | "syntax" | "ok";
  /** The raw JSON values of the sections that passed validation, normalised (a bare theme or glyph
   *  set name becomes an object) and with denied entries removed; merged by `effective.ts`. */
  readonly sections: Partial<Record<SectionName, unknown>>;
  /** Sections present in the file but rejected (an error in them); they keep their last good value. */
  readonly rejected: readonly SectionName[];
  /** `agent_servers` entries that cannot be launched, by name: why (plain text, with the place). */
  readonly invalidAgents: Readonly<Record<string, string>>;
  /** What only `config --check` reports: a deprecated setting name that still works. */
  readonly notices: readonly ConfigProblem[];
  readonly problems: readonly ConfigProblem[];
}

export interface ParseOptions {
  /** Default `user`. */
  readonly kind?: ConfigSourceKind;
  /** Set when the file (or its directory) can be written by another user, or is owned by one: why.
   *  Its `agent_servers` are then refused with that reason (spec tui-config "Agents in the
   *  configuration"). */
  readonly agentsRefused?: string | null;
  /** Agent names that exist without the file (the built-in entries), for checking
   *  `default_agent_server`; default: it is not checked. */
  readonly knownAgents?: readonly string[];
  /** The platform the file is read on, for the checks that depend on it (the arguments the Windows
   *  command interpreter reads); default `process.platform`. */
  readonly platform?: NodeJS.Platform;
}

/** The characters of an argument that Windows' command interpreter (`cmd.exe`) reads as syntax
 *  when it runs a `.cmd` or `.bat` harness: command separators, redirections, the escape and
 *  variable expansion (windows-support D5). */
export const CMD_SPECIAL_CHARACTERS: readonly string[] = ["&", "|", "<", ">", "^", "%"];

/** What is odd about a harness argument on Windows, if anything: the interpreter characters it
 *  holds. Null when it has none. */
export function cmdArgumentWarning(arg: string): string | null {
  const found = CMD_SPECIAL_CHARACTERS.filter((c) => arg.includes(c));
  if (found.length === 0) return null;
  const list = found.map((c) => `"${c}"`).join(", ");
  return `holds ${list}, which the command interpreter (cmd.exe) treats specially when the harness is a command script (.cmd or .bat, as npm installs them), so Bun refuses to start such a script with ${found.length === 1 ? "it" : "them"} in an argument`;
}

/** Line starts of `text`, for offsets to 1-based line and column. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13 && text.charCodeAt(i + 1) !== 10) starts.push(i + 1);
  }
  return starts;
}

export function position(starts: readonly number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 };
}

const SYNTAX_MESSAGES: Record<string, string> = {
  InvalidSymbol: "is not valid JSONC here: an unexpected character",
  InvalidNumberFormat: "is not valid JSONC here: a malformed number",
  PropertyNameExpected: "is not valid JSONC here: a setting name in double quotes was expected",
  ValueExpected: "is not valid JSONC here: a value was expected",
  ColonExpected: "is not valid JSONC here: a colon was expected",
  CommaExpected: "is not valid JSONC here: a comma was expected",
  CloseBraceExpected: "is not valid JSONC here: a closing brace was expected",
  CloseBracketExpected: "is not valid JSONC here: a closing bracket was expected",
  EndOfFileExpected: "is not valid JSONC here: the end of the file was expected",
  InvalidCommentToken: "is not valid JSONC here: an invalid comment",
  UnexpectedEndOfComment: "is not valid JSONC here: a comment is not closed",
  UnexpectedEndOfString: "is not valid JSONC here: a string is not closed",
  UnexpectedEndOfNumber: "is not valid JSONC here: a number is not finished",
  InvalidUnicode: "is not valid JSONC here: an invalid \\u escape",
  InvalidEscapeCharacter: "is not valid JSONC here: an invalid escape",
  InvalidCharacter: "is not valid JSONC here: a control character in a string",
};

/** The JSON value of a node, as jsonc-parser builds it. */
export function valueOf(node: Node | undefined): unknown {
  if (!node) return undefined;
  switch (node.type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const property of node.children ?? []) {
        const [key, value] = property.children ?? [];
        if (key && typeof key.value === "string") out[key.value] = valueOf(value);
      }
      return out;
    }
    case "array":
      return (node.children ?? []).map(valueOf);
    default:
      return node.value;
  }
}

/** The property nodes of an object node: key node, key, value node. */
export function properties(node: Node | undefined): { keyNode: Node; key: string; value: Node | undefined }[] {
  if (!node || node.type !== "object") return [];
  const out: { keyNode: Node; key: string; value: Node | undefined }[] = [];
  for (const property of node.children ?? []) {
    const [keyNode, value] = property.children ?? [];
    if (keyNode && typeof keyNode.value === "string") out.push({ keyNode, key: keyNode.value, value });
  }
  return out;
}

const dotted = (path: readonly (string | number)[]): string => path.map(String).join(".");

/** How a found value reads in a message. */
function found(node: Node | undefined): string {
  if (!node) return "nothing";
  switch (node.type) {
    case "string": {
      const text = String(node.value);
      return JSON.stringify(text.length > 40 ? `${text.slice(0, 39)}…` : text);
    }
    case "number":
    case "boolean":
      return String(node.value);
    case "null":
      return "null";
    case "array":
      return "an array";
    default:
      return "an object";
  }
}

type AnySchema = z.core.$ZodType;
type Def = { type: string; [key: string]: unknown };
const defOf = (schema: AnySchema): Def => (schema as unknown as { def: Def }).def;

/** "a", "a or b", "a, b or c". */
function either(items: readonly string[]): string {
  const unique = [...new Set(items)];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} or ${unique.at(-1)}`;
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** What a schema accepts, in words, for messages ("takes ... not ..."). */
export function describeSchema(schema: AnySchema): string {
  const inner = unwrap(schema);
  const def = defOf(inner);
  switch (def.type) {
    case "enum":
      return either(Object.values(def["entries"] as Record<string, string>).map((v) => JSON.stringify(v)));
    case "literal":
      return either((def["values"] as unknown[]).map((v) => JSON.stringify(v)));
    case "boolean":
      return "true or false";
    case "string": {
      const s = inner as unknown as { minLength: number | null };
      const checks = (def["checks"] as { _zod: { def: { check: string; format?: string } } }[] | undefined) ?? [];
      const pattern = checks.find((c) => c._zod.def.format === "regex") as unknown as { _zod: { def: { error?: unknown } } } | undefined;
      // A pattern with a description of its own (a colour) says what it takes; others are names.
      if (pattern) return (inner as z.ZodType).description ?? "a name (letters, digits, '.', '_' and '-')";
      return (s.minLength ?? 0) > 0 ? "a non-empty string" : "a string";
    }
    case "number": {
      const n = inner as unknown as { minValue: number | null; maxValue: number | null; isInt: boolean };
      const kind = n.isInt ? "a whole number" : "a number";
      const min = n.minValue !== null && n.minValue > -MAX_SAFE ? n.minValue : null;
      const max = n.maxValue !== null && n.maxValue < MAX_SAFE ? n.maxValue : null;
      if (min !== null && max !== null) return `${kind} from ${min} to ${max}`;
      if (min !== null) return `${kind} from ${min}`;
      if (max !== null) return `${kind} up to ${max}`;
      return kind;
    }
    case "array": {
      const element = unwrap(def["element"] as AnySchema);
      const type = defOf(element).type;
      if (type === "string") return "an array of strings";
      return `an array of ${describeSchema(element)}`;
    }
    case "record": {
      const value = unwrap(def["valueType"] as AnySchema);
      return defOf(value).type === "string" ? "an object of strings" : "an object";
    }
    case "object":
      return "an object";
    case "nullable":
      return `${describeSchema(def["innerType"] as AnySchema)} or null`;
    case "union":
      return either((def["options"] as AnySchema[]).map(describeSchema));
    default:
      return "a valid value";
  }
}

/** The JSON kind a schema takes, for choosing a union's branch by the value found. */
function kindOf(schema: AnySchema): string[] {
  const def = defOf(unwrap(schema));
  switch (def.type) {
    case "enum":
    case "string":
      return ["string"];
    case "literal":
      return (def["values"] as unknown[]).map((v) => (v === null ? "null" : typeof v));
    case "number":
      return ["number"];
    case "boolean":
      return ["boolean"];
    case "array":
      return ["array"];
    case "object":
    case "record":
      return ["object"];
    case "nullable":
      return ["null", ...kindOf(def["innerType"] as AnySchema)];
    case "union":
      return (def["options"] as AnySchema[]).flatMap(kindOf);
    default:
      return [];
  }
}

/** The schema at `path` below `schema`, choosing union branches by the key's kind. */
function schemaAt(schema: AnySchema, path: readonly PropertyKey[]): AnySchema | undefined {
  let current: AnySchema | undefined = schema;
  for (const key of path) {
    if (!current) return undefined;
    current = child(current, key);
  }
  return current;
}

function child(schema: AnySchema, key: PropertyKey): AnySchema | undefined {
  const def = defOf(unwrap(schema));
  switch (def.type) {
    case "object":
      return (def["shape"] as Record<string, AnySchema>)[String(key)];
    case "record":
      return def["valueType"] as AnySchema;
    case "array":
      return def["element"] as AnySchema;
    case "nullable":
      return child(def["innerType"] as AnySchema, key);
    case "union": {
      for (const option of def["options"] as AnySchema[]) {
        const kinds = kindOf(option);
        if ((typeof key === "number" && kinds.includes("array")) || (typeof key === "string" && kinds.includes("object"))) {
          const found = child(option, key);
          if (found) return found;
        }
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Known keys of an object schema (of every object branch of a union), or null for neither. */
function objectKeys(schema: AnySchema): string[] | null {
  const def = defOf(unwrap(schema));
  if (def.type === "object") return Object.keys(def["shape"] as object);
  if (def.type === "union") return (def["options"] as AnySchema[]).flatMap((o) => objectKeys(o) ?? []);
  return null;
}

const isStrict = (schema: AnySchema): boolean => {
  const def = defOf(unwrap(schema));
  const catchall = def["catchall"] as AnySchema | undefined;
  return def.type === "object" && catchall !== undefined && defOf(catchall).type === "never";
};

interface Issue {
  code: string;
  path: PropertyKey[];
  message: string;
  keys?: string[];
  errors?: Issue[][];
  input?: unknown;
}

/** A loader for one file's text. */
export class Loader {
  readonly problems: ConfigProblem[] = [];
  /** Things only `acp-tui config --check` reports (a deprecated name that still works). */
  readonly notices: ConfigProblem[] = [];
  private readonly starts: number[];

  constructor(
    readonly file: string,
    text: string,
    readonly root: Node | undefined,
  ) {
    this.starts = lineStarts(text);
  }

  problem(node: Node | undefined, path: readonly (string | number)[], severity: ProblemSeverity, message: string, suggestion?: string): ConfigProblem {
    const at = node ? position(this.starts, node.offset) : { line: 1, column: 1 };
    const problem: ConfigProblem = { file: this.file, line: at.line, column: at.column, path: dotted(path), severity, message, ...(suggestion === undefined ? {} : { suggestion }) };
    this.problems.push(problem);
    return problem;
  }

  /** A notice for `config --check` only: the file works, so the problem counter and the notice line stay quiet. */
  notice(node: Node | undefined, path: readonly (string | number)[], message: string, suggestion?: string): void {
    const at = node ? position(this.starts, node.offset) : { line: 1, column: 1 };
    this.notices.push({ file: this.file, line: at.line, column: at.column, path: dotted(path), severity: "notice", message, ...(suggestion === undefined ? {} : { suggestion }) });
  }

  /** The value node at `path`, or the deepest node above it that exists. */
  nodeAt(path: readonly (string | number)[]): Node | undefined {
    if (!this.root) return undefined;
    for (let n = path.length; n >= 0; n--) {
      const node = findNodeAtLocation(this.root, path.slice(0, n) as (string | number)[]);
      if (node) return node;
    }
    return this.root;
  }

  /** The key node of property `key` in the object at `path`. */
  keyNodeAt(path: readonly (string | number)[], key: string): Node | undefined {
    const object = path.length === 0 ? this.root : findNodeAtLocation(this.root!, path as (string | number)[]);
    return properties(object).find((p) => p.key === key)?.keyNode ?? object;
  }

  /** Warnings for names the schema does not know, below `node` (zod strips them silently). */
  unknownNames(schema: AnySchema, node: Node | undefined, path: (string | number)[]): void {
    if (!node) return;
    const def = defOf(unwrap(schema));
    if (node.type === "null" && def.type === "nullable") return;
    switch (def.type) {
      case "nullable":
        this.unknownNames(def["innerType"] as AnySchema, node, path);
        return;
      case "object": {
        if (node.type !== "object") return;
        const shape = def["shape"] as Record<string, AnySchema>;
        const strict = isStrict(schema);
        // An object with a catchall of its own (theme tokens) takes other names and reports them
        // in its own check, so they are not warned about here as well.
        const open = !strict && def["catchall"] !== undefined;
        for (const { keyNode, key, value } of properties(node)) {
          if (key in shape) this.unknownNames(shape[key]!, value, [...path, key]);
          else if (!strict && !open) this.problem(keyNode, [...path, key], "warning", "is not a known setting and is ignored", suggest(key, Object.keys(shape)));
        }
        return;
      }
      case "record":
        for (const { key, value } of properties(node)) this.unknownNames(def["valueType"] as AnySchema, value, [...path, key]);
        return;
      case "array":
        (node.children ?? []).forEach((element, i) => this.unknownNames(def["element"] as AnySchema, element, [...path, i]));
        return;
      case "union": {
        const option = (def["options"] as AnySchema[]).find((o) => kindOf(o).includes(node.type));
        if (option) this.unknownNames(option, node, path);
        return;
      }
      default:
        return;
    }
  }

  /** Problems for a zod issue found validating the value at `base` with `schema`. */
  issue(issue: Issue, schema: AnySchema, base: readonly (string | number)[]): void {
    const relative = issue.path.map((k) => (typeof k === "symbol" ? String(k) : k)) as (string | number)[];
    const path = [...base, ...relative];
    const node = this.nodeAt(path);
    const at = schemaAt(schema, relative);
    switch (issue.code) {
      case "unrecognized_keys": {
        const known = at ? (objectKeys(at) ?? []) : [];
        for (const key of issue.keys ?? []) {
          this.problem(this.keyNodeAt(path, key), [...path, key], "error", "is not allowed here", suggest(key, known));
        }
        return;
      }
      case "invalid_union": {
        const options = at ? ((defOf(unwrap(at))["options"] as AnySchema[] | undefined) ?? []) : [];
        const exact = node && findNodeAtLocation(this.root!, path) === node ? node : undefined;
        // Of the branches that take this kind of value, the one with the fewest complaints.
        const weight = (issues: Issue[] | undefined) => (issues ?? []).reduce((n, i) => n + (i.keys?.length ?? 1), 0);
        let index = -1;
        options.forEach((option, i) => {
          if (!exact || !kindOf(option).includes(exact.type)) return;
          if (index < 0 || weight(issue.errors?.[i]) < weight(issue.errors?.[index])) index = i;
        });
        const branch = index >= 0 ? issue.errors?.[index] : undefined;
        if (branch && branch.length > 0) {
          // The branch that takes this kind of value says what is wrong inside it.
          for (const inner of branch) this.issue(inner, options[index]!, path);
          return;
        }
        this.problem(node, path, "error", `takes ${at ? describeSchema(at) : "another value"}, not ${found(exact)}`);
        return;
      }
      case "custom":
        this.problem(node, path, "error", issue.message);
        return;
      default: {
        const exact = this.root ? findNodeAtLocation(this.root, path) : undefined;
        const expected = at ? describeSchema(at) : "another value";
        if (!exact) {
          this.problem(node, path, "error", `is required: ${expected}`);
          return;
        }
        // A misspelt value of an enumeration gets the closest allowed value.
        let suggestion: string | undefined;
        if (issue.code === "invalid_value" && exact.type === "string" && at) {
          const entries = defOf(unwrap(at))["entries"] as Record<string, string> | undefined;
          if (entries) {
            const close = suggest(String(exact.value), Object.values(entries));
            if (close !== undefined) suggestion = JSON.stringify(close);
          }
        }
        this.problem(exact, path, "error", `takes ${expected}, not ${found(exact)}`, suggestion);
      }
    }
  }

  /** Validates `node` with `schema`; true when valid. Problems for every issue. */
  validate(schema: AnySchema, node: Node | undefined, path: (string | number)[], value: unknown = valueOf(node)): boolean {
    const result = (schema as z.ZodType).safeParse(value);
    if (result.success) return true;
    // One problem per place: zod goes on checking a value of the wrong type (an array given for a
    // non-empty string is also "too small"), which would say the same thing twice.
    const seen = new Set<string>();
    for (const issue of result.error.issues as unknown as Issue[]) {
      const key = JSON.stringify(issue.path.map(String));
      if (seen.has(key)) continue;
      seen.add(key);
      this.issue(issue, schema, path);
    }
    return false;
  }
}

/** Removes and reports the entries of `value` (at `path`) that a project file may not set. */
function denyProjectEntries(loader: Loader, node: Node | undefined, path: (string | number)[], value: unknown): unknown {
  const rule = projectRule(path);
  if (typeof rule === "string") return value;
  if ("denied" in rule) {
    loader.problem(loader.keyNodeAt(path.slice(0, -1), String(path.at(-1))), path, "error", `is not allowed in a project file (${rule.denied}) and is ignored`);
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const { key, value: child } of properties(node)) {
    const kept = denyProjectEntries(loader, child, [...path, key], (value as Record<string, unknown>)[key]);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

/** The name problem of an agent entry, if any. */
function agentNameProblem(name: string): string | null {
  if (name === "" || /[\u0000-\u001f\u007f-\u009f]/.test(name)) return "has an invalid name";
  return null;
}

/** The first command-line arguments that are subcommands (`RESERVED_SUBCOMMANDS` in cli.ts, which
 *  this module cannot import: a test keeps the two equal). */
export const HARNESS_NAME_SUBCOMMANDS: readonly string[] = ["config", "glyphs"];

/** What is odd about a valid harness's name on the command line, if anything (day-two-feedback
 *  design D5): it can then be reached only with `--harness <name>`. */
function harnessNameWarning(name: string): string | null {
  if (HARNESS_NAME_SUBCOMMANDS.includes(name)) return `is also a subcommand, so \`acp-tui ${name}\` runs the subcommand: the harness ${JSON.stringify(name)} is reached only with --harness ${name}`;
  if (name.startsWith("-")) return `starts with "-", which acp-tui reads as an option: the harness ${JSON.stringify(name)} is reached only with --harness ${name}`;
  return null;
}

/** Normalises a section's raw value for merging: `"theme": "mine"` is `{ "name": "mine" }`. */
function normalise(section: SectionName, value: unknown): unknown {
  if (section === "theme" && typeof value === "string") return { name: value };
  if (section === "glyphs" && typeof value === "string") return { set: value };
  return value;
}

/**
 * The glyph overrides that are not valid (spec tui-config "Glyph validation") are reported at their
 * place and left out, so the set's own glyph stays in use; the rest of the section applies.
 */
function checkGlyphSection(loader: Loader, value: unknown): unknown {
  const section = value as { set?: GlyphSetName; overrides?: Record<string, string> };
  if (!section.overrides || Object.keys(section.overrides).length === 0) return value;
  const { accepted, problems } = checkOverrides(section.set ?? "unicode", section.overrides);
  for (const p of problems) loader.problem(loader.keyNodeAt(["glyphs", "overrides"], p.name), ["glyphs", "overrides", p.name], "warning", p.message, p.suggestion);
  return problems.length === 0 ? value : { ...section, overrides: accepted };
}

/**
 * Loads one configuration file's text (null: the file does not exist). Never throws: everything
 * wrong is a problem.
 */
export function parseConfigText(text: string | null, file: string, options: ParseOptions = {}): ParsedSource {
  const kind = options.kind ?? "user";
  const empty = { file, kind, sections: {}, rejected: [], invalidAgents: {}, notices: [] } as const;
  if (text === null) return { ...empty, status: "absent", problems: [] };

  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true });
  const loader = new Loader(file, text, root);
  if (errors.length > 0) {
    const first = errors[0]!;
    const at = position(lineStarts(text), first.offset);
    const name = printParseErrorCode(first.error);
    loader.problems.push({ file, line: at.line, column: at.column, path: "", severity: "error", message: `${SYNTAX_MESSAGES[name] ?? `is not valid JSONC here (${name})`}; the file is ignored until it parses` });
    return { ...empty, status: "syntax", problems: loader.problems };
  }
  // An empty file, or one with only comments, sets nothing.
  if (root === undefined) return { ...empty, status: "ok", problems: [] };
  if (root.type !== "object") {
    loader.problem(root, [], "error", `holds ${found(root)}, not an object of settings; the file is ignored`);
    return { ...empty, status: "syntax", problems: loader.problems };
  }

  const sections: Partial<Record<SectionName, unknown>> = {};
  const rejected: SectionName[] = [];
  const invalidAgents: Record<string, string> = {};
  const validAgents = new Set<string>();
  const platform = options.platform ?? process.platform;

  // `agent_servers` before `default_agent_server`, which names one of them.
  const props = properties(root).sort((a, b) => Number(b.key === "agent_servers") - Number(a.key === "agent_servers"));
  const hasNewDefault = props.some((p) => p.key === "default_agent_server");
  for (const { keyNode, key: written, value: node } of props) {
    // `default_agent` is the old name of `default_agent_server` (day-two-feedback task 13.5): read
    // as the new setting, with a notice for `config --check`; the new name wins when both are set.
    let key = written;
    if (written === "default_agent") {
      if (hasNewDefault) {
        loader.problem(keyNode, [written], "warning", "is ignored: default_agent_server is set, and default_agent is only its old name");
        continue;
      }
      loader.notice(keyNode, [written], "is the old name of default_agent_server, which it still works as; rename it", "default_agent_server");
      key = "default_agent_server";
    }
    if (key === "$schema") {
      // Accepted and ignored, so an editor can be pointed at the JSON Schema.
      if (node?.type !== "string") loader.problem(node, [key], "warning", `takes a string (where the JSON Schema is), not ${found(node)}, and is ignored`);
      continue;
    }
    if (!(SECTION_NAMES as readonly string[]).includes(key)) {
      loader.problem(keyNode, [key], "warning", "is not a known setting and is ignored", suggest(key, SECTION_NAMES));
      continue;
    }
    const section = key as SectionName;
    const schema = SECTIONS[section] as unknown as AnySchema;
    let value = valueOf(node);
    if (kind === "project") {
      value = denyProjectEntries(loader, node, [section], value);
      if (value === undefined) continue;
    }
    loader.unknownNames(schema, node, [section]);

    if (section === "agent_servers") {
      if (options.agentsRefused) {
        loader.problem(keyNode, [written], "error", `is refused: harness commands are not read from a file other users can write (${options.agentsRefused})`);
        rejected.push(section);
        continue;
      }
      if (node?.type !== "object") {
        loader.validate(schema, node, [written]);
        rejected.push(section);
        continue;
      }
      const entries: Record<string, unknown> = {};
      for (const { keyNode: nameNode, key: name, value: entryNode } of properties(node)) {
        const nameProblem = agentNameProblem(name);
        if (nameProblem) {
          const p = loader.problem(nameNode, [written, name], "error", `${nameProblem}, so the harness cannot be launched`);
          invalidAgents[name] = `${nameProblem} (line ${p.line}, column ${p.column})`;
          continue;
        }
        const oddName = harnessNameWarning(name);
        if (oddName) loader.problem(nameNode, [written, name], "warning", oddName);
        const before = loader.problems.length;
        if (loader.validate(AgentServerSchema as unknown as AnySchema, entryNode, [written, name])) {
          entries[name] = valueOf(entryNode);
          validAgents.add(name);
          if (platform === "win32") {
            const args = findNodeAtLocation(entryNode!, ["args"]);
            (args?.children ?? []).forEach((argNode, i) => {
              const warning = argNode.type === "string" ? cmdArgumentWarning(String(argNode.value)) : null;
              if (warning !== null) loader.problem(argNode, [written, name, "args", i], "warning", warning);
            });
          }
        } else {
          // `has an invalid command: it takes a non-empty string, not 42 (line 1, column 45)`.
          const first = loader.problems[before]!;
          const inner = first.path.slice(`${section}.${name}`.length + 1);
          const field = inner.split(".")[0] ?? "";
          const what = field === "" ? "is invalid" : field === "args" ? "has invalid args" : `has an invalid ${field}`;
          const subject = inner === field ? "it" : inner;
          invalidAgents[name] = `${what}: ${subject} ${first.message} (line ${first.line}, column ${first.column})`;
        }
      }
      sections[section] = entries;
      continue;
    }

    if (section === "default_agent_server" && options.knownAgents && node?.type === "string") {
      const name = String(node.value);
      const known = options.knownAgents.includes(name) || validAgents.has(name);
      if (!known) {
        const reason = invalidAgents[name] !== undefined ? `names harness ${JSON.stringify(name)}, which ${invalidAgents[name]}` : `names ${JSON.stringify(name)}, which is not a known harness`;
        loader.problem(node, [written], "error", `${reason}; ${JSON.stringify(options.knownAgents[0] ?? "claude")} is used`);
        rejected.push(section);
        continue;
      }
    }

    if (loader.validate(schema, node, [written], value)) sections[section] = section === "glyphs" ? checkGlyphSection(loader, normalise(section, value)) : normalise(section, value);
    else rejected.push(section);
  }

  return { file, kind, status: "ok", sections, rejected, invalidAgents, notices: loader.notices, problems: loader.problems };
}

export { formatProblem };
