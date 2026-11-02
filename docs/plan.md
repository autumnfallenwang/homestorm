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

## Open decisions

| # | Decision | Recommendation | Status |
|---|---|---|---|
| D1 | v1 scope | As listed above | open |
| D2 | Where rounds run, and how the browser gets live updates | **On the server.** The browser sends an action; the server calls llmgw and saves every token as it streams. The browser follows one live stream (SSE) per meeting. Closing the tab doesn't kill a round, and reloading resumes it. One API instance, so no Redis or queue. | open |
| D3 | Login | Better Auth with a single admin, as in homecal and homework, since the app spends DeepSeek balance and subscription allowance. Alternative: no login, internal network only. | open |
| D4 | Long meetings, answer length, thinking effort | **Long meetings:** when a meeting outgrows a seat's model limit, drop the oldest turns but keep the intro and the first question, and show "older turns trimmed" in the UI. Summaries come later. **"Concise":** an instruction plus a cap on output tokens. **Thinking effort:** a per-seat `reasoning_effort` setting, defaulting to low or medium. | open |
| D5 | Seat intro and floor-note wording | Fixed templates in code with the persona appended; drafted by Claude, reviewed by the user. | open |
| D6 | How llmgw signs in to Claude | An account decision, tracked privately. homestorm's code is the same either way. | open: the user's call |
| D7 | Name | **homestorm** ([ADR 0008](adr/0008-name-homestorm.md)) | decided |

When a decision is made, record it as an ADR in [adr/](adr/), update this table, and log it in
[progress.md](progress.md).

---

## Milestones

Status: ✅ done · 🔄 in progress · ⬜ not started

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

### M2: Open decisions settled 🔄

- [ ] D1–D6 above decided and recorded as ADRs

### M3: Data model and per-seat view ⬜

- [ ] Schema: meeting, seat, message, round, including start and finish times and usage fields
- [ ] `buildView(meeting, seat)`: role mapping, speaker tags, merged turns, intro, visibility rule, trimming for long
  meetings
- [ ] Intro and floor-note templates (D5)
- [ ] Unit tests for the view builder

### M4: Project scaffold ⬜

- [ ] pnpm + Turborepo monorepo: `apps/api`, `apps/web`, `packages/shared`
- [ ] Drizzle setup and first migration; Biome, Vitest, tsc
- [ ] llmgw client (`openai` package) with a smoke test against the real gateway

### M5: Meeting engine ⬜

- [ ] Action API: message / round / reply-to / mute / seat changes / stop / retry / wrap up
- [ ] Round runner: blind (all at once) and in turn (one after another), driven by the server
- [ ] Live event stream per meeting: message started, text added, finished, error, round status; resume after reload
- [ ] Saving usage, cost and `req_id` per message; errors surfaced, never switched to another model
- [ ] Allowance check before a seat takes the floor

### M6: Web UI ⬜

- [ ] Three-pane layout per [ADR 0007](adr/0007-three-pane-meeting-ui.md) and the mockup
- [ ] Message box with send-to selector and @mentions; hover bar with Reply to / Retry / Copy
- [ ] Seats panel with live status and allowance; add-seat dialog; seat menu
- [ ] Streaming Markdown rendering; round boxes; event lines; problem states

### M7: Wrap up, export, polish ⬜

- [ ] Wrap-up dialog and minutes posted to the meeting
- [ ] Markdown export
- [ ] Login (D3)

### M8: Deploy ⬜

- [ ] Dockerfiles, Helm chart with its own Postgres, GHCR images
- [ ] `arch-infra` app entry, Argo CD sync, hostname
- [ ] Logs in Loki; first real meeting on the cluster
