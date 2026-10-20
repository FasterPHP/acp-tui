// Full repaints (phase-1a task 4.5, design D6, spec tui-screen "Relayout and
// settle repaint on resize"). OpenTUI relays out on every resize (after its
// own short debounce) and then draws only the cells that changed. Terminals
// rearrange cells on a resize (reflow, row trimming) behind the renderer's
// back, so once no resize has occurred for 150 ms every cell is repainted
// once. Ctrl+L does the same at once.
//
// OpenTUI 0.5.12 has no public call for a repaint of every cell; its private
// `forceFullRepaintRequested` makes the next frame write every cell. This file
// is the one place that sets it (the last OpenTUI internal acp-tui relies on,
// pinned exactly); test/renderer/resize.pty.test.ts fails if it stops working.
//
// Extension points (task group 5 and task 8.4): `onRepaint` listeners run
// after the settle repaint (cause `settle`) and after Ctrl+L (cause `key`),
// for the colour re-query of design D8. A listener that re-derives colours
// asynchronously calls `forceFullRepaint` itself afterwards, which notifies
// nobody, so there is no loop.
import type { CliRenderer } from "@opentui/core";

/** Quiet period after the last resize before the settle repaint. */
export const SETTLE_MS = 150;

export type RepaintCause = "settle" | "key";

interface PrivateRenderer {
  forceFullRepaintRequested: boolean;
}

/** Makes the next frame write every cell, and requests that frame. */
export function forceFullRepaint(renderer: CliRenderer): void {
  if (renderer.isDestroyed) return;
  (renderer as unknown as PrivateRenderer).forceFullRepaintRequested = true;
  renderer.requestRender();
}

export interface Repainter {
  /** Ctrl+L: a full repaint now, then the `key` listeners. */
  repaintNow(): void;
  /** Adds a listener run after each settle repaint and each `repaintNow`; returns a remover. */
  onRepaint(listener: (cause: RepaintCause) => void): () => void;
  /** Stops the settle timer and drops the listeners (also done when the renderer is destroyed). */
  dispose(): void;
}

export interface RepaintOptions {
  /** Default `SETTLE_MS`. */
  settleMs?: number;
  /** Also restart the settle timer on the process's SIGWINCH; default true. */
  sigwinch?: boolean;
}

/** Installs the settle repaint on `renderer`'s resize events. */
export function installRepaint(renderer: CliRenderer, options: RepaintOptions = {}): Repainter {
  const settleMs = options.settleMs ?? SETTLE_MS;
  const listeners = new Set<(cause: RepaintCause) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function notify(cause: RepaintCause): void {
    for (const listener of listeners) {
      try {
        listener(cause);
      } catch {
        // A failing listener must not stop the repaint or the others.
      }
    }
  }

  function repaint(cause: RepaintCause): void {
    forceFullRepaint(renderer);
    notify(cause);
  }

  // The timer restarts on every SIGWINCH and on every relayout (OpenTUI's
  // `resize` event, 100 ms after the last SIGWINCH), so a storm gets one
  // settle repaint at its end, after the last relayout. SIGWINCH counts on its
  // own because OpenTUI skips the relayout (and the event) when a storm ends
  // at the size it started from, while the terminal may still have moved
  // cells in between.
  const onResize = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      repaint("settle");
    }, settleMs);
  };

  const repainter: Repainter = {
    repaintNow() {
      repaint("key");
    },
    onRepaint(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      listeners.clear();
      renderer.off("resize", onResize);
      renderer.off("destroy", repainter.dispose);
      if (options.sigwinch ?? true) process.off("SIGWINCH", onResize);
    },
  };
  renderer.on("resize", onResize);
  renderer.on("destroy", repainter.dispose);
  if (options.sigwinch ?? true) process.on("SIGWINCH", onResize);
  return repainter;
}
