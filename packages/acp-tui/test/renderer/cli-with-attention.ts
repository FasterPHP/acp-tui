// The real CLI with the internal attention settings (src/renderer/attention.ts), for the PTY test
// "Long turn" (spec tui-screen "Attention signals"): a real turn of 45 seconds is out of the
// question, so the long-turn threshold comes from ACP_TUI_TEST_LONG_TURN_SECONDS and the signal
// kind from ACP_TUI_TEST_ATTENTION_SIGNAL (`bell`, `osc9`, `osc777` or `none`). Only this test
// entry point reads them. The settings are configurable now (`attention.signal` and
// `attention.long_turn_seconds`); this entry point remains for tests that set them in-process.
//
//   ACP_TUI_TEST_LONG_TURN_SECONDS=1 bun test/renderer/cli-with-attention.ts -- <agent command>
import { ATTENTION_SIGNALS, DEFAULT_ATTENTION, type AttentionSettings, type AttentionSignal } from "../../src/renderer/attention.ts";

await import("@opentui/solid/preload");
const { main } = await import("../../src/cli.ts");
const { runApp } = await import("../../src/app/run.tsx");

const seconds = process.env["ACP_TUI_TEST_LONG_TURN_SECONDS"];
const signal = process.env["ACP_TUI_TEST_ATTENTION_SIGNAL"];
if (signal !== undefined && !(ATTENTION_SIGNALS as readonly string[]).includes(signal)) throw new Error(`ACP_TUI_TEST_ATTENTION_SIGNAL: '${signal}'`);
if (seconds !== undefined && !(Number(seconds) >= 0)) throw new Error(`ACP_TUI_TEST_LONG_TURN_SECONDS: '${seconds}'`);
const attention: AttentionSettings = {
  signal: (signal as AttentionSignal | undefined) ?? DEFAULT_ATTENTION.signal,
  longTurnSeconds: seconds === undefined ? DEFAULT_ATTENTION.longTurnSeconds : Number(seconds),
};

main(process.argv.slice(2), undefined, (options) => runApp(options, { attention })).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`cli-with-attention: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);

export {};
