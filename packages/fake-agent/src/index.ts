// Entry point for the fake-agent package: the fixtures that scenarios send,
// exported so acp-tui's golden-file tests and benchmarks derive their
// expectations from the same strings the agent sends. The agent itself runs
// from main.ts.
import type { ACP_MODEL_PACKAGE_NAME } from "acp-model";

export const FAKE_AGENT_PACKAGE_NAME = "fake-agent" as const;
export type ModelPackageName = typeof ACP_MODEL_PACKAGE_NAME;

export { BIDI_TOOL_TITLE } from "./scenarios/bidi-permission.ts";
export {
  CONFIG_OPTION_DEFINITIONS,
  CONFIG_OPTIONS_COMMANDS,
  CONFIG_OPTIONS_COMMANDS_AFTER_FIRST_TURN,
} from "./scenarios/config-options.ts";
export { LEGACY_MODES } from "./scenarios/config-options-legacy.ts";
export { describePromptBlocks } from "./scenarios/basic.ts";
export { PERMISSION_CONCURRENT_OPTIONS, PERMISSION_CONCURRENT_TOOL_CALLS } from "./scenarios/permission-concurrent.ts";
export {
  PERMISSION_WITHDRAW_HOLD_MS,
  PERMISSION_WITHDRAW_OPTIONS,
  REQUEST_CANCELLED_CODE,
} from "./scenarios/permission-withdraw.ts";
export {
  FAST_TOOLS_ANSWER,
  FAST_TOOLS_CALLS,
  FAST_TOOLS_LIVE_MS,
  FAST_TOOLS_PERIOD_MS,
  FAST_TOOLS_SILENCE_MS,
} from "./scenarios/fast-tools.ts";
export { SLOW_TURN_GAP_MS, SLOW_TURN_LONG_GAP_MS } from "./scenarios/slow-turn.ts";
export {
  COPY_FIXTURES,
  COPY_FIXTURES_MESSAGE_IDS,
  COPY_FIXTURES_TOOL_CALL_ID,
  COPY_LIST,
  COPY_PARAGRAPHS,
  COPY_PHP_CODE,
  COPY_TABLE,
} from "./scenarios/copy-fixtures.ts";
export {
  FENCE_FIRST_CHUNK_SIZE,
  FENCE_FIRST_MESSAGE_ID,
  FENCE_FIRST_TEXT,
  fenceFirstChunks,
} from "./scenarios/fence-first.ts";
export {
  TOOL_CONTENT_BIG_OUTPUT_LINE_COUNT,
  TOOL_CONTENT_BIG_TITLE,
  TOOL_CONTENT_COMMAND,
  TOOL_CONTENT_IDS,
  TOOL_CONTENT_OUTPUT_LINES,
  TOOL_CONTENT_READ_LINE_COUNT,
  TOOL_CONTENT_READ_TITLE,
  TOOL_CONTENT_REFUSAL,
  TOOL_CONTENT_REFUSED_TITLE,
  toolContentTexts,
} from "./scenarios/tool-content.ts";
export {
  COMMAND_RESULTS_AUGGIE_FAILURE_ENVELOPE,
  COMMAND_RESULTS_AUGGIE_FAILURE_OUTPUT,
  COMMAND_RESULTS_AUGGIE_SUCCESS_ENVELOPE,
  COMMAND_RESULTS_AUGGIE_SUCCESS_OUTPUT,
  COMMAND_RESULTS_CLAUDE_FAILURE_BODY,
  COMMAND_RESULTS_CLAUDE_SUCCESS_LINES,
  COMMAND_RESULTS_ENVELOPE_HEAD,
  COMMAND_RESULTS_IDS,
  COMMAND_RESULTS_NEAR_MISS_ENVELOPE,
  COMMAND_RESULTS_NEAR_MISS_READ_BODY,
  COMMAND_RESULTS_TITLES,
  auggieEnvelope,
  commandResultsRawOutputs,
  commandResultsTexts,
} from "./scenarios/command-results.ts";
export {
  USAGE_WITHOUT_COST_FIRST,
  USAGE_WITHOUT_COST_LATER,
  USAGE_WITHOUT_COST_SIZE,
} from "./scenarios/usage-without-cost.ts";
export { SHORT_ANSWER_IDS, SHORT_ANSWER_README, SHORT_ANSWER_TEXT, SHORT_ANSWER_THOUGHT } from "./scenarios/short-answer.ts";
export { ELICITATION_FORM_SCHEMA, ELICITATION_URL, ELICITATION_URL_ID } from "./scenarios/elicitation.ts";
export { LINKS_DECEPTIVE, LINKS_LONG_URL, LINKS_MANY_ID, LINKS_MANY_TEXT, LINKS_ONE_ID, LINKS_ONE_TEXT } from "./scenarios/links.ts";
export {
  GROUPING_COMPLETION_ORDER,
  GROUPING_PERMISSION_OPTIONS,
  GROUPING_PERMISSION_OTHER_ID,
  GROUPING_QUIET_OTHER_ID,
  GROUPING_THOUGHT_ID,
  groupingReadId,
  groupingReadTitle,
} from "./scenarios/grouping.ts";
export {
  CARD_IMITATION_TEXT,
  FENCED_CARD_IMITATION_TEXT,
  HOSTILE_CHUNK_TEXT,
  HOSTILE_FIELD_LABELS,
  HOSTILE_PAYLOADS,
  HOSTILE_SESSION_TITLE,
  hostileField,
  type HostileFieldLabel,
  type HostilePayload,
} from "./hostile.ts";
export {
  PLAN_RUNNING_ENTRIES,
  PLAN_RUNNING_HOLD_MS,
  PLAN_RUNNING_TOOL_TITLES,
} from "./scenarios/plan-running.ts";
export {
  LONG_SESSION_DEFAULT_ITEMS,
  LONG_SESSION_NEEDLE,
  LONG_SESSION_NEEDLE_DISTANCE,
  LONG_SESSION_PLAN_EVERY,
  generateLongSessionItems,
  longSessionPlan,
  longSessionNeedleIndex,
  type LongSessionItem,
} from "./long-session-items.ts";
export { LONG_SESSION_SESSION_ID, LONG_SESSION_UPDATED_AT } from "./scenarios/long-session.ts";
export { LOAD_UPDATE_DELAY_MS } from "./agent.ts";
export { parseSessionsFixture, type StoredSession } from "./sessions.ts";
export {
  MARKDOWN_GALLERY,
  MARKDOWN_GALLERY_MESSAGE_ID,
  markdownGalleryChunks,
} from "./scenarios/markdown-gallery.ts";
export {
  PERMISSION_DIFF_LINE_COUNT,
  PERMISSION_DIFF_OPTIONS,
  PERMISSION_DIFF_PATH,
  PERMISSION_DIFF_TOOL_CALL_ID,
  permissionDiffFixture,
} from "./scenarios/permission-diff.ts";
/** Absolute path of the session list fixture for `--sessions` (four sessions, two directories; see AGENTS.md). */
export const SESSIONS_FIXTURE_PATH = new URL("../fixtures/sessions.json", import.meta.url).pathname;

/** Absolute path of the hostile-title session fixture for `--sessions` (see AGENTS.md). */
export const SESSIONS_HOSTILE_FIXTURE_PATH = new URL("../fixtures/sessions-hostile.json", import.meta.url).pathname;
export {
  STREAM_LONG_CHUNK_INTERVAL_MS,
  STREAM_LONG_CHUNK_SIZE,
  STREAM_LONG_LINE_COUNT,
  STREAM_LONG_TEXT,
  streamLongChunks,
} from "./scenarios/stream-long.ts";
