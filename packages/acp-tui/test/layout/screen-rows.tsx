// The screen layout drawn in OpenTUI's test renderer with stand-in blocks, for
// the row tests of spec tui-layout ("Declarative screen layout", "Margins and
// row budget", "Spacing gives way before content") without a PTY or an agent.
// Each block draws one letter per row it takes: `C` the conversation (all the
// rows left), `P` the prompt box (its resting text rows plus the two borders,
// and the padding row while the screen draws it), `A` the activity bar's line (drawn also while nothing runs), `K`
// the card (its rows, and `k` for its padding rows while the screen draws
// them) and `F` the find bar (each the rows the caller gives it, 0 by
// default). The screen's blank rows are empty. Bars are drawn by the real
// `Bar` from the view.
import { createEffect, For } from "solid-js";
import { testRender } from "@opentui/solid";
import { PROMPT_FRAME_ROWS, Screen, type BlockComponent, type BlockProps } from "../../src/layout/Screen.tsx";
import type { BlockName, ResolvedLayout } from "../../src/layout/layout.ts";
import type { SessionView } from "../../src/layout/view.ts";
import { DEFAULT_THEME, resolveTheme } from "../../src/theme/index.ts";

/** A block that reports `rows()` rows and fills them with `letter`, with `padding()` more rows the
 *  screen adds while its spacing keeps them (`top` of them above, the rest below). */
function stand(letter: string, rows: (props: BlockProps) => number, padding: (props: BlockProps) => { top: number; bottom: number; letter: string } = () => ({ top: 0, bottom: 0, letter: "" })): BlockComponent {
  return (props) => {
    createEffect(() => props.onHeight(rows(props)));
    const letters = () => {
      const pad = padding(props);
      return [...Array<string>(pad.top).fill(pad.letter), ...Array<string>(rows(props)).fill(letter), ...Array<string>(pad.bottom).fill(pad.letter)];
    };
    return (
      <box flexDirection="column">
        <For each={letters()}>{(l) => <text height={1}>{l}</text>}</For>
      </box>
    );
  };
}

export interface StandIns {
  /** Rows of the activity bar's line (1 by default: it keeps its row for the whole session), the card and the find bar (0 by default; 0 hides each). */
  activity?: number;
  /** The card's rows; its claim is the same unless `cardClaim` says otherwise. */
  card?: number;
  cardClaim?: number;
  /** The card's padding rows at its top and bottom (`cards.padding.rows`; 1 by default). */
  cardPadding?: number;
  find?: number;
}

/** Draws `layout` at `cols` x `rows` and returns the screen's rows, right-trimmed. */
export async function screenRows(layout: ResolvedLayout, view: SessionView, cols: number, rows: number, standIns: StandIns = {}): Promise<string[]> {
  const blocks: Record<BlockName, BlockComponent> = {
    conversation: (props) => (
      <box flexDirection="column" flexGrow={1} height="100%" overflow="hidden">
        <For each={Array.from({ length: props.rows })}>{() => <text height={1}>C</text>}</For>
      </box>
    ),
    activity: stand("A", () => standIns.activity ?? 1),
    card: (props) => {
      const card = standIns.card ?? 0;
      const pad = standIns.cardPadding ?? 1;
      createEffect(() => props.onClaim({ rows: card > 0 ? (standIns.cardClaim ?? card) : 0, padding: pad }));
      return stand("K", () => card, (p) => {
        const n = card > 0 && p.spacing.cardPadding ? pad : 0;
        return { top: n, bottom: n, letter: "k" };
      })(props);
    },
    prompt: stand("P", (props) => props.promptRows + PROMPT_FRAME_ROWS, (props) => ({ top: 0, bottom: props.spacing.promptPadding ? 1 : 0, letter: "P" })),
    find: stand("F", () => standIns.find ?? 0),
  };
  const setup = await testRender(() => <Screen layout={layout} view={view} theme={resolveTheme(DEFAULT_THEME)} blocks={blocks} />, {
    width: cols,
    height: rows,
    screenMode: "alternate-screen",
  });
  try {
    for (let i = 0; i < 3; i++) {
      await setup.flush();
      await setup.renderOnce();
    }
    return setup.captureCharFrame().split("\n").slice(0, rows).map((l) => l.trimEnd());
  } finally {
    await setup.dispose();
  }
}
