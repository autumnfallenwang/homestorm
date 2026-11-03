// One admin login (ADR 0011): Better Auth on the house setup (homework, homecal), with no plugins and no roles.
// The first sign-up creates the admin; after that the sign-up route is closed (middleware/auth.ts).

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { config } from "./config.js";
import { db } from "./db/index.js";
import * as schema from "./db/schema.js";
import { log } from "./lib/logger.js";

const WRONG_CREDENTIALS = /invalid (password|email)|user not found/i;

export const auth = betterAuth({
  secret: config.betterAuthSecret,
  baseURL: config.betterAuthUrl,
  /**
   * Better Auth's own output as one JSON line through pino, not coloured console text. Only the message and an
   * Error travel: its other arguments can be request data.
   */
  logger: {
    log: (level, message, ...args) => {
      const err = args.find((arg) => arg instanceof Error);
      // A wrong password is a person typing, not a failure.
      const lvl = level === "error" && WRONG_CREDENTIALS.test(message) ? "warn" : level;
      log[lvl]({ event: "auth.log", detail: message, ...(err ? { err } : {}) }, "better-auth");
    },
  },
  database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
  trustedOrigins: config.corsOrigins,
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days, as the siblings
    updateAge: 60 * 60 * 24, // refreshed daily while in use
  },
  advanced: {
    // Postgres generates the uuids.
    database: { generateId: false },
    ...(config.cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: config.cookieDomain } }
      : {}),
  },
});
