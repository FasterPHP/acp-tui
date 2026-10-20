// SPIKE (phase-1a, S4): helpers for the selection PTY tests. The child gets no
// `WAYLAND_DISPLAY` or `DISPLAY` (so acp-tui starts no host clipboard backend,
// src/selection/clipboard.ts), an empty `XDG_RUNTIME_DIR`, and no SSH
// variables; OSC 52 goes to `@xterm/headless`, which has no clipboard, and the
// copied text is read back from the PTY output. Nothing reaches the user's
// clipboard.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** No host clipboard reachable, not a remote session; `extra` on top. */
export function localEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    WAYLAND_DISPLAY: undefined,
    DISPLAY: undefined,
    XDG_RUNTIME_DIR: mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-no-display-")),
    SSH_CONNECTION: undefined,
    SSH_CLIENT: undefined,
    SSH_TTY: undefined,
    ...extra,
  };
}

/** Every OSC 52 payload in the output, decoded. */
export function osc52Payloads(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(/\x1b\]52;[^;]*;([A-Za-z0-9+/=]*)(?:\x07|\x1b\\)/g)) out.push(Buffer.from(m[1]!, "base64").toString("utf8"));
  return out;
}
