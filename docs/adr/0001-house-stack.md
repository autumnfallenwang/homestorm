# 0001: Same stack and deployment as the other home apps

- **Status:** accepted
- **Date:** 2026-11-02

## Context

homestorm joins the home apps on the k3s cluster: homenews, homecal, homework and homejobboard. Those apps share one
stack and one deployment model (see homework's ADR 0001). Matching them means one way of building, deploying and
debugging everything.

## Decision

- **Language and repo:** TypeScript; pnpm with a Turborepo monorepo (`apps/api`, `apps/web`, `packages/shared`).
- **API:** Hono + Zod, on `@hono/node-server`.
- **Web:** Next.js App Router, React, Tailwind, shadcn components.
- **Database:** PostgreSQL with Drizzle. Like homework, the Helm chart runs its own `postgres:17-alpine` StatefulSet.
- **LLM client:** the `openai` package, pointed at llmgw (see [0002](0002-llm-access-through-llmgw.md)).
- **Quality:** Vitest for tests, Biome for lint and format, `tsc --noEmit` for type checks.
- **Logs:** pino, one JSON line per event, collected into Loki.
- **Deploy:** images on GHCR, a Helm chart at `deploy/chart`, and GitOps through `arch-infra` and Argo CD.

## Alternatives considered

- **A different stack for a chat app** (e.g. Python with a FastAPI backend, or SvelteKit). Rejected: nothing about this
  app needs it, and it would be the odd one out on the cluster.

## Consequences

- Patterns, deploy files and lessons from the sibling apps carry over directly.
- This repo stays plain Markdown docs plus code: no devkit scaffold, hooks or project skills.
