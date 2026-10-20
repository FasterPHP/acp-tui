// An xdg-activation token for the opener (mvp-rendering task 14.5, review C7; spec tui-rendering
// "Opening links"; docs/mvp-notes/rendering-research.md, C7). On Wayland a program may only
// bring another program's window forward with an activation token, which the launcher hands on
// in `XDG_ACTIVATION_TOKEN`; Chromium-based browsers read it and pass it to their running window.
// acp-tui has no Wayland surface and sees no input events, so it asks the compositor for a token
// without a serial or a surface: Hyprland (0.56) hands one to any client and, with Omarchy's
// `misc:focus_on_activate`, focuses the browser that uses it (checked by Marcus on 10 October
// 2026 with the probe `tools/mvp-rendering/activation-open.ts`, whose logic this is). A
// compositor that checks the serial (KWin, Mutter) may refuse focus; the link opens either way.
//
// Plain Bun, no dependency: the Wayland wire format over the compositor's Unix socket. Connect to
// `$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY`, `wl_display.get_registry` and a `sync`, bind
// `xdg_activation_v1` when the registry lists it, `get_activation_token`, `set_app_id("acp-tui")`,
// `commit`, and wait for the token's `done` event. Any failure (no `WAYLAND_DISPLAY`, no socket,
// no `xdg_activation_v1`, a protocol error, no answer within the timeout) is a reason, never an
// exception: the caller opens without a token, as before.
import { isAbsolute, join } from "node:path";

/** How long the opener waits for the compositor's token before opening without one. */
export const ACTIVATION_TIMEOUT_MS = 400;

/** The opener's app id in the token request. */
export const ACTIVATION_APP_ID = "acp-tui";

// -- The Wayland wire format (little-endian 32-bit words; strings length-prefixed, NUL-ended, padded) --

/** A request or event: the object, the opcode and the argument bytes. */
export interface WireMessage {
  readonly object: number;
  readonly opcode: number;
  readonly args: Uint8Array;
}

/** Encodes one message: object id, (size << 16 | opcode), arguments. */
export function encodeMessage(object: number, opcode: number, args: readonly (number | string)[] = []): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const a of args) {
    if (typeof a === "number") {
      const w = new Uint8Array(4);
      new DataView(w.buffer).setUint32(0, a >>> 0, true);
      parts.push(w);
    } else {
      const bytes = new TextEncoder().encode(a);
      const len = bytes.length + 1;
      const padded = new Uint8Array(4 + Math.ceil(len / 4) * 4);
      new DataView(padded.buffer).setUint32(0, len, true);
      padded.set(bytes, 4);
      parts.push(padded);
    }
  }
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, object, true);
  view.setUint32(4, (size << 16) | opcode, true);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Splits `buffer` into whole messages; returns them and the bytes left over. */
export function decodeMessages(buffer: Uint8Array): { messages: WireMessage[]; rest: Uint8Array } {
  const messages: WireMessage[] = [];
  let at = 0;
  while (buffer.length - at >= 8) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + at);
    const object = view.getUint32(0, true);
    const word = view.getUint32(4, true);
    const size = word >>> 16;
    if (size < 8 || buffer.length - at < size) break;
    messages.push({ object, opcode: word & 0xffff, args: buffer.slice(at + 8, at + size) });
    at += size;
  }
  return { messages, rest: buffer.slice(at) };
}

/** Reads a u32 at `offset` of `args`. */
export function readUint(args: Uint8Array, offset: number): number {
  return new DataView(args.buffer, args.byteOffset).getUint32(offset, true);
}

/** Reads a string at `offset` of `args`; returns it and the offset after its padding. */
export function readString(args: Uint8Array, offset: number): { value: string; next: number } {
  const len = readUint(args, offset);
  const value = new TextDecoder().decode(args.slice(offset + 4, offset + 4 + Math.max(0, len - 1)));
  return { value, next: offset + 4 + Math.ceil(len / 4) * 4 };
}

// -- The token request ---------------------------------------------------------------------------

// Object ids this client creates, in order (1 is the display).
const DISPLAY = 1;
const REGISTRY = 2;
const SYNC = 3;
const ACTIVATION = 4;
const TOKEN = 5;

export type Env = Readonly<Record<string, string | undefined>>;

/** The compositor's socket, or null without `WAYLAND_DISPLAY` (or `XDG_RUNTIME_DIR` for a relative name). */
export function waylandSocket(env: Env = process.env): string | null {
  const display = env["WAYLAND_DISPLAY"];
  if (!display) return null;
  if (isAbsolute(display)) return display;
  const runtime = env["XDG_RUNTIME_DIR"];
  return runtime ? join(runtime, display) : null;
}

/** Asks the compositor at `socketPath` for an xdg-activation token. Resolves with the token, or
 *  rejects with why not. */
export function requestToken(socketPath: string, appId = ACTIVATION_APP_ID, timeoutMs = ACTIVATION_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    let pending: Uint8Array = new Uint8Array(0);
    let activationName: number | null = null;
    let activationVersion = 1;
    let settled = false;
    let sock: { write(data: Uint8Array): number; end(): void } | null = null;
    const finish = (error: Error | null, token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock?.end();
      } catch {
        // already closed
      }
      if (error) reject(error);
      else resolve(token!);
    };
    const timer = setTimeout(() => finish(new Error(`no answer from the compositor within ${timeoutMs} ms`)), timeoutMs);
    const send = (bytes: Uint8Array) => sock?.write(bytes);
    Bun.connect({
      unix: socketPath,
      socket: {
        open(s) {
          sock = s;
          send(encodeMessage(DISPLAY, 1, [REGISTRY])); // wl_display.get_registry
          send(encodeMessage(DISPLAY, 0, [SYNC])); // wl_display.sync: done once the globals are listed
        },
        data(_s, data) {
          const joined = new Uint8Array(pending.length + data.length);
          joined.set(pending);
          joined.set(data, pending.length);
          const { messages, rest } = decodeMessages(joined);
          pending = rest;
          for (const m of messages) {
            if (m.object === DISPLAY && m.opcode === 0) {
              const { value } = readString(m.args, 8);
              return finish(new Error(`compositor error ${readUint(m.args, 4)} on object ${readUint(m.args, 0)}: ${value}`));
            }
            if (m.object === REGISTRY && m.opcode === 0) {
              const name = readUint(m.args, 0);
              const iface = readString(m.args, 4);
              if (iface.value === "xdg_activation_v1") {
                activationName = name;
                activationVersion = Math.min(1, readUint(m.args, iface.next));
              }
            } else if (m.object === SYNC && m.opcode === 0) {
              if (activationName === null) return finish(new Error("the compositor offers no xdg_activation_v1"));
              send(encodeMessage(REGISTRY, 0, [activationName, "xdg_activation_v1", activationVersion, ACTIVATION])); // bind
              send(encodeMessage(ACTIVATION, 1, [TOKEN])); // get_activation_token
              send(encodeMessage(TOKEN, 1, [appId])); // set_app_id
              send(encodeMessage(TOKEN, 3)); // commit
            } else if (m.object === TOKEN && m.opcode === 0) {
              return finish(null, readString(m.args, 0).value);
            }
          }
        },
        close() {
          finish(new Error("the compositor closed the connection"));
        },
        error(_s, error) {
          finish(error);
        },
      },
    }).catch((error: Error) => finish(error));
  });
}

/** What the token request came to: the token, or why there is none (for the `link_open` log). */
export type Activation = { readonly token: string } | { readonly token: null; readonly reason: "no-wayland" | "no-activation" | "timeout" | "failed" };

/**
 * A token for the opener from the compositor named by `env`, or why there is none. Never rejects:
 * no Wayland display (an X11 session, SSH, macOS) is `no-wayland`, a compositor without
 * `xdg_activation_v1` is `no-activation`, no answer in time is `timeout`, anything else `failed`.
 */
export async function activationToken(env: Env = process.env, timeoutMs = ACTIVATION_TIMEOUT_MS): Promise<Activation> {
  const socket = waylandSocket(env);
  if (!socket) return { token: null, reason: "no-wayland" };
  try {
    return { token: await requestToken(socket, ACTIVATION_APP_ID, timeoutMs) };
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (message.includes("no xdg_activation_v1")) return { token: null, reason: "no-activation" };
    if (message.startsWith("no answer")) return { token: null, reason: "timeout" };
    return { token: null, reason: "failed" };
  }
}

/** The opener's environment: acp-tui's own, with `XDG_ACTIVATION_TOKEN` set to `token` when there
 *  is one (and a stale inherited one removed when there is not). */
export function openerEnv(env: Env, token: string | null): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  if (token) out["XDG_ACTIVATION_TOKEN"] = token;
  else delete out["XDG_ACTIVATION_TOKEN"];
  return out;
}
