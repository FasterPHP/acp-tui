// Model lists grouped by provider (spec tui-palette "Model choices grouped by provider", spec
// tui-layout "Model names with their provider"). One function decides, for a `model` select
// option, whether its choices are drawn by provider and how, so the picker, the pills, the status
// row, the splash and the notice after a choice cannot disagree.
import type { SessionConfigOption } from "@agentclientprotocol/sdk";

type SelectOption = Extract<SessionConfigOption, { type: "select" }>;

/** The id of the select option acp-tui makes of the agent's older model state (`models`,
 *  `session/set_model`), a compatibility fallback (session-models D4). Never sent to the agent. */
export const LEGACY_MODEL_ID = "acp-tui:legacy-model";

/** The older model state as one select option of category `model` (the picker's and the view's
 *  common form, so the grouping rule reads the same list). */
export function legacyModelOption(models: {
  readonly currentModelId: string;
  readonly availableModels: readonly { readonly modelId: string; readonly name: string; readonly description?: string | null }[];
}): SelectOption {
  return {
    type: "select",
    id: LEGACY_MODEL_ID,
    name: "Model",
    category: "model",
    currentValue: models.currentModelId,
    options: models.availableModels.map((model) => ({ value: model.modelId, name: model.name, description: model.description })),
  };
}

/** The settings of the `models` section the grouping reads. */
export interface ModelListSettings {
  readonly groupByProvider: boolean;
  readonly separator: string;
}

export const DEFAULT_MODEL_LIST_SETTINGS: ModelListSettings = { groupByProvider: true, separator: " / " };

/** A choice's provider and its name after `<provider>/`. */
export interface ProviderChoice {
  readonly provider: string;
  readonly title: string;
}

/**
 * The provider grouping of a model option, by choice value, or null when the choices are drawn as
 * sent. The rule: the option is a flat list (the harness sent no groups) of category `model`,
 * every value has a provider (its text before the first `/`, not empty), every name starts with
 * `<provider>/` and has text after it, and there are at least two distinct providers.
 */
export function providerGroups(option: SelectOption | undefined): ReadonlyMap<string, ProviderChoice> | null {
  if (!option || option.category !== "model") return null;
  const found = new Map<string, ProviderChoice>();
  const providers = new Set<string>();
  for (const entry of option.options) {
    if ("group" in entry) return null;
    const slash = entry.value.indexOf("/");
    if (slash <= 0) return null;
    const provider = entry.value.slice(0, slash);
    const prefix = `${provider}/`;
    if (!entry.name.startsWith(prefix) || entry.name.length === prefix.length) return null;
    providers.add(provider);
    found.set(entry.value, { provider, title: entry.name.slice(prefix.length) });
  }
  return providers.size >= 2 ? found : null;
}

/** The name of `value` as the pill, the module, the splash and the notice show it: with its
 *  provider and the separator when the grouping applies, else `name` as sent. */
export function modelDisplayName(
  option: SelectOption | undefined,
  value: string,
  name: string,
  settings: ModelListSettings = DEFAULT_MODEL_LIST_SETTINGS,
): string {
  if (!settings.groupByProvider) return name;
  const choice = providerGroups(option)?.get(value);
  return choice ? `${choice.provider}${settings.separator}${choice.title}` : name;
}
