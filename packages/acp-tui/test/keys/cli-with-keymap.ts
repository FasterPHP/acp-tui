// The real CLI with key map overrides and the internal key settings, for the
// PTY tests of spec tui-keymap ("Rebound key in a notice", "Single interrupt
// setting"). The overrides come as JSON in ACP_TUI_TEST_KEYMAP and are loaded
// over the defaults with `loadKeyMap` (`null` unbinds a key); the `interrupt`
// setting (src/keys/settings.ts) comes as ACP_TUI_TEST_INTERRUPT (`double` or
// `single`). Both are configurable now (`keys` and `interrupt`); this entry
// point remains for tests that set them in-process. ACP_TUI_TEST_CLIPBOARD stubs the host clipboard that `paste`
// reads (spec tui-keymap "Paste from the clipboard"), as JSON:
// `{"text":"..."}` or `{"image":"image/png"}`; every read is appended to the
// file named by ACP_TUI_TEST_CLIPBOARD_LOG, if set.
//
//   ACP_TUI_TEST_KEYMAP='{"global":{"ctrl+q":"detach","ctrl+d":null}}' bun test/keys/cli-with-keymap.ts -- <agent command>
//   ACP_TUI_TEST_INTERRUPT=single bun test/keys/cli-with-keymap.ts -- <agent command>
//   ACP_TUI_TEST_CLIPBOARD='{"text":"one\ntwo"}' bun test/keys/cli-with-keymap.ts -- <agent command>
import type { HostClipboardService } from "@opentui/core";
import { appendFileSync } from "node:fs";

await import("@opentui/solid/preload");
const { main } = await import("../../src/cli.ts");
const { runApp } = await import("../../src/app/run.tsx");
const { loadKeyMap } = await import("../../src/keys/keymap.ts");

const keyMap = loadKeyMap(JSON.parse(process.env["ACP_TUI_TEST_KEYMAP"] ?? "{}"));
const interrupt = process.env["ACP_TUI_TEST_INTERRUPT"];
if (interrupt !== undefined && interrupt !== "double" && interrupt !== "single") throw new Error(`ACP_TUI_TEST_INTERRUPT: '${interrupt}'`);

function stubClipboard(spec: { text?: string; image?: string }): HostClipboardService {
  const log = process.env["ACP_TUI_TEST_CLIPBOARD_LOG"];
  const representation =
    spec.text !== undefined ? { mimeType: "text/plain", bytes: new TextEncoder().encode(spec.text) } : { mimeType: spec.image ?? "image/png", bytes: new Uint8Array([137, 80, 78, 71]) };
  return {
    maxWriteBytes: 1024,
    read: async (options) => {
      if (log) appendFileSync(log, `${JSON.stringify({ preferredTypes: options.preferredTypes })}\n`);
      return { status: "read", representation };
    },
    writeText: async () => ({ status: "unsupported" }),
    clear: async () => ({ status: "unsupported" }),
    dispose: async () => {},
  };
}
const clipboard = process.env["ACP_TUI_TEST_CLIPBOARD"];
const clipboardHost = clipboard === undefined ? undefined : stubClipboard(JSON.parse(clipboard));

main(process.argv.slice(2), undefined, (options) => runApp(options, { keyMap, ...(interrupt ? { interrupt } : {}), ...(clipboardHost ? { clipboardHost } : {}) })).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`cli-with-keymap: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);

export {};
