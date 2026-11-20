// Auggie 1.x's indexing lines (auggie-1x-support design D16; spec tui-agent-session "Auggie's
// indexing line becomes a question" and "Other indexing lines from Auggie"). In ACP mode Auggie 1.2.2
// sends the reason a workspace is not indexed as agent text, one `agent_message_chunk` per
// workspace after every `session/new` and `session/load`. For a harness whose profile says so
// (`indexingPatterns`, src/agent/harness-profiles.ts), a chunk whose whole text is one of these lines
// is taken out before the model: the disabled line becomes the indexing question card
// (src/card/indexing.tsx), the file-limit and home-directory lines warning notices. Any other
// harness's identical text is agent text as before.
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { HarnessProfile } from "./harness-profiles.ts";

/** A line Auggie sent instead of indexing a workspace. */
export type IndexingLine =
  /** `Indexing disabled for current workspace "<dir>".`: no rule, or a stored deny rule. */
  | { readonly kind: "disabled"; readonly directory: string }
  /** `Indexing limited for "<dir>": file limit reached. …`, which `--allow-indexing` cannot change. */
  | { readonly kind: "limited"; readonly directory: string; readonly text: string }
  /** `Indexing disabled for "<dir>": home directory or parent directory. …`, never indexed. */
  | { readonly kind: "home"; readonly directory: string; readonly text: string };

// One line each, with at most a line end after it (1.2.2 and fake-agent end the chunk with `\n`).
const DISABLED = /^Indexing disabled for current workspace "([^\r\n]+)"\.$/;
const LIMITED = /^Indexing limited for "([^\r\n"]+)": [^\r\n]*$/;
const HOME = /^Indexing disabled for "([^\r\n"]+)": home directory or parent directory\.[^\r\n]*$/;

/** The indexing line `text` is as a whole, or null (a near miss, two lines, or text around it). */
export function matchIndexingLine(text: string): IndexingLine | null {
  const line = text.replace(/\r?\n$/, "");
  const disabled = DISABLED.exec(line);
  if (disabled) return { kind: "disabled", directory: disabled[1]! };
  const limited = LIMITED.exec(line);
  if (limited) return { kind: "limited", directory: limited[1]!, text: line };
  const home = HOME.exec(line);
  if (home) return { kind: "home", directory: home[1]!, text: line };
  return null;
}

/** Where the lines go: the app's indexing host, which lasts for the run (across harness processes
 *  and sessions), so a directory answered `not now` stays answered. */
export interface IndexingSink {
  /** Takes a matched line; true when it was taken (and so is not agent text). */
  take(line: IndexingLine): boolean;
}

/** The client handler's interception for `profile`: an `agent_message_chunk` whose whole text is an
 *  indexing line goes to `sink` instead of the model; null when the profile has no indexing
 *  patterns (any other harness, or none), so nothing is ever taken. */
export function indexingIntercept(profile: HarnessProfile | null, sink: IndexingSink | undefined): ((update: SessionUpdate) => boolean) | null {
  if (!profile?.indexingPatterns || !sink) return null;
  return (update) => {
    if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") return false;
    const line = matchIndexingLine(update.content.text);
    return line !== null && sink.take(line);
  };
}
