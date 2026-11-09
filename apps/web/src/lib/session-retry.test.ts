import { describe, expect, it } from "vitest";
import { SESSION_RETRY_MAX_MS, sessionRetryDelay } from "./session-retry";

describe("the session check's retry", () => {
  it("asks again soon, then backs off to every 10 seconds", () => {
    expect([0, 1, 2, 3, 4, 10].map(sessionRetryDelay)).toEqual([
      1_000,
      2_000,
      4_000,
      8_000,
      SESSION_RETRY_MAX_MS,
      SESSION_RETRY_MAX_MS,
    ]);
  });

  it("covers a deploy's ~15 seconds without the API within four tries", () => {
    const waited = [0, 1, 2, 3].map(sessionRetryDelay).reduce((a, b) => a + b, 0);
    expect(waited).toBeGreaterThanOrEqual(15_000);
  });
});
