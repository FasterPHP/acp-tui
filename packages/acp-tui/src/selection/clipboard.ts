// The clipboard for copy; design of record 6.3 "Clipboard"; decision 11,
// research/full-screen-synthesis.md section 4.
//
// Through OpenTUI's `createClipboard`: the host backend first, then OSC 52.
// OpenTUI's `best-available` policy already does exactly that: in a remote
// session (the renderer's `capabilities.remote`, which OpenTUI derives from
// `SSH_CONNECTION` and the other variables it forwards) it goes straight to
// OSC 52; locally it tries the host and falls back to OSC 52 only when the host
// write is `unsupported` or `failed`.
//
// The host step (mvp-chrome-and-keys task 12.6; tui-selection "Copied text kept
// after exit"): OpenTUI's host backend is native (libopentui: the Wayland
// data-control protocols and XCB on Linux, NSPasteboard on macOS). On Linux
// acp-tui's own process serves the text and it is gone when acp-tui exits unless
// a clipboard manager took a copy. So the host step first hands the text to
// `wl-copy` (with `WAYLAND_DISPLAY`) or `xclip -selection clipboard` (with only
// `DISPLAY`), found on the `PATH` of the copier's environment, which keep serving
// after acp-tui exits: started with an argument list (no shell) in a session of
// its own, the text on stdin, stdio otherwise closed; the copy waits only for
// that process to exit (both fork a child that stays to serve and exit once they
// have the text), at most `HELPER_TIMEOUT_MS`, and kills it after that. When the
// program is missing, fails or times out, the native backend takes the text, as
// before. The toast says which (`copyToast`).
//
// On macOS (`process.platform` `darwin`, injectable as `platform`; mvp-configuration,
// Marcus's working day on his Mac) the host is the general pasteboard, whatever the
// display variables say (XQuartz sets `DISPLAY` there): the host step runs `pbcopy`,
// found on the same `PATH` and run by the same rules (with a UTF-8 locale, since
// `pbcopy` and `pbpaste` take their text encoding from it), which exits once the
// pasteboard holds the text and serves nothing; the pasteboard keeps the text after
// acp-tui exits. When `pbcopy` is missing or fails, OpenTUI's native backend writes
// the pasteboard (`setString:forType:`, OpenTUI 0.6.1's `macos-shim.m`), which keeps
// the text after exit too, so its toast carries no "until acp-tui exits". In a remote
// session (`SSH_CONNECTION`, `SSH_CLIENT` or `SSH_TTY`) a Mac has no host clipboard
// here: the pasteboard is the remote machine's.
//
// A process with neither `WAYLAND_DISPLAY` nor `DISPLAY` on Linux gets no host
// backend at all here (a stub that answers `unsupported`) and starts no clipboard
// program, so the native service is never started without a display; the service
// is created on the first copy that needs it.
//
// OSC 52 cannot be confirmed: the terminal may ignore it (the toast says so).
//
// The `clipboard` setting (or `--clipboard`) restricts the paths: `auto` (default:
// host, then OSC 52), `host` (host only), `osc52` (OSC 52 only), `none` (copy
// nothing). The PTY tests remove the display variables, so on Linux they never
// reach the user's clipboard (on macOS they would: the pasteboard needs no display
// variable); the tests of the clipboard programs set `PATH` to stubs, the display
// variables and the platform explicitly.
import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  type ClipboardReadResult,
  type ClipboardService,
  type ClipboardWriteDestination,
  type ClipboardWriteResult,
  type HostClipboardOperationOptions,
  type HostClipboardService,
  type HostClipboardWriteResult,
  type RendererClipboardBoundary,
} from "@opentui/core";
import { NULL_LOGGER, type DebugLogger } from "../log.ts";
import type { ClipboardMode } from "../renderer/options.ts";

export type { ClipboardMode };

/** The host clipboard in use: a Wayland or X11 display on Linux, the macOS pasteboard, or none. */
export type HostKind = "wayland" | "x11" | "macos";

/** Whether a host clipboard can exist at all: on macOS the pasteboard (locally), elsewhere a
 *  Wayland or X11 display. */
export function hostDisplay(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): HostKind | null {
  if (platform === "darwin") return env["SSH_CONNECTION"] || env["SSH_CLIENT"] || env["SSH_TTY"] ? null : "macos";
  if (env["WAYLAND_DISPLAY"]) return "wayland";
  if (env["DISPLAY"]) return "x11";
  return null;
}

/** 16 MiB: far above any conversation, below anything that would stall the terminal. */
const MAX_WRITE_BYTES = 16 * 1024 * 1024;

/** A host backend that is never there (no display). */
export const NO_HOST: HostClipboardService = {
  maxWriteBytes: MAX_WRITE_BYTES,
  read: async () => ({ status: "unsupported" }),
  writeText: async () => ({ status: "unsupported" }),
  clear: async () => ({ status: "unsupported" }),
  dispose: async () => {},
};

// -- Clipboard programs that outlive acp-tui (task 12.6) --------------------------------------

/** A clipboard program found on `PATH`: its name (for the toast and the log) and argument list. */
export interface CopyHelper {
  readonly name: "wl-copy" | "xclip" | "pbcopy";
  /** The absolute path first; the text goes on stdin, never here. */
  readonly argv: readonly string[];
  /** Variables set over the copier's environment for this program (`pbcopy`'s UTF-8 locale). */
  readonly env?: Readonly<Record<string, string>>;
}

/** How long a clipboard program may take to take the text and exit (its serving child stays). */
export const HELPER_TIMEOUT_MS = 2000;

/** `pbcopy` and `pbpaste` encode the text by the locale (`LANG`, and `LC_ALL` over it): without a
 *  UTF-8 one (a terminal or launcher that sets none) they mangle anything outside ASCII. */
const MACOS_UTF8: Readonly<Record<string, string>> = { LANG: "en_US.UTF-8", LC_CTYPE: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };

/** The clipboard program for `display`, searched only on `env.PATH` (no `PATH`, no program):
 *  `wl-copy --type text/plain` on Wayland (text, so no MIME sniffing; wl-copy adds the usual
 *  text aliases), `xclip -selection clipboard` on X11, `pbcopy` on macOS. */
export function findCopyHelper(display: HostKind | null, env: Readonly<Record<string, string | undefined>>): CopyHelper | null {
  const PATH = env["PATH"];
  if (!PATH || !display) return null;
  if (display === "macos") {
    const path = Bun.which("pbcopy", { PATH, cwd: "/" });
    return path ? { name: "pbcopy", argv: [path], env: MACOS_UTF8 } : null;
  }
  const [name, args] = display === "wayland" ? (["wl-copy", ["--type", "text/plain"]] as const) : (["xclip", ["-selection", "clipboard"]] as const);
  const path = Bun.which(name, { PATH, cwd: "/" });
  return path ? { name, argv: [path, ...args] } : null;
}

/** Runs `helper` with `text` on stdin, in a session of its own (`setsid`, so closing the terminal
 *  does not take the serving child with it) and its other stdio closed (so the child holds no pipe
 *  of acp-tui's), and resolves when it has exited: `written` on status 0, `failed` otherwise, and
 *  `timed-out` (the process killed) after `timeoutMs`. The process is always reaped by Bun; the
 *  child it forks to serve the text is not acp-tui's and is never waited for (`pbcopy` forks
 *  none: its exit means the pasteboard has the text). */
export async function runCopyHelper(
  helper: CopyHelper,
  text: string,
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs = HELPER_TIMEOUT_MS,
): Promise<HostClipboardWriteResult> {
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn([...helper.argv], {
      stdin: new Blob([text]),
      stdout: "ignore",
      stderr: "ignore",
      env: { ...env, ...helper.env },
      cwd: "/",
      detached: true,
    });
  } catch (error) {
    return { status: "failed", error: error as Error };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
  });
  const code = await Promise.race([child.exited, timedOut]);
  clearTimeout(timer);
  if (code === "timed-out") {
    child.kill("SIGKILL");
    return { status: "timed-out" };
  }
  return code === 0 ? { status: "written" } : { status: "failed", error: new Error(`${helper.name} exited with status ${code}`) };
}

/** The host step with a clipboard program: `helper` first, then `native()` (created only when
 *  needed). `via` is how the last write went (`null` when nothing was written). Reading, clearing
 *  and the limit are the native backend's. */
interface HelperHost extends HostClipboardService {
  readonly via: CopyVia | null;
  readonly helperStatus: HostClipboardWriteResult["status"] | "not-attempted";
}

function helperHost(
  helper: CopyHelper,
  env: Readonly<Record<string, string | undefined>>,
  native: () => HostClipboardService,
  timeoutMs: number,
): HelperHost {
  let nativeHost: HostClipboardService | null = null;
  const getNative = () => (nativeHost ??= native());
  let via: CopyVia | null = null;
  let helperStatus: HelperHost["helperStatus"] = "not-attempted";
  return {
    maxWriteBytes: MAX_WRITE_BYTES,
    get via() {
      return via;
    },
    get helperStatus() {
      return helperStatus;
    },
    read: (options) => getNative().read(options),
    clear: (options) => getNative().clear(options),
    async writeText(text: string, options?: HostClipboardOperationOptions) {
      via = null;
      const ran = await runCopyHelper(helper, text, env, timeoutMs);
      helperStatus = ran.status;
      if (ran.status === "written") {
        via = helper.name;
        return ran;
      }
      const result = await getNative().writeText(text, options);
      if (result.status === "written") via = "native";
      return result;
    },
    async dispose() {
      await nativeHost?.dispose();
    },
  };
}

/** How the host took the text: a clipboard program that outlives acp-tui, or the native backend
 *  (on Linux acp-tui serves the text itself, so it lasts only while acp-tui runs; on macOS the
 *  pasteboard keeps it). */
export type CopyVia = "wl-copy" | "xclip" | "pbcopy" | "native";

/** How a copy went, for the toast and the log. */
export interface CopyOutcome {
  /** `host`, `osc52`, or `none` when nothing was copied. */
  readonly path: "host" | "osc52" | "none";
  readonly result: ClipboardWriteResult | null;
  /** With `path` `host`: which way (missing: the native backend). */
  readonly via?: CopyVia;
  readonly error?: string;
}

/** The toast for a copy of `chars` characters: names the path, or says nothing was copied. */
export function copyToast(chars: number, outcome: CopyOutcome, display: HostKind | null): { text: string; ok: boolean } {
  const n = `${chars} ${chars === 1 ? "char" : "chars"}`;
  switch (outcome.path) {
    case "host": {
      // The macOS pasteboard keeps what the native backend wrote, so only a program is named.
      if (display === "macos") return { text: `copied ${n} to the macOS clipboard${outcome.via === "pbcopy" ? " (pbcopy)" : ""}`, ok: true };
      const how = outcome.via === "wl-copy" || outcome.via === "xclip" ? outcome.via : "until acp-tui exits";
      return { text: `copied ${n} to the ${display === "x11" ? "X11" : "Wayland"} clipboard (${how})`, ok: true };
    }
    case "osc52":
      return { text: `sent ${n} to the terminal (OSC 52, not confirmed)`, ok: true };
    case "none":
      return { text: `nothing copied: ${outcome.error ?? "no clipboard available"}`, ok: false };
  }
}

function pathOf(result: ClipboardWriteResult): CopyOutcome["path"] {
  if (result.host.status === "written") return "host";
  if (result.terminal.status === "attempted") return "osc52";
  return "none";
}

const DESTINATIONS: Record<Exclude<ClipboardMode, "none">, ClipboardWriteDestination> = {
  auto: "best-available",
  host: "host-only",
  osc52: "terminal-only",
};

/** The `clipboard` setting, or a function reading it at each copy or paste (live on a reload,
 *  mvp-configuration task 4.3). */
export type ClipboardModeSource = ClipboardMode | (() => ClipboardMode);

const modeReader = (source: ClipboardModeSource | undefined): (() => ClipboardMode) =>
  typeof source === "function" ? source : () => source ?? "auto";

export interface Copier {
  copy(text: string, trigger: string): Promise<CopyOutcome>;
  /** The mode in use now. */
  readonly mode: ClipboardMode;
  readonly display: HostKind | null;
  dispose(): Promise<void>;
}

export interface CopierOptions {
  /** The renderer (its OSC 52 writer and capabilities). */
  renderer: RendererClipboardBoundary;
  /** The `clipboard` setting (or `--clipboard`), read at each copy; default `auto`. */
  mode?: ClipboardModeSource;
  /** For the display variables; default `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** The operating system (`darwin`: the macOS pasteboard); default `process.platform`. */
  platform?: NodeJS.Platform;
  logger?: DebugLogger;
  /** Replaces the native host backend (tests); a clipboard program on `env.PATH` still comes first. */
  host?: HostClipboardService;
  /** How long a clipboard program may take; default `HELPER_TIMEOUT_MS`. */
  helperTimeoutMs?: number;
}

/** The copier: `copy` writes through the mode's paths and logs a `clipboard` event (never the
 *  text: its length, the trigger and each path's status). */
export function createCopier(options: CopierOptions): Copier {
  const env = options.env ?? process.env;
  const modeNow = modeReader(options.mode);
  const display = hostDisplay(env, options.platform);
  const logger = options.logger ?? NULL_LOGGER;
  // One service per kind of path set (with or without the host), made at the first copy that
  // needs it, so a reload that changes the mode (`osc52` to `auto`) gets the host paths.
  const services = new Map<boolean, { service: ClipboardService; withHelper: HelperHost | null }>();
  const get = (hostPaths: boolean): { service: ClipboardService; withHelper: HelperHost | null } => {
    let made = services.get(hostPaths);
    if (!made) {
      const native = (): HostClipboardService => options.host ?? (display && hostPaths ? createHostClipboard({ maxWriteBytes: MAX_WRITE_BYTES }) : NO_HOST);
      const helper = hostPaths ? findCopyHelper(display, env) : null;
      const withHelper = helper ? helperHost(helper, env, native, options.helperTimeoutMs ?? HELPER_TIMEOUT_MS) : null;
      made = { service: createClipboard({ host: withHelper ?? native(), terminal: createRendererClipboardAdapter(options.renderer) }), withHelper };
      services.set(hostPaths, made);
    }
    return made;
  };
  return {
    get mode() {
      return modeNow();
    },
    display,
    async copy(text, trigger) {
      const mode = modeNow();
      const hostPaths = mode === "auto" || mode === "host";
      let withHelper: HelperHost | null = null;
      let outcome: CopyOutcome;
      if (mode === "none") outcome = { path: "none", result: null, error: "clipboard off (clipboard: none)" };
      else {
        try {
          const made = get(hostPaths);
          withHelper = made.withHelper;
          const result = await made.service.writeText(text, { destination: DESTINATIONS[mode] });
          const path = pathOf(result);
          const via = path === "host" ? (withHelper?.via ?? "native") : undefined;
          outcome = path === "none" ? { path, result, error: "no clipboard available" } : { path, result, ...(via ? { via } : {}) };
        } catch (error) {
          outcome = { path: "none", result: null, error: (error as Error).message };
        }
      }
      const r = outcome.result;
      // The clipboard program: `none` when there is none to run, else its status in this copy.
      const helper = !withHelper ? "none" : r && r.host.status !== "not-attempted" ? withHelper.helperStatus : "not-attempted";
      logger.log({
        event: "clipboard",
        trigger,
        chars: text.length,
        mode,
        path: outcome.path,
        via: outcome.via ?? null,
        helper,
        host: r?.host.status ?? "not-attempted",
        terminal: r?.terminal.status ?? "not-attempted",
        osc52: r?.terminal.capability ?? "unknown",
        remote: options.renderer.capabilities?.remote ?? null,
      });
      return outcome;
    },
    async dispose() {
      await Promise.all([...services.values()].map(({ service }) => service.dispose()));
      services.clear();
    },
  };
}

// -- Paste (mvp-chrome-and-keys design D11; spec tui-keymap "Paste from the clipboard") ------------
//
// Ctrl+V and the palette's paste read text through OpenTUI's native host backend
// (`createHostClipboard`, no `wl-paste`) on Linux, whichever way the text was copied (`wl-copy`,
// `xclip` or the native backend, which copy falls back to). On macOS they read `pbpaste` first
// (found on the `PATH` of the reader's environment, argument list, no shell, the UTF-8 locale,
// at most `HELPER_TIMEOUT_MS` and `MAX_READ_BYTES`), and the native backend (NSPasteboard) only
// when `pbpaste` is missing or fails. `pbpaste` gives text only, so a pasteboard holding only an
// image reads as empty: "the clipboard holds no text". Only the host can be read: OSC 52 is
// write-only here, so `--clipboard osc52` and `none`, or no host at all (Linux without a display,
// a Mac over SSH), read nothing and the notice suggests the terminal's own paste (which arrives
// as a bracketed paste).

/** What a read for paste gave. */
export type PasteRead =
  | { readonly kind: "text"; readonly text: string }
  /** No text, but an image: image paste is out of scope for the MVP. */
  | { readonly kind: "image"; readonly mimeType: string }
  | { readonly kind: "none"; readonly reason: string };

/** Text first; the image types only tell an image apart from an empty clipboard. */
const PASTE_TYPES = ["text/plain", "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff"] as const;

/** 16 MiB, as for copy: the host refuses anything larger (`limit-exceeded`). */
const MAX_READ_BYTES = 16 * 1024 * 1024;

export const NO_CLIPBOARD_REASON = "no clipboard could be read; use the terminal's paste";

/** A program that prints the clipboard's text: `pbpaste` on macOS (Linux reads natively). */
export interface PasteHelper {
  readonly name: "pbpaste";
  /** The absolute path first. */
  readonly argv: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** The paste program for `display`, searched only on `env.PATH`: `pbpaste -Prefer txt` on macOS,
 *  none elsewhere. */
export function findPasteHelper(display: HostKind | null, env: Readonly<Record<string, string | undefined>>): PasteHelper | null {
  const PATH = env["PATH"];
  if (!PATH || display !== "macos") return null;
  const path = Bun.which("pbpaste", { PATH, cwd: "/" });
  return path ? { name: "pbpaste", argv: [path, "-Prefer", "txt"], env: MACOS_UTF8 } : null;
}

/** Runs `helper` with stdin closed and reads its standard output as `text/plain`: `read` on
 *  status 0 (empty output included, which the reader reports as no text), `failed` on another
 *  status or when it cannot start, `timed-out` after `timeoutMs` and `limit-exceeded` past
 *  `maxBytes`, both with the process killed. */
export async function runPasteHelper(
  helper: PasteHelper,
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs = HELPER_TIMEOUT_MS,
  maxBytes = MAX_READ_BYTES,
): Promise<ClipboardReadResult> {
  let child: Bun.Subprocess<"ignore", "pipe", "ignore">;
  try {
    child = Bun.spawn([...helper.argv], { stdin: "ignore", stdout: "pipe", stderr: "ignore", env: { ...env, ...helper.env }, cwd: "/" });
  } catch (error) {
    return { status: "failed", error: error as Error };
  }
  const collect = async (): Promise<Uint8Array | "limit-exceeded"> => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of child.stdout) {
      total += chunk.byteLength;
      if (total > maxBytes) return "limit-exceeded";
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return bytes;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
  });
  const read = collect().then(async (bytes) => ({ bytes, code: bytes === "limit-exceeded" ? null : await child.exited }));
  const outcome = await Promise.race([read, timedOut]);
  clearTimeout(timer);
  if (outcome === "timed-out" || outcome.bytes === "limit-exceeded") {
    child.kill("SIGKILL");
    return { status: outcome === "timed-out" ? "timed-out" : "limit-exceeded" };
  }
  if (outcome.code !== 0) return { status: "failed", error: new Error(`${helper.name} exited with status ${outcome.code}`) };
  return { status: "read", representation: { mimeType: "text/plain", bytes: outcome.bytes } };
}

/** The host for paste with a paste program: `helper` first, then `native()` (created only when
 *  the program is missing or fails). `via` is how the last read went. */
interface PasteHelperHost extends HostClipboardService {
  readonly via: "pbpaste" | "native" | null;
}

function pasteHelperHost(helper: PasteHelper, env: Readonly<Record<string, string | undefined>>, native: () => HostClipboardService, timeoutMs: number): PasteHelperHost {
  let nativeHost: HostClipboardService | null = null;
  const getNative = () => (nativeHost ??= native());
  let via: PasteHelperHost["via"] = null;
  return {
    maxWriteBytes: MAX_WRITE_BYTES,
    get via() {
      return via;
    },
    async read(options) {
      via = helper.name;
      const result = await runPasteHelper(helper, env, timeoutMs);
      if (result.status !== "failed") return result;
      via = "native";
      return getNative().read(options);
    },
    writeText: (text, options) => getNative().writeText(text, options),
    clear: (options) => getNative().clear(options),
    async dispose() {
      await nativeHost?.dispose();
    },
  };
}

/** The notice for a read that pasted nothing. */
export function pasteNotice(read: Exclude<PasteRead, { kind: "text" }>): string {
  return read.kind === "image" ? "image paste is not supported yet: the clipboard holds an image" : `nothing pasted: ${read.reason}`;
}

export interface ClipboardReader {
  read(trigger: string): Promise<PasteRead>;
  dispose(): Promise<void>;
}

export interface ClipboardReaderOptions {
  /** The `clipboard` setting (or `--clipboard`), read at each paste; default `auto`. Only `auto`
   *  and `host` read the host clipboard. */
  mode?: ClipboardModeSource;
  /** For the display variables; default `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** The operating system (`darwin`: `pbpaste`, then the macOS pasteboard); default `process.platform`. */
  platform?: NodeJS.Platform;
  logger?: DebugLogger;
  /** Replaces the native host backend (tests: a stubbed host clipboard); a paste program on
   *  `env.PATH` (macOS) still comes first. */
  host?: HostClipboardService;
  /** How long a paste program may take; default `HELPER_TIMEOUT_MS`. */
  helperTimeoutMs?: number;
}

/** The reader: `read` asks the host for text (or tells an image apart) and logs a `clipboard`
 *  event with `direction: "read"` (never the text: its length, the trigger and the status). */
export function createClipboardReader(options: ClipboardReaderOptions = {}): ClipboardReader {
  const env = options.env ?? process.env;
  const modeNow = modeReader(options.mode);
  const display = hostDisplay(env, options.platform);
  const logger = options.logger ?? NULL_LOGGER;
  let host: HostClipboardService | null = null;
  let withHelper: PasteHelperHost | null = null;
  // Only asked for while the mode reads the host.
  const get = (): HostClipboardService => {
    if (host) return host;
    const native = (): HostClipboardService => options.host ?? (display ? createHostClipboard({ maxReadBytes: MAX_READ_BYTES, maxWriteBytes: MAX_WRITE_BYTES }) : NO_HOST);
    const helper = findPasteHelper(display, env);
    withHelper = helper ? pasteHelperHost(helper, env, native, options.helperTimeoutMs ?? HELPER_TIMEOUT_MS) : null;
    host = withHelper ?? native();
    return host;
  };
  return {
    async read(trigger) {
      const mode = modeNow();
      const reads = mode === "auto" || mode === "host";
      let read: PasteRead;
      let status: string;
      if (!reads) {
        status = "not-attempted";
        read = { kind: "none", reason: mode === "none" ? "clipboard off (clipboard: none)" : NO_CLIPBOARD_REASON };
      } else {
        try {
          const result = await get().read({ preferredTypes: [...PASTE_TYPES] });
          status = result.status;
          switch (result.status) {
            case "read": {
              const { mimeType, bytes } = result.representation;
              const text = mimeType.startsWith("image/") ? null : new TextDecoder().decode(bytes);
              read = text === null ? { kind: "image", mimeType } : text === "" ? { kind: "none", reason: "the clipboard holds no text" } : { kind: "text", text };
              break;
            }
            case "empty":
              read = { kind: "none", reason: "the clipboard holds no text" };
              break;
            case "timed-out":
              read = { kind: "none", reason: "the clipboard did not answer in time" };
              break;
            case "limit-exceeded":
              read = { kind: "none", reason: "the clipboard holds more than 16 MiB" };
              break;
            case "failed":
              read = { kind: "none", reason: result.error.message };
              break;
            default:
              read = { kind: "none", reason: NO_CLIPBOARD_REASON };
          }
        } catch (error) {
          status = "failed";
          read = { kind: "none", reason: (error as Error).message };
        }
      }
      // `via` only where a paste program exists (macOS), so Linux logs as before.
      const via = reads && withHelper ? { via: withHelper.via } : {};
      logger.log({ event: "clipboard", direction: "read", trigger, mode, status, result: read.kind, ...via, ...(read.kind === "text" ? { chars: read.text.length } : {}) });
      return read;
    },
    async dispose() {
      await host?.dispose();
    },
  };
}
