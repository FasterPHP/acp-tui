// What the exit text needs to know about the session open at exit, beyond the
// model's snapshot (mvp-sessions design decision 12, spec tui-screen "Exit
// text below the command line"): whether a resume line would work (the agent
// can load or resume, and the session has had a prompt or was itself opened
// from history), with the agent's name or the ad hoc command the resume line
// repeats after `--`. `app/run.tsx` passes these fields to
// `renderer/exit-text.ts` next to `session`. Since IDE check 10.4 (decision A)
// the exit text is the resume line alone, so the title is no longer printed.
import { AD_HOC_AGENT, launchArgv, type LaunchDescription } from "../agent/resolve.ts";
import type { SessionController } from "./controller.ts";
import type { SessionRecorder } from "./recorder.ts";

export interface SessionExitState {
  /** The agent advertises `loadSession` or `sessionCapabilities.resume`. */
  readonly canReopen: boolean;
  /** A prompt was sent in this run. */
  readonly hadPrompt: boolean;
  /** The session was opened from history (`session/load` or `session/resume`). */
  readonly openedFromHistory: boolean;
  /** The agent's name in the catalogue, or `ad hoc`. */
  readonly agentName: string;
  /** For an `ad hoc` agent, its command (the resume line repeats it after `--`); else null. */
  readonly adHocCommand: readonly string[] | null;
}

/** The state of a session that may still be starting: `opened` is true once a load or resume has
 *  been requested for it (a detach during the load still leaves a session to resume). */
export function sessionExitState(
  parts: { readonly controller: Pick<SessionController, "support">; readonly recorder: Pick<SessionRecorder, "prompted">; readonly opened: boolean },
  launch: Pick<LaunchDescription, "agentName" | "command" | "args">,
): SessionExitState {
  const { controller, recorder } = parts;
  return {
    canReopen: controller.support.load || controller.support.resume,
    hadPrompt: recorder.prompted,
    openedFromHistory: parts.opened,
    agentName: launch.agentName,
    adHocCommand: launch.agentName === AD_HOC_AGENT ? launchArgv(launch) : null,
  };
}
