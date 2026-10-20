// Opening an elicitation's URL (mvp-chrome-and-keys task 5.6, design D7; spec
// tui-layout "Elicitation card"). Pure but for the environment it is given.
//
// The system opener (`xdg-open` on Linux, `open` on macOS, or `ACP_TUI_OPENER`;
// src/links/open.ts) gets the URL as its one argument, through `Bun.spawn` and
// never a shell. Only an `https` or `http` URL without whitespace or control
// characters is opened, so the argument can never be read as an option; any
// other is refused (it can still be copied). In an SSH session the opener
// would run on the remote host, so the URL is copied instead and the notice
// says so.
import { openerCommand, remoteSession, type Env } from "../links/open.ts";

export type UrlPlan =
  | { readonly action: "open"; readonly argv: readonly string[]; readonly host: string }
  | { readonly action: "copy"; readonly host: string }
  | { readonly action: "refuse"; readonly reason: string };

/** The URL's host for a notice, or null when the URL may not be opened. */
export function openableHost(url: string): string | null {
  if (url === "" || /[\s\x00-\x1f\x7f-\x9f]/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.host === "") return null;
  return parsed.host;
}

/** What opening `url` does: the opener's argument vector, a copy over SSH, or a refusal. */
export function planUrlOpen(url: string, env: Env = process.env, platform: NodeJS.Platform = process.platform): UrlPlan {
  const host = openableHost(url);
  if (host === null) return { action: "refuse", reason: "only an https or http link is opened" };
  if (remoteSession(env)) return { action: "copy", host };
  return { action: "open", argv: [openerCommand(env, platform), url], host };
}
