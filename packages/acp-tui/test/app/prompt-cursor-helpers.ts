// Shared by prompt-cursor.pty.test.ts and prompt-cursor.pty.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.
import { join, resolve } from "node:path";
import { startPty, type PtySession } from "../pty/harness.ts";
import { configHome, type ConfigHome } from "../pty/config-home.ts";
import { promptText, READY } from "../pty/regions.ts";

export const ROOT = resolve(import.meta.dir, "../../../..");
export const CLI = join(ROOT, "packages/acp-tui/src/cli.ts");
export const FAKE_AGENT = join(ROOT, "packages/fake-agent/src/main.ts");
export const LEFT = "\x1b[D";
export const FOCUS_IN = "\x1b[I";
export const FOCUS_OUT = "\x1b[O";
export const F12 = "\x1b[24~";

export function start(opts: { config?: ConfigHome; env?: Record<string, string>; terminal?: "xterm" | "jediterm" } = {}): PtySession {
  const home = opts.config ?? configHome({ density: "compact" });
  const s = startPty(["bun", CLI, "--", "--", "bun", FAKE_AGENT, "--scenario", "basic", "--delay-scale", "0"], {
    cols: 80,
    rows: 24,
    env: { ...home.env, WAYLAND_DISPLAY: undefined, DISPLAY: undefined, ...opts.env },
    ...(opts.terminal ? { terminal: opts.terminal } : {}),
  });
  session = s;
  return s;
}

/** Every DECSCUSR written so far, as its parameter. */
export function shapes(s: PtySession): string[] {
  return [...s.rawOutput().matchAll(/\x1b\[(\d) q/g)].map((m) => m[1]!);
}

export const lastShape = (s: PtySession): string | undefined => shapes(s).at(-1);
export const shapeIs = (shape: string) => (s: PtySession) => lastShape(s) === shape;

export async function typed(s: PtySession, text: string): Promise<void> {
  await s.waitFor(READY, 10000);
  s.sendKeys({ text });
  await s.waitFor((p) => promptText(p)[0] === text, 5000);
}

let session: PtySession | undefined;

/** For each test file's `afterEach`. */
export async function disposeSession(): Promise<void> {
  session?.kill("SIGKILL");
  await session?.dispose();
  session = undefined;
}
