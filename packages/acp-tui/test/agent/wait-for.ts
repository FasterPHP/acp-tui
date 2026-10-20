// Test helper: waits for a SessionController's session to satisfy a predicate, via subscribe
// rather than polling, since the controller notifies synchronously on every reducer step.
import type { Session } from "acp-model";
import type { SessionController } from "../../src/session/controller.ts";

export function waitFor(
  controller: SessionController,
  predicate: (session: Session) => boolean,
  timeoutMs = 5000,
): Promise<Session> {
  const current = controller.getSession();
  if (predicate(current)) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`waitFor timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    const unsubscribe = controller.subscribe((session) => {
      if (predicate(session)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(session);
      }
    });
  });
}
