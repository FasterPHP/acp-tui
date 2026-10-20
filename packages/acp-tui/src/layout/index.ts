export { Bar, Screen } from "./Screen.tsx";
export type { BlockComponent, BlockProps, ScreenProps } from "./Screen.tsx";
export { ActivityBar } from "./ActivityBar.tsx";
export { activityBar, PLAN_POINTER } from "./activity.ts";
export type { ActivityInput } from "./activity.ts";
export {
  BAR_PADDING,
  BLOCK_NAMES,
  COMPACT_LAYOUT,
  CONVERSATION_KEEP_ROWS,
  DEFAULT_LAYOUT,
  DEFAULT_MARGINS,
  FULL_SPACING,
  LayoutError,
  MARGIN_ROWS,
  MODULE_GAP,
  PROMPT_REST_ROWS,
  REQUIRED_BLOCKS,
  SPACER_ROWS,
  SPACING_ORDER,
  barText,
  fitBar,
  layoutBar,
  placeGroups,
  resolveBar,
  resolveLayout,
  restingBudget,
  restingPromptRows,
  spacing,
  validateLayout,
} from "./layout.ts";
export type {
  BarLayout,
  BarRegion,
  BlockName,
  FittedBar,
  Layout,
  Margins,
  ModuleEntry,
  Region,
  ResolvedBar,
  ResolvedLayout,
  ResolvedModule,
  ResolvedRegion,
  ResolvedSpacer,
  SpacerRegion,
  Spacing,
  SpacingInput,
  SpacingRow,
  ValidationResult,
} from "./layout.ts";
export { createLayoutState } from "./layout-state.ts";
export type { LayoutState } from "./layout-state.ts";
export { armedText, DEFAULT_HINTS, formatCost, formatCount, formatElapsed, hintApplies, MODULE_IDS, MODULES, shortenHome } from "./modules.ts";
export type { HintCondition, HintRule, ModuleDef, ModuleFn, ModuleId, ModuleSettings, ResolvedModuleSettings } from "./modules.ts";
export { displayWidth, fitSegments, segmentsWidth, truncateEnd, truncateMiddle } from "./segments.ts";
export type { Segment } from "./segments.ts";
export { parseTemplate, renderTemplate, templateFields } from "./template.ts";
export { DEFAULT_UI, deriveSessionView, FOLLOWING } from "./view.ts";
export type { AgentIdentity, ArmedState, Focus, ScrollPosition, SessionView, ViewInput } from "./view.ts";
