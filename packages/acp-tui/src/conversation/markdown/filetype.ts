// Which grammar highlights a fence (spec tui-rendering "Syntax highlighting"): the info string's
// first word through OpenTUI's own mapping (`ts` to `typescript`, `sh` to `bash`, `py` to
// `python`, `yml` to `yaml`), then the aliases acp-tui registers with its bundled grammars
// (grammars.ts), down to a filetype with a grammar: JavaScript, TypeScript and TSX (OpenTUI's
// own) and the six bundled ones. Anything else (`cobol`, `mermaid`, `text`, no language) has none and
// is drawn in `code.default`; `diff` and `patch` are coloured by line role instead (code.ts).
import { infoStringToFiletype } from "@opentui/core";
import { BUNDLED_GRAMMARS } from "../grammars.ts";

/** OpenTUI's bundled code grammars, with the aliases it registers for them. Since OpenTUI 0.6,
 *  `typescriptreact` (a `tsx` fence) has a grammar of its own, OpenTUI's TSX grammar, which parses
 *  JSX; `javascriptreact` stays on `javascript`, whose grammar parses JSX already (opentui-0-6
 *  design D6). */
const OPENTUI_GRAMMARS: Readonly<Record<string, string>> = {
  javascript: "javascript",
  javascriptreact: "javascript",
  typescript: "typescript",
  typescriptreact: "typescriptreact",
};

/** Filetype (or alias) to the filetype whose grammar highlights it. */
const GRAMMAR_OF: ReadonlyMap<string, string> = new Map([
  ...Object.entries(OPENTUI_GRAMMARS),
  ...BUNDLED_GRAMMARS.flatMap(({ filetype, aliases = [] }) => [[filetype, filetype] as const, ...aliases.map((a) => [a, filetype] as const)]),
]);

/** The filetype of the grammar that highlights a fence of `lang`, or null when none does. */
export function codeFiletype(lang: string | undefined): string | null {
  const word = (lang ?? "").trim().split(/\s+/)[0] ?? "";
  if (word === "") return null;
  const mapped = infoStringToFiletype(word) ?? word.toLowerCase();
  return GRAMMAR_OF.get(mapped) ?? GRAMMAR_OF.get(word.toLowerCase()) ?? null;
}
