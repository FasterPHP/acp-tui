// Placeholder entry point for the acp-tui package (Phase 0 workspace scaffold).
// The CLI (src/cli.ts), agent connection, renderer, footer and key map land in
// tasks groups 5 to 9.
import { ACP_MODEL_PACKAGE_NAME } from "acp-model";

export const ACP_TUI_PACKAGE_NAME = "acp-tui" as const;
export const ACP_TUI_MODEL_DEPENDENCY = ACP_MODEL_PACKAGE_NAME;
