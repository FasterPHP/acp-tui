// PTY test harness (task 6.2). Runs a command under Bun's built-in PTY
// (`Bun.spawn({ terminal })`, Bun >= 1.3) and feeds its output into an
// @xterm/headless terminal, so tests can assert on the screen, the scrollback
// and cell attributes. The emulator's own replies to queries (DA, CPR, DECRQM)
// are written back to the PTY, as a real terminal would.
import { Terminal as XTerm } from "@xterm/headless";
import { modesSet, parseModeChanges, MOUSE_MODES, type ModeChange } from "./modes.ts";
import {
  loadFixture,
  sgrMotion,
  sgrPress,
  sgrReport,
  sgrRelease,
  sgrWheel,
  type FixtureRecord,
  type MouseButtonName,
  type MouseModifiers,
} from "./mouse.ts";
import { diffSnapshots, snapshotBuffer, type ScreenSnapshot } from "./snapshot.ts";
import { TEST_HOOKS_VAR } from "../../src/renderer/test-hooks.ts";
import { JEDITERM_ENV, JediTermFilter } from "./jediterm.ts";

export * from "./jediterm.ts";
export * from "./modes.ts";
export * from "./mouse.ts";
export * from "./snapshot.ts";

/**
 * Colours the emulator reports to OSC 10 (foreground) and OSC 11 (background)
 * queries, as `#rrggbb`. A missing colour gets no reply. OSC 4 (palette) queries
 * are never answered, which is what PhpStorm's terminals do.
 */
export interface OscColours {
  foreground?: string;
  background?: string;
  /** How replies are terminated; default `st` (`ESC `). */
  terminator?: "bel" | "st";
}

export interface PtyStartOptions {
  cols?: number;
  rows?: number;
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** xterm scrollback lines; default 10000. */
  scrollback?: number;
  /** Write the emulator's query replies back to the child; default true. */
  answerQueries?: boolean;
  /** Answer OSC 10 and 11 with these colours; default: no reply. Change later with `setColours`. */
  colours?: OscColours;
  /**
   * Written to the emulator before the child starts, so the main screen holds
   * something (a prompt, coloured text) for `mainBefore()` and `mainDiff()` to
   * compare. Use `\r\n` for line ends.
   */
  prefill?: string;
  /**
   * The terminal to emulate; default `xterm` (xterm.js as it is). `jediterm` imitates
   * PhpStorm's terminals (jediterm.ts): their environment (no `COLORTERM`), `CSI s` and `CSI u`
   * ignored, and APC strings printed as text. `env` still overrides the environment.
   */
  terminal?: "xterm" | "jediterm";
}

/**
 * The `ACP_TUI_TEST_HOOKS` value for a PTY child: what the test named, plus `no-host-clipboard`, so
 * no PTY test reaches the real clipboard on any platform (renderer/test-hooks.ts). A test that puts
 * stub clipboard programs on `PATH` names `no-native-clipboard` instead, which keeps the stubs
 * working and still creates no native backend.
 */
export function clipboardTestHooks(named: string | undefined): string {
  const hooks = (named ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  if (!hooks.includes("no-native-clipboard") && !hooks.includes("no-host-clipboard")) hooks.push("no-host-clipboard");
  return hooks.join(",");
}

/** Named keys and the bytes a terminal sends for them. */
export const KEYS = {
  Enter: "\r",
  Esc: "\x1b",
  Tab: "\t",
  ShiftTab: "\x1b[Z",
  Backspace: "\x7f",
  Space: " ",
  "Ctrl+C": "\x03",
  "Ctrl+D": "\x04",
  "Ctrl+J": "\n",
  "Ctrl+L": "\x0c",
  "Ctrl+O": "\x0f",
  "Ctrl+P": "\x10",
  "Ctrl+Q": "\x11",
  Up: "\x1b[A",
  Down: "\x1b[B",
  Right: "\x1b[C",
  Left: "\x1b[D",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Home: "\x1b[H",
  End: "\x1b[F",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  /** Shift+Enter in the kitty keyboard protocol form. */
  "Shift+Enter": "\x1b[13;2u",
  /** Shift+Enter as JetBrains' "Send Esc+CR" setting sends it (also Alt+Enter). */
  "Shift+Enter:esc-cr": "\x1b\r",
  /** Shift+Enter in xterm modifyOtherKeys form. */
  "Shift+Enter:modify-other-keys": "\x1b[27;2;13~",
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
} as const;

export type KeyName = keyof typeof KEYS;

export function bracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}

export type WaitCondition = string | RegExp | ((session: PtySession) => boolean);

export class PtySession {
  readonly term: XTerm;
  private readonly proc: Bun.Subprocess;
  private readonly decoder = new TextDecoder();
  private readonly jediterm: JediTermFilter | null;
  private raw = "";
  private pending: Promise<void> = Promise.resolve();
  private eof: Promise<void>;
  private exitCodeValue: number | null = null;
  private colours: OscColours | undefined;
  private readonly before: Promise<ScreenSnapshot>;
  /** OSC numbers (4, 10, 11) the child has queried with `?`, in order. */
  readonly oscQueries: number[] = [];

  constructor(cmd: string[], opts: PtyStartOptions = {}) {
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;
    this.term = new XTerm({ cols, rows, scrollback: opts.scrollback ?? 10000, allowProposedApi: true });
    this.colours = opts.colours;
    this.jediterm = opts.terminal === "jediterm" ? new JediTermFilter() : null;
    this.term.parser.registerOscHandler(4, (data) => {
      if (data.includes("?")) this.oscQueries.push(4);
      return true; // consumed, never answered
    });
    for (const code of [10, 11] as const) {
      this.term.parser.registerOscHandler(code, (data) => {
        if (data !== "?") return false;
        this.oscQueries.push(code);
        this.answerColour(code);
        return true;
      });
    }
    if (opts.prefill) this.pending = this.pending.then(() => new Promise<void>((r) => this.term.write(opts.prefill!, r)));
    this.before = this.pending.then(() => snapshotBuffer(this.term, "normal", "all"));
    let resolveEof!: () => void;
    this.eof = new Promise((r) => (resolveEof = r));
    const env: Record<string, string> = {};
    const emulated = opts.terminal === "jediterm" ? JEDITERM_ENV : {};
    for (const [k, v] of Object.entries({ ...process.env, TERM: "xterm-256color", ...emulated, ...opts.env })) {
      if (v !== undefined) env[k] = v;
    }
    env[TEST_HOOKS_VAR] = clipboardTestHooks(env[TEST_HOOKS_VAR]);
    this.proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      env,
      terminal: {
        cols,
        rows,
        name: env.TERM,
        data: (_t, data) => this.feed(data),
        exit: () => resolveEof(),
      },
    });
    if (opts.answerQueries ?? true) {
      this.term.onData((reply) => {
        if (this.exitCodeValue === null) this.proc.terminal?.write(reply);
      });
    }
    this.proc.exited.then((code) => (this.exitCodeValue = code));
  }

  private feed(data: Uint8Array): void {
    const text = this.decoder.decode(data, { stream: true });
    this.raw += text;
    const out: string | Uint8Array = this.jediterm ? this.jediterm.push(text) : data;
    this.pending = this.pending.then(() => new Promise<void>((r) => this.term.write(out, r)));
  }

  /** Resolves once xterm has parsed everything received so far. */
  async flush(): Promise<void> {
    let before: Promise<void>;
    do {
      before = this.pending;
      await before;
    } while (before !== this.pending);
  }

  write(data: string): void {
    this.proc.terminal?.write(data);
  }

  sendKeys(...keys: (KeyName | { text: string })[]): void {
    for (const key of keys) this.write(typeof key === "string" ? KEYS[key] : key.text);
  }

  paste(text: string): void {
    this.write(bracketedPaste(text));
  }

  /** Resizes the PTY (the child gets SIGWINCH) and the emulator together. */
  resize(cols: number, rows: number): void {
    this.proc.terminal?.resize(cols, rows);
    this.term.resize(cols, rows);
  }

  private answerColour(code: 10 | 11): void {
    const c = this.colours;
    const hex = code === 10 ? c?.foreground : c?.background;
    if (!hex || this.exitCodeValue !== null) return;
    const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
    if (!m) throw new Error(`OSC colour must be #rrggbb, got ${hex}`);
    const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => h.toLowerCase().repeat(2));
    const end = c?.terminator === "bel" ? "\x07" : "\x1b\\";
    this.proc.terminal?.write(`\x1b]${code};rgb:${r}/${g}/${b}${end}`);
  }

  /** Changes (or, with `undefined`, removes) the colours answered to later OSC 10 and 11 queries. */
  setColours(colours: OscColours | undefined): void {
    this.colours = colours;
  }

  // Mouse injection. Cells are 0-based (x = column, y = row), as in OpenTUI's
  // MouseEvent; see mouse.ts for the wire form and the fixture format.

  mousePress(x: number, y: number, button: MouseButtonName = "left", mods?: MouseModifiers): void {
    this.write(sgrPress(x, y, button, mods));
  }

  mouseRelease(x: number, y: number, button: MouseButtonName = "left", mods?: MouseModifiers): void {
    this.write(sgrRelease(x, y, button, mods));
  }

  /** Press and release at one cell. */
  mouseClick(x: number, y: number, button: MouseButtonName = "left", mods?: MouseModifiers): void {
    this.write(sgrPress(x, y, button, mods) + sgrRelease(x, y, button, mods));
  }

  /** Motion: a drag when `button` is given (the button bit present), plain motion (code 35) when not. */
  mouseMove(x: number, y: number, button?: MouseButtonName, mods?: MouseModifiers): void {
    this.write(sgrMotion(x, y, button, mods));
  }

  /** A wheel report with code 64 (up), 65 (down), 68 or 69 (JediTerm's up and down). */
  mouseWheel(x: number, y: number, code: 64 | 65 | 68 | 69, mods?: MouseModifiers): void {
    this.write(sgrWheel(x, y, code, mods));
  }

  /** Any SGR report, for codes the helpers do not cover. */
  mouseReport(code: number, x: number, y: number, final: "M" | "m" = "M"): void {
    this.write(sgrReport(code, x, y, final));
  }

  /**
   * Writes recorded input at its recorded times (relative to the call).
   * `speed` scales the clock (2 is twice as fast; `Infinity` writes at once).
   * Resolves once the last record is written; returns the elapsed milliseconds.
   */
  async replay(records: readonly FixtureRecord[] | string, opts: { speed?: number } = {}): Promise<number> {
    const list = typeof records === "string" ? await loadFixture(records) : records;
    const speed = opts.speed ?? 1;
    const start = performance.now();
    for (const rec of list) {
      const wait = rec.t_ms / speed - (performance.now() - start);
      if (wait > 0.5) await Bun.sleep(wait);
      this.write(rec.data);
    }
    return performance.now() - start;
  }

  // Terminal modes, from the whole output stream (modes.ts).

  modeChanges(): ModeChange[] {
    return parseModeChanges(this.raw);
  }

  /** DEC private modes set at the end of the output so far (call after `wait()` for the exit state). */
  modesSet(): number[] {
    return modesSet(this.modeChanges());
  }

  /** The mouse modes (1000, 1002, 1003, 1006) currently set. */
  mouseModesSet(): number[] {
    const set = this.modesSet();
    return MOUSE_MODES.filter((m) => set.includes(m));
  }

  /** How many times the output set (`on`) or reset (`!on`) `mode`. */
  countModeChanges(mode: number, on: boolean): number {
    return this.modeChanges().filter((c) => c.mode === mode && c.on === on).length;
  }

  // Snapshots (snapshot.ts).

  /** The main (normal-buffer) screen now, scrollback included. */
  mainSnapshot(): ScreenSnapshot {
    return snapshotBuffer(this.term, "normal", "all");
  }

  /** The main screen as it was before the child started (after `prefill`). */
  mainBefore(): Promise<ScreenSnapshot> {
    return this.before;
  }

  /** Differences between the main screen before start and now; empty when it is unchanged. */
  async mainDiff(): Promise<string[]> {
    await this.flush();
    return diffSnapshots(await this.before, this.mainSnapshot());
  }

  /** The visible screen of the active buffer (the alternate screen while the child is on it). */
  screenSnapshot(): ScreenSnapshot {
    return snapshotBuffer(this.term, "active", "viewport");
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  /**
   * Buffer line `absY` as text. Written spaces count as content in xterm, so
   * `trim: false` keeps rows that were painted with blanks distinguishable
   * from rows never written.
   */
  lineText(absY: number, trim = true): string {
    const text = this.term.buffer.active.getLine(absY)?.translateToString(true, 0, this.term.cols) ?? "";
    return trim ? text.trimEnd() : text;
  }

  /** Every buffer line, scrollback then viewport, right-trimmed. */
  scrollbackText(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.term.buffer.active.length; y++) out.push(this.lineText(y));
    return out;
  }

  /** The visible viewport rows, right-trimmed. */
  screenText(): string[] {
    const base = this.term.buffer.active.baseY;
    const out: string[] = [];
    for (let y = 0; y < this.term.rows; y++) out.push(this.lineText(base + y));
    return out;
  }

  /**
   * The last `n` rows of the screen, ending at the last written row. A
   * full-screen app paints every row, so these are its bottom rows (the
   * status bar, composer and hints of acp-tui's footer).
   */
  footerRows(n: number): string[] {
    const base = this.term.buffer.active.baseY;
    let last = this.term.rows - 1;
    while (last > 0 && this.lineText(base + last, false) === "") last--;
    const out: string[] = [];
    for (let y = Math.max(0, last - n + 1); y <= last; y++) out.push(this.lineText(base + y));
    return out;
  }

  /** Scrollback lines above the viewport only. */
  historyText(): string[] {
    return this.scrollbackText().slice(0, this.term.buffer.active.baseY);
  }

  rawOutput(): string {
    return this.raw;
  }

  /** Absolute buffer line index of the first line containing `text`, or -1. */
  findLine(text: string | RegExp): number {
    const lines = this.scrollbackText();
    return lines.findIndex((l) => (typeof text === "string" ? l.includes(text) : text.test(l)));
  }

  cell(absY: number, x: number) {
    return this.term.buffer.active.getLine(absY)?.getCell(x);
  }

  async waitFor(cond: WaitCondition, timeoutMs = 5000): Promise<void> {
    const test = (): boolean => {
      if (typeof cond === "function") return cond(this);
      const all = this.scrollbackText().join("\n");
      return typeof cond === "string" ? all.includes(cond) : cond.test(all);
    };
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await this.flush();
      if (test()) return;
      if (Date.now() > deadline) {
        throw new Error(
          `waitFor timed out after ${timeoutMs} ms: ${String(cond)}\n--- screen ---\n${this.screenText().join("\n")}`,
        );
      }
      await Bun.sleep(15);
    }
  }

  get exitCode(): number | null {
    return this.exitCodeValue;
  }

  /** Waits for the child to exit and for the PTY to drain; returns the exit code. */
  async wait(timeoutMs = 5000): Promise<number> {
    const timer = Bun.sleep(timeoutMs).then(() => {
      throw new Error(`process did not exit within ${timeoutMs} ms`);
    });
    const code = await Promise.race([this.proc.exited, timer]);
    await Promise.race([this.eof, Bun.sleep(500)]);
    await this.flush();
    return code;
  }

  kill(signal: NodeJS.Signals | number = "SIGTERM"): void {
    this.proc.kill(signal);
  }

  async dispose(): Promise<void> {
    if (this.exitCodeValue === null) {
      this.proc.kill("SIGKILL");
      await this.proc.exited;
    }
    this.proc.terminal?.close();
    this.term.dispose();
  }
}

export function startPty(cmd: string[], opts?: PtyStartOptions): PtySession {
  return new PtySession(cmd, opts);
}

export interface FreshRenderOptions extends PtyStartOptions {
  /** Brings the fresh instance to the state of the one it is compared with (keys, mouse, waits). */
  drive?: (session: PtySession) => void | Promise<void>;
  /** Ready when this holds; default: the output has been quiet for `quietMs`. */
  ready?: WaitCondition;
  /** Quiet period that counts as settled when `ready` is not given; default 400 ms. */
  quietMs?: number;
  timeoutMs?: number;
}

/**
 * Starts a second instance of `command` at `cols` x `rows` (the size the first
 * one was resized to), brings it to the same state with `drive`, waits until
 * it is ready, and returns its visible screen. Compare with
 * `diffSnapshots(fresh, session.screenSnapshot())` to check that a resized or
 * repainted screen equals a fresh render at the final size. The instance is
 * killed before returning.
 */
export async function freshRender(
  command: string[],
  cols: number,
  rows: number,
  opts: FreshRenderOptions = {},
): Promise<ScreenSnapshot> {
  const { drive, ready, quietMs = 400, timeoutMs = 10000, ...start } = opts;
  const session = startPty(command, { ...start, cols, rows });
  try {
    await drive?.(session);
    if (ready !== undefined) {
      await session.waitFor(ready, timeoutMs);
    } else {
      const deadline = Date.now() + timeoutMs;
      let seen = -1;
      let quietSince = Date.now();
      for (;;) {
        await session.flush();
        const size = session.rawOutput().length;
        if (size !== seen) {
          seen = size;
          quietSince = Date.now();
        } else if (size > 0 && Date.now() - quietSince >= quietMs) {
          break;
        }
        if (Date.now() > deadline) throw new Error(`freshRender: output did not settle within ${timeoutMs} ms`);
        await Bun.sleep(25);
      }
    }
    await session.flush();
    return session.screenSnapshot();
  } finally {
    await session.dispose();
  }
}
