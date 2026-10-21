// Scenario registry: maps --scenario names to Scenario implementations.
import type { Scenario } from "../scenario.ts";
import { basicScenario } from "./basic.ts";
import { bidiPermissionScenario } from "./bidi-permission.ts";
import { bigOutputScenario } from "./big-output.ts";
import { configOptionsScenario } from "./config-options.ts";
import { configOptionsLegacyScenario } from "./config-options-legacy.ts";
import { configOptionsModelsScenario } from "./config-options-models.ts";
import { configOptionsProvidersScenario } from "./config-options-providers.ts";
import { commandResultsScenario } from "./command-results.ts";
import { copyFixturesScenario } from "./copy-fixtures.ts";
import { crashScenario } from "./crash.ts";
import { elicitationScenario } from "./elicitation.ts";
import { fastToolsScenario } from "./fast-tools.ts";
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
  [configOptionsProvidersScenario.name]: configOptionsProvidersScenario,
  [permissionWithdrawScenario.name]: permissionWithdrawScenario,
  [permissionConcurrentScenario.name]: permissionConcurrentScenario,
  [slowTurnScenario.name]: slowTurnScenario,
  [elicitationScenario.name]: elicitationScenario,
  [markdownGalleryScenario.name]: markdownGalleryScenario,
  [fenceFirstScenario.name]: fenceFirstScenario,
  [fastToolsScenario.name]: fastToolsScenario,
  [toolContentScenario.name]: toolContentScenario,
  [linksScenario.name]: linksScenario,
  [shortAnswerScenario.name]: shortAnswerScenario,
  [secretEchoScenario.name]: secretEchoScenario,
  [commandResultsScenario.name]: commandResultsScenario,
  [usageWithoutCostScenario.name]: usageWithoutCostScenario,
};

export function resolveScenario(name: string): Scenario {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    const known = Object.keys(SCENARIOS).join(", ");
    throw new Error(`unknown fake-agent scenario '${name}'; known scenarios: ${known}`);
  }
  return scenario;
}

export {
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
  toolContentScenario,
  usageWithoutCostScenario,
  viewerScenario,
};
