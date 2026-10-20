// The real CLI with another screen layout, for the PTY tests of spec
// tui-layout (the header-bar layout, a layout without `hints`). The layout
// comes as JSON in ACP_TUI_TEST_LAYOUT, or by name (`compact`). The layout is
// configurable now; this entry point remains for tests that set one in-process.
//
//   ACP_TUI_TEST_LAYOUT=compact bun test/layout/cli-with-layout.ts -- <agent command>
await import("@opentui/solid/preload");
const { main } = await import("../../src/cli.ts");
const { runApp } = await import("../../src/app/run.tsx");
const { COMPACT_LAYOUT } = await import("../../src/layout/layout.ts");

const raw = process.env["ACP_TUI_TEST_LAYOUT"] ?? "compact";
const layout = raw === "compact" ? COMPACT_LAYOUT : JSON.parse(raw);

main(process.argv.slice(2), undefined, (options) => runApp(options, { layout })).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`cli-with-layout: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);

export {};
