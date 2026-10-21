// The effective configuration (mvp-configuration design D3 and D5; spec
// tui-config "Precedence of settings" and "Invalid settings keep the last good
// value"): the built-in defaults, then the user's file, then the project file
// (for the settings it may set), then the command line.
//
// Each file keeps its last good sections: a section that fails validation, or
// every section of a file that no longer parses, keeps the value it had at the
// last good load (nothing, so the layers below, at start-up). A file that is
// gone contributes nothing. Sections are merged as raw JSON, objects key by key
// (so a project file that sets `attention.long_turn_seconds` keeps the user's
// `attention.signal`), arrays and other values replaced, then parsed for their
// defaults. Command-line settings are applied last on every merge, so a reload
// never changes them (they are "pinned").
//
// Structural sharing: a section equal to the previous effective configuration's
// keeps its object, so a reader that selects a section (`config().theme`) sees
// no change unless it changed.
import type { ClipboardMode, ExitPrint, MousePolicy } from "../renderer/options.ts";
import { unionDirectories } from "./directories.ts";
import type { ParsedSource } from "./load.ts";
import { defaultConfig, SECTION_NAMES, SECTIONS, type Config, type SectionName } from "./schema.ts";

/** Settings given on the command line for this run (design D5): `--mouse`, `--wheel-lines`,
 *  `--exit-print`, `--clipboard`. Only the options given are present. */
export interface ConfigOverrides {
  readonly mouse?: MousePolicy;
  readonly wheel_lines?: number;
  readonly exit_print?: ExitPrint;
  readonly clipboard?: ClipboardMode;
}

/** Which settings the command line pins, by their configuration path. */
export function pinnedSettings(overrides: ConfigOverrides): string[] {
  const out: string[] = [];
  if (overrides.mouse !== undefined) out.push("mouse");
  if (overrides.wheel_lines !== undefined) out.push("wheel_lines");
  if (overrides.exit_print !== undefined) out.push("exit.print");
  if (overrides.clipboard !== undefined) out.push("clipboard");
  return out;
}

export type Sections = Partial<Record<SectionName, unknown>>;

/** One file's sections after a load, given its sections after the last one. */
export function nextLastGood(previous: Sections, parsed: ParsedSource): Sections {
  if (parsed.status === "absent") return {};
  if (parsed.status === "syntax") return previous;
  const next: Sections = { ...parsed.sections };
  for (const section of parsed.rejected) {
    if (previous[section] !== undefined) next[section] = previous[section];
  }
  return next;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** `b` over `a`: objects key by key, anything else replaced; undefined is "not set". */
export function mergeRaw(a: unknown, b: unknown): unknown {
  if (b === undefined) return a;
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) out[key] = mergeRaw(a[key], value);
    return out;
  }
  return b;
}

/** JSON equality, for structural sharing (the configuration is plain data). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && sameValue(a[k], b[k]));
  }
  return false;
}

function unionOf(user: unknown, project: unknown): unknown {
  return user === undefined && project === undefined ? undefined : unionDirectories(user, project);
}

export interface EffectiveInput {
  readonly user: Sections;
  readonly project: Sections;
  readonly overrides?: ConfigOverrides;
  /** The previous effective configuration, for structural sharing. */
  readonly previous?: Config;
}

/** The effective configuration from each file's last good sections and the command line. */
export function effectiveConfig(input: EffectiveInput): Config {
  const defaults = defaultConfig();
  const out = { ...defaults } as Record<SectionName, unknown>;
  for (const section of SECTION_NAMES) {
    // The one setting merged as a union rather than replaced: the user's directories, then the project's.
    // Since configured-harnesses D8 the loader never keeps the user's, so this is the project's list.
    const raw = section === "additional_directories" ? unionOf(input.user[section], input.project[section]) : mergeRaw(input.user[section], input.project[section]);
    if (raw === undefined) continue;
    const schema = SECTIONS[section];
    const merged = schema.safeParse(raw);
    if (merged.success) {
      out[section] = merged.data;
      continue;
    }
    // Each file's section was valid on its own; a merge that is not (a layout check across the
    // two) falls back to the user's alone, then to the default.
    const user = input.user[section] === undefined ? undefined : schema.safeParse(input.user[section]);
    if (user?.success) out[section] = user.data;
  }
  const overrides = input.overrides ?? {};
  if (overrides.mouse !== undefined) out.mouse = overrides.mouse;
  if (overrides.wheel_lines !== undefined) out.wheel_lines = overrides.wheel_lines;
  if (overrides.clipboard !== undefined) out.clipboard = overrides.clipboard;
  if (overrides.exit_print !== undefined) out.exit = { ...(out.exit as Config["exit"]), print: overrides.exit_print };

  const config = out as unknown as Config;
  const previous = input.previous;
  if (previous) {
    for (const section of SECTION_NAMES) {
      if (sameValue(previous[section], config[section])) (config as Record<SectionName, unknown>)[section] = previous[section];
    }
  }
  return config;
}

/** The sections whose values differ between two effective configurations. */
export function changedSections(before: Config, after: Config): SectionName[] {
  return SECTION_NAMES.filter((section) => before[section] !== after[section] && !sameValue(before[section], after[section]));
}
