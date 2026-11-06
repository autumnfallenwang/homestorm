/**
 * Environment configuration. Dev reads `apps/api/.env` via `tsx --env-file`; the cluster injects env vars from the
 * Helm chart. Same code, different values.
 */
export const config = {
  databaseUrl: process.env.DATABASE_URL,
  apiPort: Number(process.env.API_PORT ?? 3001),
  logLevel: process.env.LOG_LEVEL ?? "info",
  /** Origins allowed by CORS: the web app. */
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** The home LLM gateway (ADR 0002). */
  llmgwUrl: process.env.LLMGW_URL ?? "http://llmgw.llmgw.svc.cluster.local",
  /** The home tool gateway (ADR 0014). Unset, the web features are off and everything else works as usual. */
  mcpgwUrl: process.env.MCPGW_URL?.trim() || null,
  /** Most tokens one seat's view may use per turn (ADR 0012). */
  viewTokenBudget: Number(process.env.VIEW_TOKEN_BUDGET ?? 120_000),
  /**
   * Better Auth's signing secret (ADR 0011). Required: index.ts refuses to start without it. Tests get a fixed one.
   */
  betterAuthSecret:
    process.env.BETTER_AUTH_SECRET ??
    (process.env.NODE_ENV === "test" ? "test-only-better-auth-secret-0123456789" : undefined),
  /** This API's own public URL: Better Auth's baseURL. */
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`,
  /**
   * Cookie domain shared by the web and API hosts in the cluster (`.arch.internal`): the UI and the API are two
   * hosts, so a host-only cookie would never travel with the UI's requests ("sign-in 200, then 401 on everything").
   * ⚠️ Must stay UNSET locally: a `.arch.internal` cookie is invalid on localhost and silently dropped.
   */
  cookieDomain: process.env.COOKIE_DOMAIN?.trim() || undefined,
} as const;
