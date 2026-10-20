// The real CLI with the app replaced by a stub that records the launch
// description and launches nothing (mvp-sessions task 3.3, "Built-in
// default": command resolution only). It writes the description as JSON to
// ACP_TUI_TEST_LAUNCH_OUT and exits 0, after the CLI's own checks (the TTY
// check included, so run it under a PTY).
//
//   ACP_TUI_TEST_LAUNCH_OUT=<file> bun test/cli/cli-launch-stub.ts [acp-tui arguments]
import { writeFileSync } from "node:fs";
import { main } from "../../src/cli.ts";

const out = process.env["ACP_TUI_TEST_LAUNCH_OUT"];
if (!out) throw new Error("ACP_TUI_TEST_LAUNCH_OUT is not set");

main(process.argv.slice(2), undefined, async ({ launch }) => {
  writeFileSync(out, JSON.stringify(launch));
  return 0;
}).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`cli-launch-stub: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
