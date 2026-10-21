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

/** A choice's provider heading (the name's prefix) and its name after `<heading>/`. */
export interface ProviderChoice {
  readonly provider: string;
  readonly title: string;
}

/**
 * The provider grouping of a model option, by choice value, or null when the choices are drawn as
 * sent. The rule: the option is a flat list (the harness sent no groups) of category `model`,
 * every value has a provider (its text before the first `/`, not empty), every name has a prefix
 * (its text before the first `/`, not empty) and text after it, the choices of one provider share
 * one name prefix and no two providers share one, and there are at least two distinct providers.
 * The heading is the name's prefix: the provider's ID where the harness names models
 * `<provider>/<model>` (OpenCode 2.x), its display name where it names them
 * `<display name>/<model>` (OpenCode 1.x, `BlueAI Platform/Gemma4 31b` for `blueai/Gemma-4-31B`).
 */
export function providerGroups(option: SelectOption | undefined): ReadonlyMap<string, ProviderChoice> | null {
  if (!option || option.category !== "model") return null;
  const found = new Map<string, ProviderChoice>();
  const headingOf = new Map<string, string>();
  const providerOf = new Map<string, string>();
  for (const entry of option.options) {
    if ("group" in entry) return null;
    const slash = entry.value.indexOf("/");
    if (slash <= 0) return null;
    const provider = entry.value.slice(0, slash);
    const cut = entry.name.indexOf("/");
    if (cut <= 0 || cut === entry.name.length - 1) return null;
    const heading = entry.name.slice(0, cut);
    // One heading per provider and one provider per heading, so a slash inside a model's own name
    // (`Qwen/Qwen3` under one provider) never passes for a provider.
    if ((headingOf.get(provider) ?? heading) !== heading || (providerOf.get(heading) ?? provider) !== provider) return null;
    headingOf.set(provider, heading);
    providerOf.set(heading, provider);
    found.set(entry.value, { provider: heading, title: entry.name.slice(cut + 1) });
  }
  return headingOf.size >= 2 ? found : null;
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
