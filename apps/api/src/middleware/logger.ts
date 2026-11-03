import { randomUUID } from "node:crypto";
import type { Context, Next } from "hono";
import { log, withLogContext } from "../lib/logger.js";

/** An incoming id is taken only if it looks like one — never a free-text header into Loki. */
const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * One `http.request` line per request, in the house shape
 * (`req_id / method / path / status / latency_ms`), and a `req_id` on every
 * line logged while handling it.
 *
 * - ★ A healthy `/health` is not logged: in homework the k8s probes were 98% of
 *   all API lines. A FAILING health check still is.
 * - The live stream (`/events`) is logged when it closes, so its latency_ms is
 *   how long the browser was connected.
 * - The level follows the status: 5xx `error`, 4xx `warn`, else `info` — so
 *   `| json | level="error"` finds the failures.
 * - On a 5xx, `err` carries what was thrown (Hono sets `c.error`), stack
 *   included, in the same one JSON line.
 * - `X-Request-Id` is honoured when it looks like an id and echoed back, so a
 *   request can be followed from a curl or the browser into Loki.
 */
export async function requestLogger(c: Context, next: Next) {
  const incoming = c.req.header("x-request-id");
  const reqId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  const start = Date.now();
  c.set("req_id", reqId);
  c.header("X-Request-Id", reqId);

  await withLogContext({ req_id: reqId }, next);

  const status = c.res.status;
  if (c.req.path === "/health" && status === 200) return;

  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  log[level](
    {
      event: "http.request",
      req_id: reqId,
      method: c.req.method,
      path: c.req.path,
      status,
      // Set by middleware/auth.ts once the request is authorised.
      ...(c.get("user") ? { user_id: (c.get("user") as { id: string }).id } : {}),
      latency_ms: Date.now() - start,
      ...(status >= 500 && c.error ? { err: c.error } : {}),
    },
    "request handled",
  );
}
