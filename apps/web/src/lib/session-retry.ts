// How long the session check waits before asking again when the API doesn't answer. A deploy restarts the API (one
// pod, Recreate) and leaves it unreachable for about 15 seconds: 1, 2, 4, 8, then every 10 seconds covers that
// quickly without hammering a longer outage.

export const SESSION_RETRY_MAX_MS = 10_000;

export function sessionRetryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, SESSION_RETRY_MAX_MS);
}
