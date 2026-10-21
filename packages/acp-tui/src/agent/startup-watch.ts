// Watching a harness while it starts (harness-feedback D3 and D4; spec tui-agent-session "Start-up
// timeout" and "Harness that is not an ACP harness"). Two things can go wrong with a harness that
// stays alive: it never answers (a silent process, or one that waits for something), or it is not an
// ACP harness at all (a terminal interface that draws its screen on stdout). Neither exits, so
// `raceWithExit` alone would wait for ever.
//
// - The silence timer runs while a start-up request is unanswered (`guard`), is restarted by every
//   message read from the harness (`touch`) and is paused while a permission or question card waits
//   for the user (`hold` and `release`). On expiry the harness is ended (the detach kill path,
//   `killProcessTree`, which ends the whole tree on Windows) and the start fails with
//   `AgentStartupTimeoutError`.
// - The stdout watch (`watchStdout`) sits before `ndJsonStream` and looks at the harness's output
//   until its first JSON-RPC line: a raw escape character fails at once, three non-empty lines that
//   are not JSON fail, one or two are let through. After the first JSON-RPC line it passes the bytes
//   on untouched. The failure is `AgentNotAcpError`; nothing from stdout is quoted in it.
import { sanitise } from "acp-model";
import type { DebugLogger } from "../log.ts";
import { killProcessTree } from "./kill-tree.ts";
import { harnessDescription, type LaunchedAgent } from "./launch.ts";

/** Lines of the harness's stderr quoted in a start-up error. */
export const STARTUP_ERROR_STDERR_LINES = 20;

/** How long a harness ended by acp-tui is waited for before its error is built (ms). */
const END_WAIT_MS = 3000;
/** How long the end of its stderr is waited for after it exits (ms). */
const STDERR_WAIT_MS = 200;
/** An unfinished first line longer than this is not an ACP message (bytes of text). */
const PARTIAL_LIMIT = 1 << 20;
/** Non-empty lines that are not JSON, before the first JSON-RPC message, that show a harness is not ACP. */
export const NOT_ACP_LINES = 3;

function tailOf(stderrTail: string): string {
  // The tail is printed to the terminal, so it is sanitised like any agent text.
  const tail = sanitise(stderrTail).trimEnd();
  return tail ? `\n--- stderr (tail) ---\n${tail}` : "";
}

/** Thrown when a harness stays silent for its start-up timeout while a start-up request is
 *  unanswered; the harness has been ended. */
export class AgentStartupTimeoutError extends Error {
  constructor(
    readonly command: readonly string[],
    readonly request: string,
    readonly seconds: number,
    readonly stderrTail: string,
    readonly harness?: string,
  ) {
    super(`${harnessDescription(harness, command)} did not answer ${request} within ${seconds} s and was stopped${tailOf(stderrTail)}`);
    this.name = "AgentStartupTimeoutError";
  }
}

/** Thrown when a harness prints terminal output instead of ACP messages; the harness has been ended.
 *  The message quotes none of that output. */
export class AgentNotAcpError extends Error {
  constructor(
    readonly command: readonly string[],
    readonly reason: "escape" | "lines",
    readonly stderrTail: string,
    readonly harness?: string,
  ) {
    super(`${harnessDescription(harness, command)} does not look like an ACP harness: it printed terminal output; ACP harnesses usually need an argument such as acp or --acp${tailOf(stderrTail)}`);
    this.name = "AgentNotAcpError";
  }
}

export interface StartupWatchOptions {
  readonly agent: LaunchedAgent;
  readonly command: readonly string[];
  /** Milliseconds of silence allowed while a start-up request is unanswered. */
  readonly timeoutMs: number;
  readonly logger?: DebugLogger | undefined;
}

/** One guarded start-up request. */
export interface StartupGuard {
  /** Rejects with the start-up failure when the watch fails while the request is unanswered. */
  readonly failure: Promise<never>;
  /** The request has ended (answered, or failed some other way). */
  end(): void;
}

interface Waiter {
  readonly request: string;
  reject(error: Error): void;
}

export class StartupWatch {
  /** The start-up failure, once there is one (it settles after the harness has been ended). */
  failed: Promise<Error> | null = null;
  private readonly waiters = new Set<Waiter>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private held = 0;

  constructor(private readonly options: StartupWatchOptions) {}

  /** Guards start-up request `request`: from now until `end()` the silence timer runs. */
  guard(request: string): StartupGuard {
    let waiter!: Waiter;
    const failure = new Promise<never>((_resolve, reject) => {
      waiter = { request, reject };
    });
    // Rejected only through a race that has already attached to it.
    failure.catch(() => {});
    if (this.failed) {
      void this.failed.then((error) => waiter.reject(error));
    } else {
      this.waiters.add(waiter);
      this.arm();
    }
    return {
      failure,
      end: () => {
        this.waiters.delete(waiter);
        if (this.waiters.size === 0) this.disarm();
      },
    };
  }

  /** A message was read from the harness: the silence starts again. */
  touch(): void {
    if (this.waiters.size > 0 && this.held === 0) this.arm();
  }

  /** A permission or question card waits for the user: the timer stops until `release`. */
  hold(): void {
    this.held++;
    this.disarm();
  }

  release(): void {
    if (this.held === 0) return;
    this.held--;
    if (this.held === 0 && this.waiters.size > 0) this.arm();
  }

  /** Stops the timer (the connection is done with start-up). */
  dispose(): void {
    this.disarm();
    this.waiters.clear();
  }

  private arm(): void {
    this.disarm();
    if (this.failed) return;
    this.timer = setTimeout(() => this.expire(), this.options.timeoutMs);
  }

  private disarm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private expire(): void {
    this.timer = null;
    const request = [...this.waiters][0]?.request;
    if (request === undefined || this.held > 0) return;
    const { agent, command, timeoutMs, logger } = this.options;
    const seconds = Math.round(timeoutMs / 1000);
    logger?.log({ event: "startup_timeout", request, seconds });
    this.fail((tail) => new AgentStartupTimeoutError(command, request, seconds, tail, agent.harness));
  }

  /** The harness printed terminal output. */
  private notAcp(reason: "escape" | "lines"): void {
    const { agent, command, logger } = this.options;
    logger?.log({ event: "not_acp_harness", reason });
    this.fail((tail) => new AgentNotAcpError(command, reason, tail, agent.harness));
  }

  /** Ends the harness and settles `failed` with the error `make` builds from its stderr tail. */
  private fail(make: (stderrTail: string) => Error): void {
    if (this.failed) return;
    this.disarm();
    const { agent } = this.options;
    const failed = (async () => {
      await Promise.race([killProcessTree(agent.proc), Bun.sleep(END_WAIT_MS)]);
      await Promise.race([agent.exited, Bun.sleep(END_WAIT_MS)]);
      // The exit can be seen before the last stderr chunk has been read.
      await Promise.race([agent.stderrClosed ?? Promise.resolve(), Bun.sleep(STDERR_WAIT_MS)]);
      return make(agent.stderr.tail(STARTUP_ERROR_STDERR_LINES));
    })();
    this.failed = failed;
    for (const waiter of [...this.waiters]) void failed.then((error) => waiter.reject(error));
  }

  /**
   * The harness's stdout, watched until its first JSON-RPC line (D4). Bytes pass on unchanged; on a
   * failure the watch ends the harness and closes the stream, so nothing more reaches the SDK.
   */
  watchStdout(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const reader = source.getReader();
    const inspector = new StdoutInspector();
    let watching = true;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (watching) {
          const verdict = inspector.feed(value);
          if (verdict === "ok") watching = false;
          else if (verdict !== null) {
            this.notAcp(verdict);
            controller.close();
            void reader.cancel().catch(() => {});
            return;
          }
        }
        controller.enqueue(value);
      },
      cancel: (reason) => reader.cancel(reason),
    });
  }

  /** `readable` with every message read from it restarting the silence timer. */
  tap<T>(readable: ReadableStream<T>): ReadableStream<T> {
    return readable.pipeThrough(
      new TransformStream<T, T>({
        transform: (message, controller) => {
          this.touch();
          controller.enqueue(message);
        },
      }),
    );
  }
}

/**
 * What the stdout watch makes of the bytes so far: `null` (keep watching), `"ok"` (a JSON-RPC line
 * has been seen: step aside), `"escape"` (a raw escape character) or `"lines"` (three non-empty
 * lines that are not JSON). Exported for tests.
 */
export class StdoutInspector {
  private readonly decoder = new TextDecoder();
  private partial = "";
  private nonJson = 0;

  feed(chunk: Uint8Array): "ok" | "escape" | "lines" | null {
    this.partial += this.decoder.decode(chunk, { stream: true });
    const parts = this.partial.split("\n");
    this.partial = parts.pop() ?? "";
    for (const line of parts) {
      if (line.includes("\x1b")) return "escape";
      const text = line.trim();
      if (text === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        if (++this.nonJson >= NOT_ACP_LINES) return "lines";
        continue;
      }
      if (typeof parsed === "object" && parsed !== null && (parsed as { jsonrpc?: unknown }).jsonrpc === "2.0") return "ok";
    }
    // A line still being written cannot be a JSON-RPC message if it already holds an escape.
    if (this.partial.includes("\x1b")) return "escape";
    if (this.partial.length > PARTIAL_LIMIT) return "lines";
    return null;
  }
}
