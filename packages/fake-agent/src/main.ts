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
        startDelayMs: options.startDelayMs,
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
