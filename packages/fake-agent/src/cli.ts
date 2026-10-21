// Argument and environment parsing for fake-agent's CLI.
export interface FakeAgentCliOptions {
  readonly scenario: string;
  readonly logPath: string | undefined;
  readonly delayScale: number;
  readonly items: number;
  /** `--load`: advertise `loadSession` and answer `session/load`. */
  readonly load: boolean;
  /** `--resume`: advertise `sessionCapabilities.resume` and answer `session/resume`. */
  readonly resume: boolean;
  /** `--list`: advertise `sessionCapabilities.list` and answer `session/list`. */
  readonly list: boolean;
  /** `--sessions <file>`: the session store fixture. */
  readonly sessionsPath: string | undefined;
  /** `--persist`: write the store back to `--sessions` after every change. */
  readonly persist: boolean;
  /** `--page-size <n>`: sessions per `session/list` page (all in one page when absent). */
  readonly pageSize: number | undefined;
  /** `--load-error <id>` (repeatable): `session/load` and `session/resume` of these IDs fail. */
  readonly loadErrors: readonly string[];
  /** `--title-update`: send a `session_info_update` with a title after a session's first turn. */
  readonly titleUpdate: boolean;
  /** `--history`: a scenario with a generated history (long-session) sends it to every new session, before any prompt. */
  readonly history: boolean;
  /** `--chunk <n>`: `markdown-gallery` streams its text in chunks of `n` characters (one chunk when absent);
   *  `fence-first` uses `n` instead of its 7. */
  readonly chunk: number | undefined;
  /** `--long-gap`: `slow-turn` waits 45 s between its tool calls instead of 3 s. */
  readonly longGap: boolean;
  /** `--tools <n>`: `fast-tools` sends `n` tool calls (default 6), cycling its six kinds. */
  readonly tools: number;
  /** `--start-delay <ms>`: wait this long before answering `initialize` (a harness's start-up). Absolute, never scaled. */
  readonly startDelayMs: number;
  /** `--list-delay <ms>`: wait this long before answering `session/list`. Absolute, never scaled. */
  readonly listDelayMs: number;
  /** `--auth-required[=bare|prompt]`: `session/new` (or, for `prompt`, `session/prompt`) answers `-32000`
   *  "authentication required", with Auggie 0.36.0's text (`full`, the bare flag) or `Authentication required` alone. */
  readonly authRequired: AuthRequiredMode | undefined;
  /** `--agent-info <name>@<version>`: the `agentInfo` `initialize` reports. */
  readonly agentInfo: { readonly name: string; readonly version: string } | undefined;
  /** `--additional-directories`: advertise `sessionCapabilities.additionalDirectories`. */
  readonly additionalDirectories: boolean;
  /** `--add-workspace <dir>` (repeatable): accepted and logged as `argv/add-workspace`, as Auggie's flag would be. */
  readonly addWorkspace: readonly string[];
  /** `--no-initialize`: never answer `initialize` (the process stays alive and keeps reading). */
  readonly noInitialize: boolean;
  /** `--print-terminal[=lines]`: write terminal output to stdout before anything else: an `ESC [ ? 1049 h` and a line
   *  (`escape`, the bare flag) or three plain non-JSON lines (`lines`). */
  readonly printTerminal: PrintTerminalMode | undefined;
  /** `--session-delay <ms>`: wait this long before answering `session/new`, `session/load` and `session/resume`. Absolute, never scaled. */
  readonly sessionDelayMs: number;
  /** `--session-heartbeat <ms>`: while `--session-delay` waits, send an agent message chunk for the session every `ms`. */
  readonly sessionHeartbeatMs: number | undefined;
  /** `--session-permission`: send a permission request first, before `session/new`, `session/load` and `session/resume` answer; the delay starts once it is answered. */
  readonly sessionPermission: boolean;
}

export type PrintTerminalMode = "escape" | "lines";

export type AuthRequiredMode = "full" | "bare" | "prompt";

/** Parses `<name>@<version>` (the last `@` splits, so a scoped name keeps its own). */
function parseAgentInfo(raw: string): { name: string; version: string } {
  const at = raw.lastIndexOf("@");
  const name = raw.slice(0, at);
  const version = raw.slice(at + 1);
  if (at < 1 || version === "") {
    throw new Error(`--agent-info must be <name>@<version>, got '${raw}'`);
  }
  return { name, version };
}

const DEFAULT_SCENARIO = "basic";
const DEFAULT_DELAY_SCALE = 1;
const DEFAULT_ITEMS = 200;
const DEFAULT_TOOLS = 6;

function parseDelayScale(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_DELAY_SCALE;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--delay-scale must be a non-negative number, got '${raw}'`);
  }
  return parsed;
}

function parsePositiveInteger(flag: string, raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer, got '${raw}'`);
  }
  return parsed;
}

/** A delay in milliseconds, absolute (not multiplied by `--delay-scale`); absent means none. */
function parseDelayMs(flag: string, raw: string): number {
  return parsePositiveInteger(flag, raw);
}

function requireValue(flag: string, argv: readonly string[], i: number): string {
  const value = argv[i + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

/**
 * Parses fake-agent's CLI arguments. `--delay-scale` falls back to the
 * FAKE_AGENT_DELAY_SCALE environment variable, then to 1, so PTY and
 * benchmark harnesses can speed up or slow down scenarios without changing
 * the command line.
 */
export function parseArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): FakeAgentCliOptions {
  let scenario = DEFAULT_SCENARIO;
  let logPath: string | undefined;
  let items = DEFAULT_ITEMS;
  let delayScaleRaw: string | undefined = env["FAKE_AGENT_DELAY_SCALE"];
  let load = false;
  let resume = false;
  let list = false;
  let sessionsPath: string | undefined;
  let persist = false;
  let pageSize: number | undefined;
  const loadErrors: string[] = [];
  let titleUpdate = false;
  let history = false;
  let chunk: number | undefined;
  let longGap = false;
  let tools = DEFAULT_TOOLS;
  let startDelayMs = 0;
  let listDelayMs = 0;
  let authRequired: AuthRequiredMode | undefined;
  let agentInfo: { name: string; version: string } | undefined;
  let additionalDirectories = false;
  const addWorkspace: string[] = [];
  let noInitialize = false;
  let printTerminal: PrintTerminalMode | undefined;
  let sessionDelayMs = 0;
  let sessionHeartbeatMs: number | undefined;
  let sessionPermission = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    switch (arg) {
      case "--scenario":
        scenario = requireValue(arg, argv, i);
        i += 1;
        break;
      case "--log":
        logPath = requireValue(arg, argv, i);
        i += 1;
        break;
      case "--delay-scale":
        delayScaleRaw = requireValue(arg, argv, i);
        i += 1;
        break;
      case "--items":
        items = parsePositiveInteger(arg, requireValue(arg, argv, i));
        i += 1;
        break;
      case "--tools":
        tools = parsePositiveInteger(arg, requireValue(arg, argv, i));
        i += 1;
        break;
      case "--load":
        load = true;
        break;
      case "--resume":
        resume = true;
        break;
      case "--list":
        list = true;
        break;
      case "--persist":
        persist = true;
        break;
      case "--title-update":
        titleUpdate = true;
        break;
      case "--history":
        history = true;
        break;
      case "--long-gap":
        longGap = true;
        break;
      case "--start-delay":
        startDelayMs = parseDelayMs(arg, requireValue(arg, argv, i));
        i += 1;
        break;
      case "--list-delay":
        listDelayMs = parseDelayMs(arg, requireValue(arg, argv, i));
        i += 1;
        break;
      case "--auth-required":
        authRequired = "full";
        break;
      case "--auth-required=bare":
        authRequired = "bare";
        break;
      case "--auth-required=prompt":
        authRequired = "prompt";
        break;
      case "--additional-directories":
        additionalDirectories = true;
        break;
      case "--add-workspace":
        addWorkspace.push(requireValue(arg, argv, i));
        i += 1;
        break;
      case "--no-initialize":
        noInitialize = true;
        break;
      case "--print-terminal":
        printTerminal = "escape";
        break;
      case "--print-terminal=lines":
        printTerminal = "lines";
        break;
      case "--session-delay":
        sessionDelayMs = parseDelayMs(arg, requireValue(arg, argv, i));
        i += 1;
        break;
      case "--session-heartbeat":
        sessionHeartbeatMs = parseDelayMs(arg, requireValue(arg, argv, i));
        i += 1;
        break;
      case "--session-permission":
        sessionPermission = true;
        break;
      case "--agent-info":
        agentInfo = parseAgentInfo(requireValue(arg, argv, i));
        i += 1;
        break;
      case "--chunk":
        chunk = parsePositiveInteger(arg, requireValue(arg, argv, i));
        i += 1;
        break;
      case "--sessions":
        sessionsPath = requireValue(arg, argv, i);
        i += 1;
        break;
      case "--page-size":
        pageSize = parsePositiveInteger(arg, requireValue(arg, argv, i));
        i += 1;
        break;
      case "--load-error":
        loadErrors.push(requireValue(arg, argv, i));
        i += 1;
        break;
      default:
        throw new Error(`unknown fake-agent argument '${arg}'`);
    }
  }

  if (persist && sessionsPath === undefined) {
    throw new Error("--persist requires --sessions <file>");
  }

  return {
    scenario,
    logPath,
    delayScale: parseDelayScale(delayScaleRaw),
    items,
    load,
    resume,
    list,
    sessionsPath,
    persist,
    pageSize,
    loadErrors,
    titleUpdate,
    history,
    chunk,
    longGap,
    tools,
    startDelayMs,
    listDelayMs,
    authRequired,
    agentInfo,
    additionalDirectories,
    addWorkspace,
    noInitialize,
    printTerminal,
    sessionDelayMs,
    sessionHeartbeatMs,
    sessionPermission,
  };
}
