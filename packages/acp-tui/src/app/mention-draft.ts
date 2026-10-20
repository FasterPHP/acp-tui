// The prompt box's file mentions (mvp-chrome-and-keys tasks 6.6 and 6.7,
// design D9): what the prompt box hands its textarea's events to. `@` typed at
// the start of the draft or after whitespace opens the file picker
// (src/overlay/FilePicker.tsx; never a pasted `@`, which arrives without a key
// press); the text typed after it filters the list; the picker closes once the
// cursor leaves the `@` word or focus leaves the prompt box. A chosen file
// replaces `@<filter>` with a mention, drawn in the accent colour and tracked
// as a range of the draft (./mentions.ts); on send each intact mention follows
// the text as a `resource_link` with the file's URI and size, never its
// content.
import { createEffect, createMemo, onCleanup, untrack } from "solid-js";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { SyntaxStyle, type KeyEvent, type TextareaRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import type { DebugLogger } from "../log.ts";
import { createFilePicker, type FilePicker } from "../overlay/FilePicker.tsx";
import { displayPath, fileUri } from "../overlay/files.ts";
import type { ResourceLinkBlock } from "../session/controller.ts";
import type { ResolvedTheme } from "../theme/index.ts";
import { promptInput } from "./prompt-input.ts";
import { columnOffset, highlightOffset, indexAtColumn, insertMention, mentionLinks, mentionQuery, startsMention, updateMentions, type Mention } from "./mentions.ts";

/** The highlights' `hlRef`, so only the mentions' are replaced. A 16-bit value: OpenTUI 0.6's
 *  native edit buffer rejects a larger one (`ot_edit_buffer_highlight failed: InvalidArgument`;
 *  0.5.12 took `0x6d656e`). */
const MENTION_HIGHLIGHT = 0x6d65;

export interface MentionDraft {
  readonly picker: FilePicker;
  /** The textarea's `syntaxStyle`: the mentions' colour. */
  readonly syntaxStyle: SyntaxStyle;
  /** The textarea's handlers. */
  contentChanged(): void;
  cursorChanged(): void;
  keyDown(key: KeyEvent): void;
  /** The `resource_link` blocks for `text`'s intact mentions. */
  links(text: string): ResourceLinkBlock[];
}

export interface MentionDraftOptions {
  readonly input: () => TextareaRenderable | undefined;
  /** The session's `cwd`, which the picker lists and the links resolve against. */
  readonly cwd: () => string;
  readonly focused: () => boolean;
  readonly theme: ResolvedTheme;
  /** Runs the edit that inserts a chosen file as one undo step (./prompt-undo.ts); default: runs it. */
  readonly atomic?: (edit: () => void) => void;
  readonly logger?: DebugLogger;
}

/** Call in a component's scope (the prompt box's): the mention style is owned by its renderer. */
export function createMentionDraft(options: MentionDraftOptions): MentionDraft {
  const { input, cwd } = options;
  // The draft as last seen and the mentions in it.
  let draft = "";
  let mentions: Mention[] = [];
  // Our own replacement of the draft (a chosen file) is not an edit of a mention.
  let applying = false;
  const cursorIndex = (box: TextareaRenderable, text: string) => indexAtColumn(text, box.cursorOffset);

  // Owned by the renderer's native scene (OpenTUI 0.6 gives every native resource an owner), so
  // it is created here, in the prompt box's component scope, and never cached across renderers.
  // Rebuilt when the theme changes (a configuration reload, new terminal colours; mvp-configuration
  // design D6): the textarea takes the new style, the mentions are highlighted again with its ID,
  // and only then is the old one destroyed.
  const renderer = useRenderer();
  const syntaxStyle = createMemo(() => {
    const style = SyntaxStyle.create(renderer.nativeScene);
    style.registerStyle("mention", { fg: options.theme.color("accent") });
    return style;
  });
  let shown: SyntaxStyle | undefined;
  createEffect(() => {
    const next = syntaxStyle();
    if (shown && shown !== next) {
      untrack(highlight);
      shown.destroy();
    }
    shown = next;
  });
  onCleanup(() => syntaxStyle().destroy());
  const highlight = () => {
    const box = input();
    if (!box || box.isDestroyed) return;
    box.removeHighlightsByRef(MENTION_HIGHLIGHT);
    const styleId = untrack(syntaxStyle).getStyleId("mention");
    if (styleId === null) return;
    const text = box.plainText;
    for (const m of mentions) {
      box.addHighlightByCharRange({ start: highlightOffset(text, m.start), end: highlightOffset(text, m.end), styleId, hlRef: MENTION_HIGHLIGHT });
    }
  };

  const picker = createFilePicker((path, anchor) => {
    const box = input();
    if (!box || box.isDestroyed) return;
    const text = box.plainText;
    const cursor = cursorIndex(box, text);
    if (mentionQuery(text, cursor, anchor) === null) return;
    // The mention's text through the prompt box's input rule (./prompt-input.ts), so a file name
    // with a control character cannot put the draft and the mention ranges out of step (the rest
    // of the draft entered through the same rule already).
    const next = insertMention(text, anchor, cursor, path, promptInput(displayPath(path)), mentions);
    applying = true;
    try {
      (options.atomic ?? ((edit: () => void) => edit()))(() => {
        box.replaceText(next.text);
        box.cursorOffset = columnOffset(next.text, next.cursor);
      });
    } finally {
      applying = false;
    }
    draft = next.text;
    mentions = next.mentions;
    highlight();
  }, options.logger);

  createEffect(() => {
    if (!options.focused()) untrack(() => picker.close());
  });

  // The picker follows the `@` word at the cursor.
  const follow = () => {
    const box = input();
    if (!box || !picker.isOpen()) return;
    const text = box.plainText;
    const query = mentionQuery(text, cursorIndex(box, text), picker.anchor());
    if (query === null) picker.close();
    else picker.setQuery(query);
  };

  return {
    picker,
    get syntaxStyle() {
      return syntaxStyle();
    },
    contentChanged: () => {
      const box = input();
      if (!box || applying) return;
      const text = box.plainText;
      const before = draft;
      draft = text;
      const had = mentions.length;
      mentions = updateMentions(mentions, before, text);
      if (had > 0) highlight();
      follow();
    },
    cursorChanged: follow,
    // The key's handler runs before the textarea's, which inserts the `@` synchronously; the
    // picker opens once it is in the draft.
    keyDown: (key) => {
      const box = input();
      if (!box || key.sequence !== "@" || key.ctrl || key.meta || picker.isOpen()) return;
      const at = cursorIndex(box, box.plainText);
      queueMicrotask(() => {
        const now = input();
        if (!now || now.isDestroyed || picker.isOpen() || !startsMention(now.plainText, at)) return;
        picker.open(at, cwd());
        // Keys of the same read may already have typed after it.
        follow();
      });
    },
    links: (text) =>
      mentionLinks(text, mentions, {
        uri: (path) => fileUri(cwd(), path),
        size: (path) => {
          try {
            const stat = statSync(resolve(cwd(), path));
            return stat.isFile() ? stat.size : null;
          } catch {
            return null;
          }
        },
      }),
  };
}
