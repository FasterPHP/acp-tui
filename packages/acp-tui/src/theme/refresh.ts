// Re-querying the terminal's colours on the refresh triggers of design D8 (spec tui-theme
// "Surfaces derived from the terminal's colours"): resize settle, Ctrl+L, SIGUSR2 and
// `CSI ? 997 ; n n`. The caller wires the first three to `run()`; the fourth needs no hook,
// because OpenTUI re-queries and the tracker's open OSC subscription sees the replies. Every
// changed answer, whatever provoked it, is followed by a full repaint.
import type { LiveTheme } from "./live.ts";
import type { ThemeColours } from "./terminal-colours.ts";

export interface ThemeRefresh {
  /**
   * Re-queries and re-derives; a changed answer repaints. With `{ always: true }` (SIGUSR2, an
   * explicit request) it repaints even when nothing changed. A refresh that starts while one is
   * running joins it. Never rejects.
   */
  run(options?: { always?: boolean }): Promise<void>;
  dispose(): void;
}

export function createThemeRefresh(deps: { colours: ThemeColours; theme: LiveTheme; repaint: () => void }): ThemeRefresh {
  let running: Promise<void> | null = null;
  let always = false;
  let repaints = 0;
  // Registered after the binding's own handler, so the surfaces are already re-derived.
  const stop = deps.colours.tracker.onChange(() => {
    repaints++;
    deps.repaint();
  });
  return {
    run(options = {}) {
      always ||= options.always === true;
      running ??= (async () => {
        const seen = repaints;
        try {
          await deps.colours.refresh();
        } catch {
          // A failed query keeps the colours in use.
        }
        const force = always && repaints === seen;
        running = null;
        always = false;
        if (force) deps.repaint();
      })();
      return running;
    },
    dispose: stop,
  };
}
