// The notice `acp-tui config --check` prints when no harness is enabled (install-harness-choice
// design D7): a file or no file without an `agent_servers` entry. Tests of other settings use files
// without entries, so they compare the output with this notice taken out.

/** The notice's line, as `config --check` prints it. */
export const HARNESS_NOTICE = /^.*: notice: agent_servers has no entry, (?:since there is no configuration file, )?so no harness is enabled.*$/m;

/** `config --check`'s output without the no-harness notice: "no configuration problems" when it
 *  was the only one, else the other lines (the counts unchanged, since a notice is not counted). */
export function withoutHarnessNotice(out: string): string {
  const lines = out.split("\n").filter((line) => !HARNESS_NOTICE.test(line));
  const rest = lines.join("\n").trim();
  return rest === "0 errors, 0 warnings" ? "no configuration problems" : rest;
}
