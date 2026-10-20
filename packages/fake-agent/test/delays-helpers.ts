// Shared by delays.test.ts and delays.timing.test.ts (split by the change parallel-tests, tasks 3.x). Not a test file.

/** Allowed early margin for timer granularity and the time the request spends in flight. */
export const SLACK_MS = 30;

export async function timed<T>(call: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await call();
  return { value, ms: performance.now() - start };
}
