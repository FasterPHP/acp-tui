// Agent process launch (design D4, task 5.2): `Bun.spawn` with stdin/stdout/
// stderr pipes. stdout and stdin feed the SDK's `ndJsonStream`; stderr is
// kept in a bounded ring buffer for start-up error messages and, if
// `ACP_TUI_LOG` is set, its chunk lengths only reach the debug log (never
// its content -- see console-capture.ts for the same reasoning).
import type { DebugLogger } from "../log.ts";
import { RingBuffer } from "./ring-buffer.ts";
import { scriptSpawn } from "./command-script.ts";
import { mergeEnvironment, resolveArgv, type Env } from "./which.ts";
import { commandBaseName } from "./hints.ts";

export interface LaunchedAgent {
  readonly proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  /** Web-stream view of the child's stdin, for `ndJsonStream`'s `output`. */
  readonly stdin: WritableStream<Uint8Array>;
  /** The child's stdout, already a web `ReadableStream<Uint8Array>`. */
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: RingBuffer;
  /** Resolves with the exit code (or null if killed by signal) when the child exits. */
  readonly exited: Promise<number | null>;
  /** Resolves once the child's stderr has been read to the end (so `stderr` is complete). */
  readonly stderrClosed?: Promise<void>;
  /** The harness's name in the catalogue (or `ad hoc`), for the messages that name it. */
  readonly harness?: string;
}

/** The harness as an error names it (day-two-feedback: the launched program is a harness in every
 *  user-facing text): `harness 'fake' (command 'bun main.ts')`, or for a command given after `--`
 *  (no name, or `ad hoc`) `ad hoc harness command 'bun main.ts'`. */
export function harnessDescription(harness: string | undefined, command: readonly string[]): string {
  const text = `'${command.join(" ")}'`;
  return harness === undefined || harness === "ad hoc" ? `ad hoc harness command ${text}` : `harness '${harness}' (command ${text})`;
}

/** Thrown when the harness command cannot be launched at all (design 5.2's "agent fails to start"). */
export class AgentLaunchError extends Error {
  constructor(
    readonly command: readonly string[],
    cause: unknown,
    readonly harness?: string,
    installHint?: string,
  ) {
    const notFound = isNotFound(cause);
    // The program that was not found is named by its base name (`auggie`, `bunx`), whatever the
    // harness is called (configured-harnesses: hints follow the program, src/agent/hints.ts).
    const program = commandBaseName(command[0] ?? "");
    super(`could not start ${harnessDescription(harness, command)}: ${causeMessage(cause)}${notFound && installHint !== undefined ? `; ${program} is not installed: install it with ${installHint}` : ""}`);
    this.name = "AgentLaunchError";
    this.notFound = notFound;
  }

  /** Whether the program was not found (Bun's `ENOENT`, or acp-tui's own PATH lookup), as opposed to another start-up failure. */
  readonly notFound: boolean;
}

/** Whether a spawn failure means the program does not exist (Bun's and acp-tui's lookup both carry `code: "ENOENT"`). */
function isNotFound(cause: unknown): boolean {
  return (cause as { code?: unknown } | null)?.code === "ENOENT";
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface LaunchOptions {
  cwd?: string;
  /** Added to acp-tui's own environment (a configured harness's `env`, mvp-sessions task 3.2). */
  env?: Readonly<Record<string, string>>;
  /** The harness's name in the catalogue, or `ad hoc`, for error messages. */
  harness?: string;
  /** For a program acp-tui knows (src/agent/hints.ts): how to install it. Appended to the error when the program is not found. */
  installHint?: string;
  logger?: DebugLogger;
  /** acp-tui's own environment, under the entry's; default `process.env` (tests). */
  baseEnv?: Env;
  /** Default `process.platform` (tests). */
  platform?: NodeJS.Platform;
}

/** Launches `command` as the agent process. Its program is resolved from the `PATH` first (never
 *  from `cwd`; src/agent/which.ts) and started by that path. Throws `AgentLaunchError` when the
 *  program is on no `PATH` entry (nothing is started) or `Bun.spawn` itself fails (for example
 *  ENOENT for a missing path) -- Bun.spawn throws synchronously in that case. Messages name the
 *  command as given, not the resolved path. */
export function launchAgent(command: readonly string[], options: LaunchOptions = {}): LaunchedAgent {
  if (command.length === 0) {
    throw new AgentLaunchError(command, new Error("empty command"), options.harness);
  }

  const platform = options.platform ?? process.platform;
  // `env` replaces the child's environment in Bun.spawn, so the entry's variables are added to
  // acp-tui's own rather than passed alone (on Windows an entry's `PATH` replaces `Path`).
  const env = options.env && Object.keys(options.env).length > 0 ? mergeEnvironment(options.baseEnv ?? process.env, options.env, platform) : undefined;
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    // Resolved with the environment the harness gets, so an entry's `PATH` is the one searched.
    const childEnv = env ?? options.baseEnv ?? process.env;
    const argv = resolveArgv(command, { env: childEnv, platform });
    // On Windows a command script whose path holds a space goes through cmd.exe as it reads such a
    // line (src/agent/command-script.ts); everything else is started as resolved.
    const spawn = scriptSpawn(argv, { platform, env: childEnv });
    proc = Bun.spawn({
      cmd: spawn.cmd,
      ...(spawn.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      cwd: options.cwd,
      ...(env ? { env } : {}),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const failure = new AgentLaunchError(command, error, options.harness, options.installHint);
    // The kind only, never the command or the message (spec: no text in the log).
    options.logger?.log({ event: "launch_error", kind: failure.notFound ? "not_found" : "other" });
    throw failure;
  }

  const stderr = new RingBuffer();
  const logger = options.logger;
  // The process ID only (never the command, its arguments or its environment): the PTY tests tell
  // a kept agent process from a new one by it (mvp-configuration task 3.3).
  logger?.log({ event: "agent_launched", pid: proc.pid });
  const decoder = new TextDecoder();

  const stderrClosed = (async () => {
    const reader = proc.stderr.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        stderr.push(text);
        logger?.log({ event: "agent_stderr", length: text.length });
      }
    } catch {
      // Stream errors here just mean the child's stderr closed abruptly; the
      // ring buffer keeps whatever arrived before that.
    } finally {
      reader.releaseLock();
    }
  })();

  const stdin = new WritableStream<Uint8Array>({
    write(chunk) {
      proc.stdin.write(chunk);
    },
    close() {
      proc.stdin.end();
    },
    abort() {
      proc.stdin.end();
    },
  });

  const exited = proc.exited.then((code) => code);

  return { proc, stdin, stdout: proc.stdout, stderr, exited, stderrClosed, ...(options.harness !== undefined ? { harness: options.harness } : {}) };
}
