import { count } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { auth } from "./auth.js";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";
import {
  type AuthVariables,
  authorize,
  authRouteGate,
  betterAuthSession,
  publicRateLimiter,
  type ResolveSession,
} from "./middleware/auth.js";
import { requestLogger } from "./middleware/logger.js";

export interface AppOptions {
  /** How a request becomes a user. Route tests inject a fake so they need no DB. */
  resolveSession?: ResolveSession;
  /** Per-IP limits on sign-in and /api/public/*. Off under tests (shared in-memory store). */
  rateLimit?: boolean;
  /** Extra routes mounted after authorization (the meeting routes, M5). */
  mount?: (app: Hono<{ Variables: AuthVariables }>) => void;
}

export function createApp(options: AppOptions = {}) {
  const resolveSession = options.resolveSession ?? betterAuthSession;
  const rateLimit = options.rateLimit ?? process.env.NODE_ENV !== "test";
  const app = new Hono<{ Variables: AuthVariables }>();

  // One `http.request` line per request; `req_id` on every line inside it.
  app.use("*", requestLogger);

  // The last resort for a THROWN error: the house's flat `{ error }` and a 500. It doesn't log: the request line
  // already carries `err` at `error`. Routes return their expected 400/404s; an HTTPException keeps its response.
  app.onError((err, c) =>
    err instanceof HTTPException ? err.getResponse() : c.json({ error: "internal" }, 500),
  );

  app.use("*", cors({ origin: config.corsOrigins, credentials: true }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // ── Login (ADR 0011) ─────────────────────────────────────────────────────
  if (rateLimit) {
    app.use("/api/auth/sign-in/*", publicRateLimiter(10));
    app.use("/api/public/*", publicRateLimiter(60));
  }
  app.use("/api/auth/*", authRouteGate);
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // First run? The sign-in page offers "create the admin" only then.
  app.get("/api/public/setup-state", async (c) => {
    const [result] = await db.select({ value: count() }).from(users);
    return c.json({ needsAdmin: (result?.value ?? 0) === 0 });
  });

  // Everything under /api/* past this point needs the session.
  app.use("/api/*", authorize(resolveSession));
  app.get("/api/me", (c) => c.json({ user: c.get("user") }));

  options.mount?.(app);

  return app;
}
