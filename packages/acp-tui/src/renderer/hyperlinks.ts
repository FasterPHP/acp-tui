// OSC 8 only where verified (mvp-rendering design decision 4, task 6.4; spec
// tui-rendering "OSC 8 only where verified").
//
// OpenTUI writes OSC 8 around cells whose text chunk carries a `link`, but
// only while its native session believes the terminal supports hyperlinks. On
// its own it decides that from the terminal's name and replies (since 0.5.17:
// yes for Zed, kitty and others, no for JediTerm), and may decide again when
// an XTVERSION reply arrives. Measured under a PTY: the native writer then
// writes `ESC ] 8 ; id=N ; <url> ESC \` before the first linked cell and
// `ESC ] 8 ; ; ESC \` after the last one.
//
// acp-tui decides instead, by its capability table (`osc8`, capabilities.ts):
// since OpenTUI 0.6 (opentui-0-6 design D4) the renderer is constructed with
// `FORCE_HYPERLINK` in its `environment` (create.ts), `1` where the table says
// `osc8` and `0` everywhere else. OpenTUI treats it as a sticky override that
// it applies again after an XTVERSION reply, so its own detection never
// decides (probe `docs/mvp-notes/opentui-0.6-probes/hyperlinks.ts`). Off,
// OpenTUI writes no OSC 8 even for a chunk with a link (its own Markdown
// linkifier included); on, it writes it for the chunks draw.ts links, which
// carry only allowed targets with the URL acp-tui built. 0.6 has no run-time
// setter, so the capability is fixed for the renderer's life (0.5.12's
// `setHyperlinksCapability`, which acp-tui called through `bun:ffi`, is gone
// from the native library).
import { NULL_LOGGER, type DebugLogger } from "../log.ts";

/** The renderer environment entry that makes OpenTUI's hyperlink capability `osc8`. */
export function hyperlinkEnv(osc8: boolean): { FORCE_HYPERLINK: "1" | "0" } {
  return { FORCE_HYPERLINK: osc8 ? "1" : "0" };
}

/** Logs `hyperlinks` (`osc8`): what the renderer was constructed with. */
export function logHyperlinks(osc8: boolean, logger: DebugLogger = NULL_LOGGER): void {
  logger.log({ event: "hyperlinks", osc8 });
}
