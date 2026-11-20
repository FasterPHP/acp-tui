// The "auggie-1-noauth" scenario (auggie-1x-support task 2.6): Auggie 1.2.2 when logged out. `session/new`
// succeeds; the `model` option reads `unknown/unknown` with no choices; every prompt fails `-32603`
// `Internal error` with the reason, three lines, only in `data.details`. With `--offer-models` the
// model option is `auggie-1`'s instead, so the start passes and only the prompt fails (a logged-in
// user whose model list came back empty is the other way round; this is the offline case).
import { RequestError } from "@agentclientprotocol/sdk";
import type { PromptResponse, SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Scenario } from "../scenario.ts";
import { AUGGIE_1_DEFAULT_MODEL, AUGGIE_1_INFO, auggieModelOption } from "./auggie-1.ts";

/** What 1.2.2 says (its own install path in place of the documentation's; the file does not exist there either). */
export const NO_API_KEY_DETAILS =
  "No API key found for unknown.\n\nUse /login or set an API key environment variable. See /tmp/fake-auggie/node_modules/@augmentcode/auggie/docs/providers.md";

const NO_MODELS = {
  type: "select",
  id: "model",
  name: "Model",
  category: "model",
  currentValue: "unknown/unknown",
  options: [],
} as unknown as SessionConfigOption;

function makeScenario(name: string, offerModels: boolean): Scenario {
  return {
    name,
    harness: { sessions: true },

    initialize() {
      return {
        agentInfo: { ...AUGGIE_1_INFO },
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true },
          sessionCapabilities: { resume: {}, close: {}, list: {}, additionalDirectories: {} },
        },
      } as ReturnType<NonNullable<Scenario["initialize"]>>;
    },

    newSession() {
      return { configOptions: [offerModels ? auggieModelOption(AUGGIE_1_DEFAULT_MODEL) : NO_MODELS] };
    },

    async prompt(): Promise<PromptResponse> {
      throw new RequestError(-32603, "Internal error", { details: NO_API_KEY_DETAILS });
    },
  };
}

export const auggie1NoauthScenario: Scenario = makeScenario("auggie-1-noauth", false);

/** `--offer-models`: the same agent with `auggie-1`'s model option. */
export const auggie1NoauthOfferingScenario: Scenario = makeScenario("auggie-1-noauth", true);
