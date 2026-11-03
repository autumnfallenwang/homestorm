# 0011: One admin login with Better Auth

- **Status:** accepted
- **Date:** 2026-11-02

## Context

Every meeting spends the Claude and ChatGPT subscription allowance and the DeepSeek balance. Anyone on the home
network who can open the app could spend them (D3 in [plan.md](../plan.md)).

## Decision

- **Better Auth 1.4.19**, the sibling apps' pin, with email and password, the Drizzle adapter (`usePlural`), Postgres
  uuids and no plugins.
- **One login, the admin.** First run: the web app's `/setup` page signs up the first account. After that, the
  sign-up route is closed (403). This is homework's pattern.
- **Every `/api/*` route needs the session**, except `/api/auth/*` and `/api/public/setup-state`. The live stream is
  protected the same way: the browser sends the cookie with it.
- **Cluster:** `COOKIE_DOMAIN=.arch.internal`, so the cookie set by the API host also travels to the web host. It is
  unset in local dev.
- **Forgotten password:** a `reset-password` script, run with `kubectl exec`, prints a one-time password.
- Sessions last 7 days and refresh daily. Sign-in is rate-limited per IP.

## Alternatives considered

- **No login, home network only.** Rejected: the app spends money and allowance.
- **An admin seeded from environment variables.** Rejected: it puts a password in a Kubernetes Secret, and the first
  run setup page is what the siblings already use.
- **Better Auth's `admin` plugin.** Rejected: there's only one user, so its roles and endpoints add nothing.

## Consequences

- Right after the first deploy, the admin has to be created at `/setup` before anyone else opens it.
- `BETTER_AUTH_SECRET` is required; the API refuses to start without it.
