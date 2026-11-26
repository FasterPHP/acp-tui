// Scenario registry: maps --scenario names to Scenario implementations.
import type { Scenario } from "../scenario.ts";
import { auggie1Scenario } from "./auggie-1.ts";
import { auggie1NoauthOfferingResumeOnlyScenario, auggie1NoauthOfferingScenario, auggie1NoauthResumeOnlyScenario, auggie1NoauthScenario } from "./auggie-1-noauth.ts";
import { basicScenario } from "./basic.ts";
import { bidiPermissionScenario } from "./bidi-permission.ts";
import { bigOutputScenario } from "./big-output.ts";
import { configOptionsScenario } from "./config-options.ts";
import { configOptionsLegacyScenario } from "./config-options-legacy.ts";
import { configOptionsModelsScenario, configOptionsModelsUnsetScenario } from "./config-options-models.ts";
import { configOptionsProvidersScenario } from "./config-options-providers.ts";
import { commandResultsScenario } from "./command-results.ts";
import { copyFixturesScenario } from "./copy-fixtures.ts";
import { crashScenario } from "./crash.ts";
import { elicitationScenario } from "./elicitation.ts";
import { fastToolsScenario } from "./fast-tools.ts";
import { tailWindowScenario } from "./tail-window.ts";
import { fenceFirstScenario } from "./fence-first.ts";
import { fiveToolsScenario } from "./five-tools.ts";
import { groupingScenario } from "./grouping.ts";
import { hostileScenario } from "./hostile.ts";
import { longSessionPlainScenario, longSessionScenario } from "./long-session.ts";
import { markdownGalleryScenario } from "./markdown-gallery.ts";
import { permissionConcurrentScenario } from "./permission-concurrent.ts";
import { permissionDiffScenario } from "./permission-diff.ts";
import { permissionWithdrawScenario } from "./permission-withdraw.ts";
import { planRunningScenario } from "./plan-running.ts";
import { promptErrorScenario } from "./prompt-error.ts";
import { secretEchoScenario } from "./secret-echo.ts";
import { shortAnswerScenario } from "./short-answer.ts";
import { slowTurnScenario } from "./slow-turn.ts";
import { streamLongScenario } from "./stream-long.ts";
import { taskMessagesScenario } from "./task-messages.ts";
import { toolContentScenario } from "./tool-content.ts";
import { linksScenario } from "./links.ts";
import { usageWithoutCostScenario } from "./usage-without-cost.ts";
import { viewerScenario } from "./viewer.ts";

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  [basicScenario.name]: basicScenario,
  [longSessionScenario.name]: longSessionScenario,
  [longSessionPlainScenario.name]: longSessionPlainScenario,
  [fiveToolsScenario.name]: fiveToolsScenario,
  [groupingScenario.name]: groupingScenario,
  [crashScenario.name]: crashScenario,
  [promptErrorScenario.name]: promptErrorScenario,
  [bigOutputScenario.name]: bigOutputScenario,
  [bidiPermissionScenario.name]: bidiPermissionScenario,
  [viewerScenario.name]: viewerScenario,
  [streamLongScenario.name]: streamLongScenario,
  [copyFixturesScenario.name]: copyFixturesScenario,
  [hostileScenario.name]: hostileScenario,
  [permissionDiffScenario.name]: permissionDiffScenario,
  [planRunningScenario.name]: planRunningScenario,
  [configOptionsScenario.name]: configOptionsScenario,
  [configOptionsLegacyScenario.name]: configOptionsLegacyScenario,
  [configOptionsModelsScenario.name]: configOptionsModelsScenario,
  [configOptionsModelsUnsetScenario.name]: configOptionsModelsUnsetScenario,
  [configOptionsProvidersScenario.name]: configOptionsProvidersScenario,
  [permissionWithdrawScenario.name]: permissionWithdrawScenario,
  [permissionConcurrentScenario.name]: permissionConcurrentScenario,
  [slowTurnScenario.name]: slowTurnScenario,
  [elicitationScenario.name]: elicitationScenario,
  [markdownGalleryScenario.name]: markdownGalleryScenario,
  [fenceFirstScenario.name]: fenceFirstScenario,
  [fastToolsScenario.name]: fastToolsScenario,
  [tailWindowScenario.name]: tailWindowScenario,
  [toolContentScenario.name]: toolContentScenario,
  [linksScenario.name]: linksScenario,
  [shortAnswerScenario.name]: shortAnswerScenario,
  [secretEchoScenario.name]: secretEchoScenario,
  [commandResultsScenario.name]: commandResultsScenario,
  [usageWithoutCostScenario.name]: usageWithoutCostScenario,
  [taskMessagesScenario.name]: taskMessagesScenario,
  [auggie1Scenario.name]: auggie1Scenario,
  [auggie1NoauthScenario.name]: auggie1NoauthScenario,
};

export function resolveScenario(name: string, flags: { readonly offerModels?: boolean; readonly resumeOnly?: boolean } = {}): Scenario {
  if (flags.offerModels || flags.resumeOnly) {
    if (name !== auggie1NoauthScenario.name) {
      throw new Error(`${flags.offerModels ? "--offer-models" : "--resume-only"} needs --scenario ${auggie1NoauthScenario.name}`);
    }
    if (flags.resumeOnly) return flags.offerModels ? auggie1NoauthOfferingResumeOnlyScenario : auggie1NoauthResumeOnlyScenario;
    return auggie1NoauthOfferingScenario;
  }
  const scenario = SCENARIOS[name];
  if (!scenario) {
    const known = Object.keys(SCENARIOS).join(", ");
    throw new Error(`unknown fake-agent scenario '${name}'; known scenarios: ${known}`);
  }
  return scenario;
}

export {
  auggie1NoauthScenario,
  auggie1Scenario,
  basicScenario,
  bidiPermissionScenario,
  bigOutputScenario,
  commandResultsScenario,
  configOptionsLegacyScenario,
  configOptionsModelsScenario,
  configOptionsScenario,
  copyFixturesScenario,
  crashScenario,
  elicitationScenario,
  fastToolsScenario,
  fenceFirstScenario,
  fiveToolsScenario,
  groupingScenario,
  hostileScenario,
  linksScenario,
  longSessionPlainScenario,
  longSessionScenario,
  markdownGalleryScenario,
  permissionConcurrentScenario,
  permissionDiffScenario,
  permissionWithdrawScenario,
  planRunningScenario,
  promptErrorScenario,
  shortAnswerScenario,
  slowTurnScenario,
  streamLongScenario,
  tailWindowScenario,
  taskMessagesScenario,
  toolContentScenario,
  usageWithoutCostScenario,
  viewerScenario,
};
