// The screen layout from the configuration's `layout` section (spec tui-layout
// "Layouts from the configuration", "Module settings from the configuration",
// "Conversation row floor setting" and "Scrollbar setting"; mvp-configuration
// design D11). Omitted parts keep the default layout's: the margins, the
// regions (`screen`), the prompt box's bottom border (`prompt`: the pills and
// the right module list), module settings (`modules`: format, priority,
// hide_when_empty, applied to every place the module appears, the prompt box's
// border included), the conversation's row floor and its scroll bar.
//
// The section has already passed "Layout validation" in the schema's
// `superRefine`, so an invalid layout never reaches here from the loader; the
// fallback to the default is only a guard.
import type { LayoutConfig } from "../config/schema.ts";
import { DEFAULT_LAYOUT, DEFAULT_PROMPT_RIGHT, validateLayout, type BarRegion, type Layout, type ModuleEntry, type Region, type ResolvedLayout } from "./layout.ts";
import type { ModuleId, ModuleSettings } from "./modules.ts";

type ModuleSection = NonNullable<LayoutConfig["modules"]>;

/** A module entry with the configured settings of its module laid over the entry's own. */
function withSettings(entry: ModuleEntry, modules: ModuleSection | undefined): ModuleEntry {
  const id: ModuleId = typeof entry === "string" ? entry : entry.id;
  const configured = modules?.[id];
  if (!configured) return entry;
  const settings: ModuleSettings = {
    ...(configured.format !== undefined ? { format: configured.format } : {}),
    ...(configured.priority !== undefined ? { priority: configured.priority } : {}),
    ...(configured.hide_when_empty !== undefined ? { hideWhenEmpty: configured.hide_when_empty } : {}),
  };
  return typeof entry === "string" ? { id, ...settings } : { ...entry, ...settings };
}

function barWithSettings(bar: BarRegion, modules: ModuleSection | undefined): BarRegion {
  const out: { -readonly [K in keyof BarRegion]: BarRegion[K] } = {};
  for (const side of ["left", "center", "right"] as const) {
    const list = bar[side];
    if (list) out[side] = list.map((entry) => withSettings(entry, modules));
  }
  return out;
}

/** The engine's layout object for a `layout` section, omitted parts from `base` (design D11). */
export function configLayoutObject(section: LayoutConfig, base: Layout = DEFAULT_LAYOUT): Layout {
  const modules = section.modules;
  const screen = ((section.screen as readonly Region[] | undefined) ?? base.screen).map((region): Region =>
    typeof region === "object" && region !== null && !("spacer" in region) ? barWithSettings(region, modules) : region,
  );
  const right = (section.prompt?.right ?? base.prompt?.right ?? DEFAULT_PROMPT_RIGHT).map((entry) => withSettings(entry, modules));
  const pills = section.prompt?.pills ?? base.prompt?.pills;
  return {
    margins: { top: section.margins?.top ?? base.margins?.top ?? 1, bottom: section.margins?.bottom ?? base.margins?.bottom ?? 1 },
    screen,
    prompt: { ...(pills ? { pills } : {}), right },
    conversationMinRows: section.conversation_min_rows,
    scrollbar: section.scrollbar,
  };
}

/** The validation errors of a `layout` section as the engine would use it ("Layout validation"),
 *  for the schema's check; empty when it is valid. */
export function configLayoutErrors(section: LayoutConfig): string[] {
  const result = validateLayout(configLayoutObject(section));
  return result.ok ? [] : result.errors;
}

export function layoutFromConfig(section: LayoutConfig): ResolvedLayout {
  const result = validateLayout(configLayoutObject(section));
  if (result.ok) return result.layout;
  const fallback = validateLayout(DEFAULT_LAYOUT);
  if (!fallback.ok) throw new Error(`the default layout is invalid: ${fallback.errors.join("; ")}`);
  return fallback.layout;
}
