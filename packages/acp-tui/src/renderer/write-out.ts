// Raw terminal output from acp-tui itself (title stack, attention signals, mode 1007). It goes
// through OpenTUI's own output stream, so it is ordered with the frames instead of landing in the
// middle of one: since OpenTUI 0.6 (opentui-0-6 design D4) that is the public `write()` of the
// `NativeSession` acp-tui constructs for the renderer (create.ts), which queues the bytes between
// frames (probe `docs/mvp-notes/opentui-0.6-probes/session-write.ts`). A renderer without one
// (constructed elsewhere, as some tests do) gets a plain write to stdout. Escape output comes
// only from acp-tui: callers pass fixed sequences, or text that has been through the sanitiser.
import type { CliRenderer } from "@opentui/core";
import { NULL_LOGGER, type DebugLogger } from "../log.ts";
import { rendererSession } from "./create.ts";

export type WriteOut = (data: string) => void;

const encoder = new TextEncoder();

/** Writes through the renderer's session; nothing once the renderer is destroyed (the lifecycle's
 *  final reset writes the restoring sequences itself). A `false` from `write()` (the native queue
 *  is full) is logged as `write_out` with `dropped`, and the bytes are not retried: they are
 *  idempotent mode and title sequences. A session that is closing or has failed throws; that is
 *  logged the same way. */
export function rendererWrite(renderer: CliRenderer, logger: DebugLogger = NULL_LOGGER): WriteOut {
  return (data) => {
    if (renderer.isDestroyed) return;
    const session = rendererSession(renderer);
    if (!session) {
      process.stdout.write(data);
      return;
    }
    let accepted: boolean;
    try {
      accepted = session.write(encoder.encode(data));
    } catch (error) {
      logger.log({ event: "write_out", dropped: data.length, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!accepted) logger.log({ event: "write_out", dropped: data.length });
  };
}
