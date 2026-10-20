// The terminal environment OpenTUI's native start-up sees (S1 bugs 1 to 3 of
// phase-1a; design D2, D3, D8). OpenTUI decides its start-up probes and its
// colour depth from environment variables that the `CliRenderer` constructor
// copies out of `process.env` (its default `forwardEnvKeys`) into the native
// session, with its `environment` option on top (OpenTUI 0.6). acp-tui
// overrides three of them, for the renderer only, through `environment`
// (create.ts; `FORCE_HYPERLINK` is added there, hyperlinks.ts):
//
// - `OPENTUI_FORCE_EXPLICIT_WIDTH=false` skips the OSC 66 width probes. They
//   are written on the main screen, before `CSI ? 1049 h`, and move the cursor
//   home (`CSI H`) between `CSI s` and `CSI u`. JediTerm ignores `CSI s` and
//   `CSI u`, so the cursor was still at home when `CSI ? 1049 h` saved it and
//   the exit text overwrote the command line (bug 1). Without the probes
//   nothing moves the cursor on the main screen, and design D3 holds as
//   written. The cost: OpenTUI never learns explicit-width support (kitty's
//   OSC 66), which none of the priority terminals has.
// - `OPENTUI_GRAPHICS=false` skips the kitty graphics query (an APC string,
//   `ESC _ G i=31337 ... ESC \`) and the DA1 query sent with it. JediTerm does
//   not parse APC and printed the query as text on the main screen (bug 2).
//   acp-tui draws no images.
// - `COLORTERM=truecolor` when the terminal is known to draw 24-bit colour but
//   does not say so: PhpStorm's JediTerm (`TERMINAL_EMULATOR=JetBrains-JediTerm`)
//   sets no `COLORTERM`, so OpenTUI downsampled the derived surfaces to 256
//   colours and the selected permission option vanished (bug 3). Zed
//   (`TERM_PROGRAM=zed`) sets `COLORTERM` itself; it is listed in case a build
//   does not. Windows Terminal sets only `WT_SESSION`, so that names it too.
//
// `process.env` is never changed, so nothing else (the agent's child process,
// spawned with `process.env`) sees the overrides. (Until OpenTUI 0.5.12 they
// were put in `process.env` for the constructor's synchronous span, `withEnv`.)

/** Environment values that name a 24-bit colour terminal in `COLORTERM`. */
const TRUECOLOUR_VALUES = new Set(["truecolor", "24bit"]);

/** True when the environment says, or the terminal is known, to draw 24-bit colour. */
export function knownTruecolour(env: Readonly<Record<string, string | undefined>>): boolean {
  if (TRUECOLOUR_VALUES.has(env.COLORTERM ?? "")) return true;
  if (env.TERMINAL_EMULATOR === "JetBrains-JediTerm") return true;
  // Windows Terminal sets only WT_SESSION (no COLORTERM, TERM or TERM_PROGRAM) and draws 24-bit colour.
  if (env.WT_SESSION) return true;
  return env.TERM_PROGRAM === "zed";
}

/** The overrides for OpenTUI's native start-up, given the process environment. */
export function rendererEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {
    OPENTUI_FORCE_EXPLICIT_WIDTH: "false",
    OPENTUI_GRAPHICS: "false",
  };
  if (!TRUECOLOUR_VALUES.has(env.COLORTERM ?? "") && knownTruecolour(env)) out.COLORTERM = "truecolor";
  return out;
}
