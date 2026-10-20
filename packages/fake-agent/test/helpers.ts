// Test-only helpers for spawning fake-agent as a real child process and
// driving it with the SDK's ClientSideConnection, the same shape of
// round trip acp-tui performs in production. Bun.spawn's stdin/stdout stay
// open for the whole test so the connection never sees an early EOF (which
// would otherwise race the read loop's close-on-done against in-flight
// notification handlers -- see docs/phase-0-notes/fake-agent.md).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientSideConnection, ndJsonStream, type Client, type SessionUpdate, type Stream } from "@agentclientprotocol/sdk";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const MAIN_TS = "packages/fake-agent/src/main.ts";

export interface FakeAgentHandle {
  readonly conn: ClientSideConnection;
  readonly proc: ReturnType<typeof Bun.spawn>;
  /** Ends the child's stdin and kills the process. Safe to call once. */
  stop(): void;
}

export interface SpawnFakeAgentOptions {
  readonly scenario: string;
  readonly delayScale?: number;
  /** The `--items` knob; only `long-session` reads it. */
  readonly items?: number;
  readonly logPath?: string;
  /** Extra fake-agent arguments, for example `["--load", "--sessions", file]`. */
  readonly args?: readonly string[];
  /** The child's working directory (default: the repository root). */
  readonly cwd?: string;
  readonly client: Client;
}

export function spawnFakeAgent(options: SpawnFakeAgentOptions): FakeAgentHandle {
  const { stream, proc, stop } = spawnFakeAgentStream(options);
  const conn = new ClientSideConnection(() => options.client, stream);
  return { conn, proc, stop };
}

/** What `spawnFakeAgentStream` returns: the raw stream, for a client built with the SDK's `client()` API. */
export interface FakeAgentStreamHandle {
  readonly stream: Stream;
  readonly proc: ReturnType<typeof Bun.spawn>;
  stop(): void;
}

/**
 * Starts fake-agent as `spawnFakeAgent` does but returns the stream instead of a connection, so a
 * test can use the SDK's `client()` API, whose request handlers see the request's abort signal
 * (the legacy `Client` interface does not pass it: needed to see a `$/cancel_request`).
 * `options.client` is ignored.
 */
export function spawnFakeAgentStream(options: Omit<SpawnFakeAgentOptions, "client"> & { readonly client?: Client }): FakeAgentStreamHandle {
  const args = ["bun", `${REPO_ROOT}${MAIN_TS}`, "--scenario", options.scenario];
  args.push("--delay-scale", String(options.delayScale ?? 0));
  if (options.items !== undefined) {
    args.push("--items", String(options.items));
  }
  if (options.logPath) {
    args.push("--log", options.logPath);
  }
  args.push(...(options.args ?? []));

  const proc = Bun.spawn({
    cmd: args,
    cwd: options.cwd ?? REPO_ROOT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BUN_TMPDIR: process.env["BUN_TMPDIR"] ?? "" },
  });

  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      proc.stdin.write(chunk);
    },
  });
  const stream = ndJsonStream(output, proc.stdout);

  let stopped = false;
  return {
    stream,
    proc,
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        proc.stdin.end();
      } catch {
        // already closed
      }
      proc.kill();
    },
  };
}

/** A client that keeps every `session/update` it receives, in order, and allows every permission request once. */
export function recordingClient(): { readonly client: Client; readonly updates: SessionUpdate[] } {
  const updates: SessionUpdate[] = [];
  const client: Client = {
    async sessionUpdate(params) {
      updates.push(params.update);
    },
    async requestPermission(params) {
      const allow = params.options.find((option) => option.kind === "allow_once") ?? params.options[0];
      if (!allow) throw new Error("a permission request without options");
      return { outcome: { outcome: "selected", optionId: allow.optionId } };
    },
  };
  return { client, updates };
}

/** A fresh temporary directory (under TMPDIR) for a fixture, a log or a store file. */
export function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "fake-agent-test-"));
}

/** The `--log` file's entries as `{ method, params }`, in order. */
export function readLog(logPath: string): { method: string; params: unknown }[] {
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { method: string; params: unknown });
}
