#!/usr/bin/env bun
// fake-agent entry point (design D12, task 4.1): a real ACP agent on
// AgentSideConnection over its own stdio, so it exercises
// @agentclientprotocol/sdk on Bun from the agent side, the same way
// acp-tui exercises it from the client side.
//
// Only ACP protocol bytes go to stdout; every diagnostic goes to stderr or,
// when --log is given, to the JSON-lines log file.
import { Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { createFakeAgent } from "./agent.ts";
import { parseArgs } from "./cli.ts";
import { ScenarioLogger } from "./logger.ts";
import { resolveScenario } from "./scenarios/index.ts";
import { SessionStore } from "./sessions.ts";

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const scenario = resolveScenario(options.scenario);
  const logger = new ScenarioLogger(options.logPath);
  // Terminal output comes before anything else, as a harness that is a terminal interface would write it.
  if (options.printTerminal === "escape") {
    process.stdout.write("\u001b[?1049hfake-agent terminal interface\n");
  } else if (options.printTerminal === "lines") {
    process.stdout.write("fake-agent banner line one\nfake-agent banner line two\nfake-agent banner line three\n");
  }
  if (options.addWorkspace.length > 0) {
    logger.record("argv/add-workspace", { directories: options.addWorkspace });
  }
  const store = SessionStore.open(
    options.sessionsPath,
    options.persist,
    scenario.builtinSessions?.(options.items) ?? [],
  );

  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const input = Bun.stdin.stream();
  const wire = ndJsonStream(output, input);
  // Records `$/cancel_request` (which the SDK handles itself, so no agent method sees it), so
  // tests can tell that a client cancelled a request.
  const stream = {
    writable: wire.writable,
    readable: wire.readable.pipeThrough(
      new TransformStream({
        transform(message, controller) {
          const method = (message as { method?: unknown }).method;
          if (method === "$/cancel_request") logger.record("$/cancel_request", (message as { params?: unknown }).params as Record<string, unknown>);
          controller.enqueue(message);
        },
      }),
    ),
  };

  const connection = new AgentSideConnection(
    (conn) =>
      createFakeAgent(conn, {
        scenario,
        logger,
        delayScale: options.delayScale,
        items: options.items,
        ...(options.chunk === undefined ? {} : { chunk: options.chunk }),
        longGap: options.longGap,
        tools: options.tools,
        startDelayMs: options.startDelayMs,
        noInitialize: options.noInitialize,
        additionalDirectories: options.additionalDirectories,
        sessionDelayMs: options.sessionDelayMs,
        ...(options.sessionHeartbeatMs === undefined ? {} : { sessionHeartbeatMs: options.sessionHeartbeatMs }),
        sessionPermission: options.sessionPermission,
        ...(options.authRequired === undefined ? {} : { authRequired: options.authRequired }),
        ...(options.agentInfo === undefined ? {} : { agentInfo: options.agentInfo }),
        sessions: {
          load: options.load,
          resume: options.resume,
          list: options.list,
          ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
          loadErrors: new Set(options.loadErrors),
          titleUpdate: options.titleUpdate,
          history: options.history,
          listDelayMs: options.listDelayMs,
          store,
        },
      }),
    stream,
  );

  connection.closed.catch((error: unknown) => {
    console.error("fake-agent: connection closed with error", error);
  });
}

main();
