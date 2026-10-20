// Phase 0 investigation spike for task 6.3, moved to the alternate screen by
// phase-1a task 3.5: draws themed rows on the screen above a status bar and a
// hints row, so the PTY harness can inspect the emitted SGR and xterm cell
// colours.
//
//   bun packages/acp-tui/test/pty/theme-rows.tsx ['{"accent":5}']
//
// The optional argument is a JSON object of token overrides applied to the
// default theme. Rows, top to bottom:
//   PLAIN   a <text> with no fg at all (shows OpenTUI #1105)
//   TEXT    body text styled with the `text` token (default foreground)
//   ACCENT  a row styled with `accent`
//   MIXED   `text` with an `accent` span and a `muted` span
//   CORE    a `text` row built as a core TextRenderable, not through Solid
//   MDPARA / MDHEAD / MDITEM  a MarkdownRenderable styled by markdownStyles()
//   DONE    the last row, drawn once the Markdown has been laid out
// The bottom rows are a status bar (`status.bg` / `status.fg`) and a hints row.
// `q` exits.
import { createCliRenderer, MarkdownRenderable, SyntaxStyle, TextRenderable } from "@opentui/core";
import { render } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { DEFAULT_THEME, markdownStyles, resolveTheme, withTokens, type TokenName, type TokenValue } from "../../src/theme/index.ts";

const overrides = JSON.parse(process.argv[2] ?? "{}") as Partial<Record<TokenName, TokenValue>>;
const theme = resolveTheme(withTokens(DEFAULT_THEME, overrides));

const renderer = await createCliRenderer({
  screenMode: "alternate-screen",
  externalOutputMode: "passthrough",
  useMouse: false,
  exitOnCtrlC: false,
  consoleMode: "disabled",
});

const [done, setDone] = createSignal(false);
let rows: import("@opentui/core").BoxRenderable | undefined;

await render(
  () => (
    <box flexDirection="column" width="100%" height="100%">
      <box ref={(r) => (rows = r)} flexDirection="column" flexGrow={1}>
        <text>PLAIN no fg given</text>
        <text {...theme.text("text")}>TEXT default foreground</text>
        <text {...theme.text("accent")}>ACCENT accent token</text>
        <text {...theme.text("text")}>
          MIXED body <span style={theme.text("accent")}>accent</span> <span style={theme.text("muted")}>muted</span> end
        </text>
      </box>
      <Show when={done()}>
        <text {...theme.text("text")}>DONE</text>
      </Show>
      <box backgroundColor={theme.color("status.bg")} height={1}>
        <text {...theme.text("status.fg")}>
          STATUS <span style={theme.text("accent")}>agent</span> ready
        </text>
      </box>
      <text {...theme.text("hint")}>HINTS q quit</text>
    </box>
  ),
  renderer,
);

rows!.add(new TextRenderable(renderer, { content: "CORE default foreground", flexShrink: 0, ...theme.text("text") }));
const markdown = new MarkdownRenderable(renderer, {
  content: "MDPARA body **bold** `code` end\n\n# MDHEAD heading\n\n- MDITEM item\n",
  syntaxStyle: SyntaxStyle.fromStyles(markdownStyles(theme), renderer.nativeScene),
  fg: theme.color("text"),
  width: "100%",
  flexShrink: 0,
  internalBlockMode: "top-level",
});
rows!.add(markdown);
await renderer.idle();
setDone(true);

renderer.keyInput.on("keypress", (key) => {
  if (key.name === "q") {
    renderer.destroy();
    process.exit(0);
  }
});
