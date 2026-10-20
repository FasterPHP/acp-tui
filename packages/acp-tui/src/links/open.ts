// Opening a link (mvp-rendering design decision 4, task 6.3; spec tui-rendering
// "Opening links"). The target is an allowed one (conversation/markdown/links.ts),
// checked again here against the session's working directory at the moment it is
// opened, so a session switch or a stale row cannot open what the rules refuse.
//
// - The system opener (`xdg-open` on Linux and the BSDs, `open` on macOS) is
//   started with `Bun.spawn` and the target as its single argument: no shell, no
//   other argument. Every target is an absolute path or a URL whose scheme is
//   `https`, `http` or `mailto`, so it can never be read as an option.
//   `ACP_TUI_OPENER` names another program to start instead (the PTY tests point
//   it at a script that records its argument vector).
// - A local path is resolved through symlinks first: the link rules are lexical
//   (no file system access while drawing), so here the real path of the target
//   must lie inside the real working directory, or nothing is opened. A path
//   that does not exist is not opened either. The real path is what the opener
//   gets.
// - In an SSH session (`SSH_CONNECTION` or `SSH_TTY`) the opener would run on the
//   remote host, so the target is copied instead, under the clipboard rules
//   (src/selection/clipboard.ts), and the toast says so.
// - Locally, the opener gets an xdg-activation token from the compositor in
//   `XDG_ACTIVATION_TOKEN` where one can be had (activation.ts, review C7), so
//   the browser comes forward; without one it opens as before. `ACP_TUI_OPENER`
//   gets the token too.
import { realpathSync } from "node:fs";
import { classifyTarget, inside } from "../conversation/markdown/links.ts";
import type { LinkTarget } from "../conversation/markdown/types.ts";
import { resolveArgv } from "../agent/which.ts";

export type Env = Readonly<Record<string, string | undefined>>;

/** The opener program for this platform, or `ACP_TUI_OPENER`. */
export function openerCommand(env: Env = process.env, platform: NodeJS.Platform = process.platform): string {
  const own = env["ACP_TUI_OPENER"];
  if (own) return own;
  return platform === "darwin" ? "open" : "xdg-open";
}

/** Whether acp-tui runs in an SSH session (the opener would run on the remote host). */
export function remoteSession(env: Env = process.env): boolean {
  return Boolean(env["SSH_CONNECTION"] || env["SSH_TTY"]);
}

/** What the toast calls a target: its host, mail address or path as written. */
export function targetName(link: LinkTarget): string {
  return link.kind === "mail" ? `mail to ${link.shown}` : link.shown;
}

export type OpenPlan =
  | { readonly action: "open"; readonly argv: readonly string[]; readonly toast: string }
  | { readonly action: "copy"; readonly text: string; readonly toast: string }
  | { readonly action: "refuse"; readonly toast: string };

/**
 * What opening `link` does in a session in `cwd` (pure but for the `realpath` of a local path):
 * the opener's argument vector, a copy over SSH, or a refusal with its reason.
 */
export function planOpen(link: LinkTarget, cwd: string, env: Env = process.env, platform: NodeJS.Platform = process.platform): OpenPlan {
  const name = targetName(link);
  // The rules again, against the session's directory now.
  const verdict = classifyTarget(link.href, cwd);
  if (!verdict.allowed) return { action: "refuse", toast: `not opened: ${name} is not an allowed link` };
  let target = verdict.open;
  if (verdict.kind === "file") {
    let real: string;
    let base: string;
    try {
      base = realpathSync(cwd);
      real = realpathSync(verdict.open);
    } catch {
      return { action: "refuse", toast: `not opened: ${name} does not exist` };
    }
    if (!inside(base, real)) return { action: "refuse", toast: `not opened: ${name} leads outside the working directory` };
    target = real;
  }
  if (remoteSession(env)) return { action: "copy", text: target, toast: name };
  return { action: "open", argv: [openerCommand(env, platform), target], toast: `opening ${name}` };
}

export interface Spawned {
  readonly exited: Promise<number>;
}

/** Starts the opener, in `env` when given (activation.ts `openerEnv`), resolved from that
 *  environment's `PATH` first (src/agent/which.ts: never from the working directory): its output is
 *  ignored, it is not waited for, and a failure to start, a program on no `PATH` entry included, is
 *  thrown (the caller says so in a toast). */
export function spawnOpener(argv: readonly string[], env?: Record<string, string | undefined>): Spawned {
  const child = Bun.spawn(resolveArgv(argv, { env: env ?? process.env }), { stdin: "ignore", stdout: "ignore", stderr: "ignore", ...(env ? { env } : {}) });
  child.unref();
  return { exited: child.exited };
}
