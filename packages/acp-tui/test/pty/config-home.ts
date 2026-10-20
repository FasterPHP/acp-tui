// A configuration home of a test's own for the real CLI under a PTY
// (mvp-configuration): `XDG_CONFIG_HOME` pointing at a temporary directory
// with `acp-tui/config.jsonc`, written as an editor saves it (a temporary file
// renamed over it), so the live reload sees it. Never the user's
// `~/.config/acp-tui`.
import { mkdirSync, mkdtempSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ConfigHome {
  /** The directory to give as `XDG_CONFIG_HOME`. */
  readonly home: string;
  /** `<home>/acp-tui/config.jsonc`. */
  readonly file: string;
  /** `{ XDG_CONFIG_HOME: home }`, for a PTY's environment. */
  readonly env: { readonly XDG_CONFIG_HOME: string };
  /** Saves the file (text, or an object as JSON) by renaming a temporary file over it. */
  write(content: string | object): void;
}

export function configHome(initial?: string | object): ConfigHome {
  const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-cfg-")));
  const dir = join(home, "acp-tui");
  mkdirSync(dir);
  const file = join(dir, "config.jsonc");
  let saves = 0;
  const write = (content: string | object) => {
    const tmp = join(dir, `.config.jsonc.${process.pid}.${++saves}.tmp`);
    writeFileSync(tmp, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    renameSync(tmp, file);
  };
  if (initial !== undefined) write(initial);
  return { home, file, env: { XDG_CONFIG_HOME: home }, write };
}

/** The environment of a run whose user file sets `"density": "compact"`: the PTY helpers' default
 *  since `focus` became the default density (day-one-feedback task 3.4), for the tests written
 *  against `compact`; a test about the default starts without it, and a test that gives its own
 *  `XDG_CONFIG_HOME` replaces it. */
export function compactEnv(): { XDG_CONFIG_HOME: string } {
  return configHome({ density: "compact" }).env;
}

/** The environment for a run whose user file holds `settings`. */
export function configEnv(settings: string | object): { XDG_CONFIG_HOME: string } {
  return configHome(settings).env;
}
