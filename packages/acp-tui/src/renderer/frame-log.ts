// Frame and mounted-renderable events for the S3 scale benchmark (phase-1a task 12.1;
// bench/scale.ts reads them). Only with `ACP_TUI_LOG` set: without a logger nothing is
// installed, so a normal run pays nothing.
//
//   { event: "frame", id, ms, cells, gap, work }   per rendered frame
//   { event: "mounted", count }              renderables under the root, when the count changed
//
// `ms` is the native stats' `lastFrameTime`. Measured on 30 September 2026 (S3, Phase 1a), it
// equals `gap` to a few hundredths of a millisecond on every frame, including a 1456 ms "frame"
// after the app sat idle for a second: it is the interval since the previous frame, not the
// frame's own work (OpenTUI hands the frame's time to `updateStats`, but the value read back is
// the interval). `work` is the frame's own time: from the start of the frame callbacks (a
// callback installed here stamps it; only the animation requests run before) to the `frame`
// event (after layout, render and the native write). `gap` is the time since the previous
// frame event, which shows stalls that happen between frames. `count` walks the whole tree, culled renderables included, every
// `mountedIntervalMs` (500 by default) and logs only a changed value; the walk runs outside
// the frame, on a timer.
import { CliRenderEvents, type CliRenderer, type Renderable } from "@opentui/core";
import type { DebugLogger } from "../log.ts";

export interface FrameLogOptions {
  /** How often the mounted count is sampled; default 500. */
  mountedIntervalMs?: number;
}

export interface FrameLog {
  /** Counts the renderables now and logs the count (whether or not it changed). */
  logMounted(): number;
  /** Stops the sampling and the frame listener (also done when the renderer is destroyed). */
  dispose(): void;
}

/** The renderables below `root` (the root itself not counted), at any depth. */
export function countMounted(root: Renderable): number {
  let count = 0;
  const stack: Renderable[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const children = node.getChildren() as Renderable[];
    count += children.length;
    for (const child of children) stack.push(child);
  }
  return count;
}

/** Installs the frame log on `renderer`; null when `logger` is not enabled. */
export function installFrameLog(renderer: CliRenderer, logger: DebugLogger, options: FrameLogOptions = {}): FrameLog | null {
  if (!logger.enabled) return null;
  let lastAt = performance.now();
  let lastCount = -1;
  let disposed = false;
  let frameStart: number | null = null;
  // OpenTUI awaits frame callbacks; the stamp is taken synchronously when it is called.
  const stamp = async (): Promise<void> => {
    frameStart = performance.now();
  };
  renderer.setFrameCallback(stamp);

  const onFrame = (event: { frameId: number }): void => {
    const now = performance.now();
    const stats = renderer.getNativeStats();
    logger.log({
      event: "frame",
      id: event.frameId,
      // The native stats are in microseconds (a 20 ms busy frame callback reads about 20 000).
      ms: Math.round(stats.nativeLastFrameTime / 10) / 100,
      cells: stats.cellsUpdated,
      gap: Math.round((now - lastAt) * 100) / 100,
      ...(frameStart === null ? {} : { work: Math.round((now - frameStart) * 100) / 100 }),
    });
    frameStart = null;
    lastAt = now;
  };

  function logMounted(): number {
    const count = renderer.isDestroyed ? 0 : countMounted(renderer.root);
    lastCount = count;
    logger.log({ event: "mounted", count });
    return count;
  }

  const timer = setInterval(() => {
    if (disposed || renderer.isDestroyed) return;
    const count = countMounted(renderer.root);
    if (count === lastCount) return;
    lastCount = count;
    logger.log({ event: "mounted", count });
  }, options.mountedIntervalMs ?? 500);
  timer.unref();

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    renderer.removeFrameCallback(stamp);
    renderer.off(CliRenderEvents.FRAME, onFrame);
    renderer.off(CliRenderEvents.DESTROY, dispose);
  }

  renderer.on(CliRenderEvents.FRAME, onFrame);
  renderer.once(CliRenderEvents.DESTROY, dispose);
  return { logMounted, dispose };
}
