# Plan

What the first workable version of homestorm includes, the milestones to get there, and the decisions still open.
Progress against this plan is logged in [progress.md](progress.md).

**Updated:** 2026-11-08

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

Done since v1: web search ([M9](#m9-tools-through-mcpgw-)) and images and text files (attachments phase 1).

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

### M7: Wrap up, export, polish ✅

- [x] Wrap-up dialog and minutes posted to the meeting (or kept from the seats)
- [x] Markdown export
- [x] Login (D3): first-run setup, sign in, sign out, change password, `reset-password` script
- [x] Polish from the browser run: plain-text reply quotes, model order (strongest family, newest first), accessible
  @mention list

### M8: Deploy ✅

- [x] Dockerfiles, Helm chart with its own Postgres, GHCR images (smoke-tested locally with a real meeting; CI green,
  images publicly pullable)
- [x] `arch-infra` app entry (`apps/homestorm.yaml`), Argo CD sync, hostnames `homestorm.arch.internal` and
  `homestorm-api.arch.internal`
- [x] Logs in Loki; first real meeting on the cluster (a blind round with Claude Sonnet 5.5, GPT-6 Luna and DeepSeek
  V4 Pro through the browser)

v1 is done. Next candidates are in "Out (later)" above.

## Future work

### M9: Tools through mcpgw ✅

Decided in [ADR 0014](adr/0014-tools-through-mcpgw.md): tools come from **mcpgw**, the home cluster's tool gateway
(`~/agentic/mcpgw`, http://mcpgw.mcpgw.svc.cluster.local); homestorm runs the tool loop.

- [x] **Prerequisite:** mcpgw built and deployed
- [x] **The date in the intro:** "Today is …; your training data may be older."
- [x] **Chair search:** a "Search the web" action in the message box; the results are posted as one message every seat
  sees. *Removed on 2026-11-08 ([ADR 0017](adr/0017-web-tools-room-rule.md))*
- [x] **Seat tools:**
  - a seat setting: off, "Can search and read pages", or "Must search before answering";
  - the tool loop in the engine, with a limit of 6 calls per turn (first 4);
  - "Searched: … · Read: …" under the answer, and the sources in the record and the export;
  - the URL rule: only links from the Chair or a search; images in answers never load
- [x] **Checked first:** streaming `tool_calls` through llmgw, on all three families with thinking on
- [x] **Tests:** `FakeTools` next to `FakeLlm`, a fake MCP server over HTTP for the client, and a real meeting in a real
  browser
- [x] **A real meeting on the cluster,** with the user signed in (2026-11-07): it led to 6 calls per turn and links that
  stop at Chinese punctuation, and to mcpgw's search pacing and news fixes (mcpgw M10)

### Attachments ([ADR 0016](adr/0016-attachments-images-and-text-files.md))

- [x] **Phase 1:** images (PNG, JPEG, WebP, GIF) and text files on the chair's messages and in the brief. Paperclip,
  drag and drop, paste; resized in the browser; thumbnails and a full-size viewer; text-only seats named in a hint
- [x] **Phase 2:** PDF and DOCX, read into text in the browser in a Web Worker, so the server never parses them
  ([ADR 0019](adr/0019-pdf-and-word-files-read-in-the-browser.md))
- [ ] **Phase 3:** large documents through retrieval (mcpgw `docs_search`)

### Done after v1: the meeting brief and the full-context policy ✅

- [x] Meeting brief: optional at creation, editable any time, on the meeting clock, never trimmed
  ([ADR 0015](adr/0015-meeting-brief-and-full-context-policy.md))
- [x] Over budget: keep the intro, the first question, the latest posted wrap-up and the newest turns; drop the
  turns before the wrap-up first
- [x] Copy a posted wrap-up into the brief; the seat card turns amber at 80% and shows "Trimming older turns"; the
  message box suggests minutes

### Upkeep and UI, 2026-11-07

- [x] **Nightly backup:** a `pg_dump` CronJob in the chart at 03:30, the newest 14 kept in their own volume, which
  Helm and Argo CD never delete. Same disk as the database, so it covers mistakes, not a lost disk. `scripts/backup.sh`
  lists, takes, fetches and restores them
- [x] **Backup on the cluster:** deployed as `63b39e9`; the first one taken with `scripts/backup.sh now`, fetched back
  and restored into a scratch database with the live counts
- [x] **By the user:** no off-machine copy (decided 2026-11-08). The nightly backups on the cluster are enough;
  `scripts/backup.sh fetch` still copies one off if that changes
- [x] **The brief in the header:** Brief (or Add brief) left of Export, pinned under the header while shown
- [x] **A ⋯ menu on each meeting in the list,** with Delete meeting… asked again inside the menu
- [x] **Both side panels fold** into narrow rails; the browser remembers it
- [x] **By the user:** an `ARCH_INFRA_TOKEN` repo secret, so CI bumps image tags in arch-infra itself (set 2026-11-08,
  the same token as the other home apps; a deploy key tried first was removed to match them)

### Web tools as a room rule, 2026-11-08 ([ADR 0017](adr/0017-web-tools-room-rule.md))

- [x] **Removed the chair's "Search the web":** the button, the route and the engine action. Old Sources messages
  still show, and seats still read them
- [x] **A web tools room rule** (Off, Can search, Must search first) in Room rules. Each seat follows it unless it has
  its own setting, as with answer length; changes add an event line
- [x] **Migration:** seats that had web tools off now follow the room rule, which starts as off; seats that had them
  on keep that as their own. Checked on a copy of the live data
- [x] **Deployed** as `539daf2`: the migration ran at API start, with the same counts as on the copy

### Settings, 2026-11-08 ([ADR 0018](adr/0018-settings-profile-and-appearance.md))

- [x] **A Settings area after homework's:** its own sidebar (Back to meetings, Profile, Appearance), opened from the
  profile menu, which now holds Settings and Sign out
- [x] **Profile:** name and sign-in email (`PATCH /api/me`), and the password, moved here from its dialog
- [x] **Appearance, per browser:** homework's palettes (Default, Solarized, Nord, Dracula, High contrast), Light /
  Dark / System, and a size from 75 to 150%. Applied before the first paint, so dark mode doesn't flash white
- [x] **Deployed** as `539daf2`

### Next, in order

1. ~~**Attachments phase 2**~~: done 2026-11-08, in the browser instead of a server worker
   ([ADR 0019](adr/0019-pdf-and-word-files-read-in-the-browser.md))
2. **Tuning from real meetings,** with mcpgw's M10: drafts and release candidates in the web guidance, and whether
   seats still use all 6 calls. *First pass 2026-11-09 (progress.md): the budget and calls left told to seats, drafts
   and previews in the guidance; DeepSeek V4 Pro's thinking time: a thinking effort of Off, on the user's go.*
3. ~~**One meeting feature from "Later": a poll**~~: done 2026-11-08 ([ADR 0020](adr/0020-polls.md))
