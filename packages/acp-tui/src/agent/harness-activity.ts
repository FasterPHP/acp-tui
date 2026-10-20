// Which moments of a session can follow a harness retitling the tab (windows-support D5). On
// Windows a harness shares acp-tui's console, so anything it runs can call SetConsoleTitle: Claude
// Code sets `process.title` to `claude` when its process starts, which is when the adapter creates
// or loads a session, and a command a tool runs may do the same. acp-tui cannot read the console
// title from Bun, so instead of watching it sets its own title again at these moments:
//   - `session`: a session was created, opened or resumed (the harness started its worker);
//   - `turn_end`: a prompt was answered (a command run in the turn may have retitled the tab);
//   - `tool`: a tool call reached a final status (the command it ran has ended).
// Nothing here writes anything: the caller decides, and only does so on Windows.
import type { ModelEvent } from "acp-model";

export type HarnessActivity = "session" | "turn_end" | "tool";

/** The activity a live model event stands for, or null when the event cannot follow a retitle. */
export function harnessActivity(event: ModelEvent): HarnessActivity | null {
  switch (event.type) {
    case "session_created":
    case "session_opened":
      return "session";
    case "prompt_response":
    case "prompt_error":
      return "turn_end";
    case "session_update": {
      const update = event.update;
      if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return null;
      return update.status === "completed" || update.status === "failed" ? "tool" : null;
    }
    default:
      return null;
  }
}
