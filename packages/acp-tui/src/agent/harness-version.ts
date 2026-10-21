// The notice for an Auggie acp-tui has not been checked with (spec tui-agent-session "Harness
// version not yet checked"): the second-generation Auggie, whose version has a major number of 1
// or more. Keyed on what the harness reports in `initialize`, so it also applies to a configured or
// ad hoc launch. No quirk handling: only a notice.
import { sanitise } from "acp-model";
import { truncateEnd } from "../layout/segments.ts";

/** The Auggie version the colleagues testing acp-tui use. */
export const CHECKED_AUGGIE_VERSION = "0.36.0";

/** The widest the reported version is shown (columns). */
const VERSION_COLUMNS = 40;

/** Whether `version` has a major number of 1 or more (`1.2.0-prerelease.1`, `2`, `v1.0`). */
export function majorAtLeastOne(version: string): boolean {
  const match = /^\s*v?(\d+)(?![\d])/.exec(version);
  return match !== null && Number(match[1]) >= 1;
}

/** The notice for `agentInfo`, or null when it is not an Auggie of major version 1 or more. */
export function uncheckedAuggieNotice(agentInfo: { readonly name?: unknown; readonly version?: unknown } | null | undefined): string | null {
  if (!agentInfo || agentInfo.name !== "auggie" || typeof agentInfo.version !== "string") return null;
  if (!majorAtLeastOne(agentInfo.version)) return null;
  const version = truncateEnd(sanitise(agentInfo.version, "approval").replace(/\s+/g, " ").trim(), VERSION_COLUMNS);
  return `auggie ${version} has not been checked with acp-tui; testers use ${CHECKED_AUGGIE_VERSION}`;
}
