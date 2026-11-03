# Plan

What the first workable version of homestorm includes, the milestones to get there, and the decisions still open.
Progress against this plan is logged in [progress.md](progress.md).

**Updated:** 2026-11-02

---

## First version (v1)

### In

- **Meetings:** meetings list (create, open, rename, delete), title typed by the chair.
- **Seats:** add from llmgw's models grouped by source; remove; mute and unmute; reorder; display name and optional
  persona.
- **Chair actions:**
  - send-to of *Everyone · blind*, *Everyone · in turn* or *No reply*;
  - @mention seats;
  - reply to a specific message;
  - stop one seat or all, and retry on the same model;
  - wrap up into minutes, a decision or open questions.
- **Live answers:** streaming, Markdown and code rendering, rounds grouped in the transcript.
- **Allowance and errors:**
  - per-seat allowance from `/v1/limits`;
  - seats that are unavailable or out of allowance can't take the floor;
  - problems shown in place: rate limited, stopped, error.
- **Tracing:** per-message model, source, tokens, `cost_usd` and llmgw `req_id`.
- **Export:** a meeting as Markdown.

### Out (later)

Slash commands, search, attachments and images, auto-discussion, private questions, polls, council mode, automatic
titles, branching a meeting, memory across meetings.

---

## Decisions

| # | Decision | Status |
|---|---|---|
| D1 | v1 scope: as listed above; tracing saves llmgw's usage, cost and `req_id` when llmgw returns them, and an estimate until then | decided: [ADR 0009](adr/0009-first-version-scope.md) |
| D2 | Rounds run on the server; one live stream (SSE) per meeting; one API instance | decided: [ADR 0010](adr/0010-rounds-run-on-the-server.md) |
| D3 | Login: Better Auth, one admin created at first-run `/setup` | decided: [ADR 0011](adr/0011-one-admin-login.md) |
| D4 | Long meetings trimmed per seat; *Concise* / *Detailed* answers; per-seat `reasoning_effort`, default `low` | decided: [ADR 0012](adr/0012-long-meetings-answer-length-effort.md) |
| D5 | Intro and floor-note templates fixed in code, persona appended | decided: [ADR 0013](adr/0013-intro-and-floor-note-templates.md) |
| D6 | How llmgw signs in to Claude | closed: not a homestorm concern; homestorm only uses llmgw's API |
| D7 | Name | decided: **homestorm** ([ADR 0008](adr/0008-name-homestorm.md)) |

When a decision is made, record it as an ADR in [adr/](adr/), update this table, and log it in
[progress.md](progress.md).

---

## Milestones

Status: ✅ done · 🔄 in progress · ⬜ not started

All development and checks run on localhost (web on :3000, API on :3001, Postgres on :5433) until M8 deploys to the
cluster.

### M0: LLM backend ready ✅

- [x] llmgw serves Claude 5.x, GPT (the models on the current plan) and DeepSeek V4 Pro / Flash
- [x] `owned_by/model` naming; exact model only, no fallback
- [x] `/v1/limits` per family and per model, with `unavailable` for models not on the plan
- [x] Per-request `completion.usage` logs, sharing `req_id` with the request line (llmgw 0.5.0)

### M1: Research and design ✅

- [x] Chat-wrapper research ([chat-wrapper-research.md](chat-wrapper-research.md))
- [x] Meeting ruleset and controls ([meeting-control-design.md](meeting-control-design.md))
- [x] UI mockup, approved
- [x] Name: homestorm
- [x] Repo with ADRs 0001–0008, plan and progress docs

### M2: Open decisions settled ✅

- [x] D1–D5 decided and recorded as ADRs 0009–0013; D6 closed as outside homestorm

### M3: Data model and per-seat view ✅

- [x] Schema: meeting, seat, message, round, including start and finish times and usage fields
  ([data-model.md](data-model.md); first migration `0000_init.sql`)
- [x] `buildView(meeting, seat)`: role mapping, speaker tags, merged turns, intro, visibility rule, trimming for long
  meetings
- [x] Intro and floor-note templates (D5): `apps/api/src/engine/prompts.ts`
- [x] Unit tests for the view builder

### M4: Project scaffold ✅

- [x] pnpm + Turborepo monorepo: `apps/api`, `apps/web`, `packages/shared`
- [x] Drizzle setup and first migration; Biome, Vitest, tsc
- [x] llmgw client (`openai` package) with a smoke test against the real gateway (all three sources)
- [x] API skeleton: config, pino logging, request log, Better Auth admin login (D3), `reset-password` script

### M5: Meeting engine ✅

- [x] Action API: message / round / reply-to / mute / seat changes / stop / retry / wrap up
  (`apps/api/src/routes/meetings.ts`)
- [x] Round runner: blind (all at once) and in turn (one after another), driven by the server
  (`apps/api/src/engine/engine.ts`)
- [x] Live event stream per meeting: message started, text added, finished, error, round status; resume after reload
- [x] Saving usage, cost and `req_id` per message (estimated until llmgw sends them); errors surfaced, never switched
  to another model
- [x] Allowance check before a seat takes the floor
- [x] Verified on localhost against the real llmgw: a blind round and an in-turn round with Claude Haiku 5.5,
  GPT-5.6 Luna and DeepSeek Flash

### M6: Web UI ✅

- [x] Three-pane layout per [ADR 0007](adr/0007-three-pane-meeting-ui.md) and the mockup
- [x] Message box with send-to selector and @mentions; hover bar with Reply to / Retry / Copy
- [x] Seats panel with live status and allowance; add-seat dialog; seat menu
- [x] Streaming Markdown rendering; round boxes; event lines; problem states
- [x] Driven in a real browser on localhost against the real llmgw (blind round, reply-to, @mention, stop and keep,
  mute, wrap-up, export, phone width)

### M7: Wrap up, export, polish ⬜

- [ ] Wrap-up dialog and minutes posted to the meeting
- [ ] Markdown export
- [ ] Login (D3)

### M8: Deploy ⬜

- [ ] Dockerfiles, Helm chart with its own Postgres, GHCR images
- [ ] `arch-infra` app entry, Argo CD sync, hostname
- [ ] Logs in Loki; first real meeting on the cluster
