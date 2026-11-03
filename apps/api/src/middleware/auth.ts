// Who may call what (ADR 0011). The API is the enforcement point; the web app's redirects are convenience.
//
//   public   /health, /api/auth/* (Better Auth), /api/public/*
//   admin    every other /api/* route, the live stream included

import { count } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { log, withLogContext } from "../lib/logger.js";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** Hono variables set once a request is authorised. */
export type AuthVariables = { user: SessionUser };

/** Resolves request headers to the signed-in user. Injectable, so route tests need no DB. */
export type ResolveSession = (headers: Headers) => Promise<SessionUser | null>;

export const betterAuthSession: ResolveSession = async (headers) => {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email };
};

export const isPublic = (path: string) =>
  !path.startsWith("/api/") || path.startsWith("/api/auth/") || path.startsWith("/api/public/");

export function authorize(resolveSession: ResolveSession): MiddlewareHandler {
  return async (c, next) => {
    if (isPublic(c.req.path)) return next();
    let user: SessionUser | null;
    try {
      user = await resolveSession(c.req.raw.headers);
    } catch {
      // Better Auth throws on a malformed cookie: that's a missing session, not a 500.
      user = null;
    }
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    c.set("user", user);
    return withLogContext({ user_id: user.id }, next);
  };
}

/**
 * Public sign-up is open only until the first account exists; that account is the admin. Better Auth's
 * `disableSignUp` is a static flag and can't say "open until the first user".
 */
export const authRouteGate: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "POST" || !c.req.path.startsWith("/api/auth/sign-up/")) return next();
  const [result] = await db.select({ value: count() }).from(users);
  if ((result?.value ?? 0) > 0) {
    log.warn({ event: "auth.signup_closed" }, "sign-up refused: the admin already exists");
    return c.json({ error: "Sign-up is closed: homestorm has its admin already." }, 403);
  }
  return next();
};

/** Best-effort client IP. Behind Traefik the real address is in x-forwarded-for. */
export function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "anon";
}

/** Per-IP limit on password sign-in and the public routes (house pattern). */
export function publicRateLimiter(limit: number): MiddlewareHandler {
  return rateLimiter({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-7",
    keyGenerator: clientIp,
    message: { error: "Too many requests" },
  });
}
