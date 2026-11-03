# Progress

A dated log of what was done and decided, newest first. The plan and milestone status live in [plan.md](plan.md).

---

## 2026-11-02

- **M8 done: homestorm is live** at http://homestorm.arch.internal (API http://homestorm-api.arch.internal).
  - Dockerfiles, the Helm chart (api with Recreate, web, Postgres StatefulSet), CI and the Argo CD Application,
    adapted from homework. The api reaches llmgw in-cluster at `llmgw.llmgw.svc.cluster.local`.
  - The production images ran a real meeting locally before shipping. CI passed; the GHCR images pull anonymously,
    so the cluster needs no pull secret.
  - **First sync found a chart bug:** the Helm pre-install migrate hook ran before the Postgres StatefulSet existed
    and waited forever. Fix: the API applies its migrations at boot, retrying while Postgres starts; the hook is off.
    The stuck sync carried the old parameters, so it was ended (operation marked Terminating) and a fresh sync ran.
  - Checked on the cluster: `/health` OK; unauthenticated calls 401; setup page; sign-up and the session cookie
    across the two hosts; a blind round streamed through Traefik (DeepSeek V4 Pro showed "Thinking…"); in Loki,
    `db.migrated`, `server.start` and three `turn.done` lines sharing the action's `req_id`, and no non-JSON lines.
  - The admin made for that check was deleted, so `/setup` is open for the user. The meeting stays.
  - The Secret `homestorm-secrets` was created by the user (auto mode doesn't allow Secret writes); values are in the
    gitignored `private/cluster-secrets.env`.
  - Argo shows the Postgres StatefulSet as OutOfSync, as it does for homework's: the cluster-wide StatefulSet diff.
  - Open: `ARCH_INFRA_TOKEN` isn't set on this repo, so CI skips the arch-infra tag bump; tags were bumped by hand.
- DNS: `homestorm.arch.internal` and `homestorm-api.arch.internal` point at Traefik (added by the user).
- **M7 done: wrap up, export, login.** Wrap-up (minutes, decision, open questions; posted or kept from the seats) and
  the Markdown export were built with M5/M6 and checked in the browser run. Login gained Change password, covered by
  an integration test.
- **M6 done: web UI.**
  - **Three panes, as in the mockup:**
    - meetings list (new, search, grouped by day, Live and Minutes badges, the chair's menu);
    - the meeting (header with status, tokens, Export, Wrap up; chair bubbles on the right with where each went;
      seat messages with source tag, Markdown and the mono meta line; round boxes with progress; event lines;
      problems in place with Retry / Skip / Keep partial / Mute until reset);
    - the seats panel (status in words, allowance bar, Ask / Mute / ⋯, room rules).
  - Message box: send-to selector, @mentions that become structured targets, blind / in-turn toggle for several
    seats, Stop all, and a status line while a round runs.
  - Dialogs: new meeting, add seat (models grouped by source with allowance, "Not on your plan" crossed out),
    edit seat, reply-to picker, wrap up, delete. Live state comes from the stream through a tested reducer.
  - **Driven in a real browser** (Playwright, localhost, real llmgw): a blind round streamed from all three seats;
    reply-to with a note; an @mention; Stop and Keep partial; mute; minutes written by GPT and posted; Markdown
    export; phone width.
  - **Bug found and fixed in that run:** the openai SDK ends a stream quietly when it's aborted, so Stop saved a
    cut-off answer as done. The client and the engine now treat an aborted stream as stopped; a regression test
    covers it.
  - Accessibility: the @mention list is a proper combobox, labels on every control, states in words.
- **M5 done: meeting engine.**
  - The engine runs rounds in the API process: blind rounds start every seat at the same clock value; in-turn rounds
    start each seat after the previous answer entered the record. One running round per meeting; comments any time.
  - Stop keeps the partial text hidden until the chair keeps it. Retry reuses the message's cutoff, so the seat gets
    the same view and the same model. Seats out of allowance, or not on the plan, are refused before any llmgw call.
    Empty answers and llmgw errors (429, 404, context too long) stay on the message.
  - Live stream per meeting: a snapshot on connect, then message, delta (with offsets), round, seat and meeting
    events, with a heartbeat. A restart turns answers left streaming into `stopped`.
  - Routes for meetings, seats (mute, move, remove, with event lines), the action API, wrap-up, stop, retry, keep,
    skip, allowance, models and Markdown export.
  - 48 API tests (13 engine and 7 route integration tests, with a scripted llmgw).
  - **Real run on localhost:** "cache at the edge or in the API?" Blind round, all three answered independently
    (3 s). Then an in-turn round where each built on the others by name (8 s). 360 deltas reached the live stream.
    Turn log lines carry the action's `req_id`, so one Loki query shows the chair's action and every turn it caused.
  - Fixed: the meetings list counted 0 seats. Drizzle rendered `${meetings.id}` unqualified inside the subqueries.
- **M4 done: scaffold.**
  - `apps/web`: Next.js 15, Tailwind 4, shadcn components, Geist fonts, the theme with source colors. Builds.
  - API skeleton: config, pino logs in the house shape, Better Auth with one admin (sign-up closes after the first
    account), `reset-password` script.
  - llmgw client on the `openai` package with `maxRetries: 0`, so failures stay visible. The live smoke test
    streamed from Claude Haiku 5.5, GPT-5.6 Luna and DeepSeek Flash, and got `model_not_found` for an unknown model.
  - Found: DeepSeek Flash can spend a tiny output cap on reasoning and return no text. homestorm will show that as
    an "empty answer" problem instead of a blank message.
  - Integration tests use a separate `homestorm_test` database, created and migrated automatically.
- **M3 done: data model and per-seat view.**
  - Workspace skeleton: pnpm + Turborepo, `packages/shared` (domain types, the action schema, display names) and
    `apps/api`.
  - Drizzle schema and first migration: meetings, seats, rounds, messages, plus Better Auth's tables.
  - The visibility rule is stored as a per-meeting **logical clock**: `visible_seq` when a message enters the record,
    `cutoff_seq` when a turn starts. Views are ordered by `visible_seq`, so they only ever grow at the end
    ([data-model.md](data-model.md)).
  - `buildView`, the intro and floor-note templates, and trimming, with 21 unit tests (45 across the workspace).
  - Local Postgres runs on `127.0.0.1:5433` (`scripts/db-start.sh`).
- **M2 done: decisions recorded.**
  - D1 v1 scope: [ADR 0009](adr/0009-first-version-scope.md).
  - D2 server-run rounds, one SSE stream per meeting: [ADR 0010](adr/0010-rounds-run-on-the-server.md).
  - D3 one admin login: [ADR 0011](adr/0011-one-admin-login.md).
  - D4 trimming, answer length, thinking effort: [ADR 0012](adr/0012-long-meetings-answer-length-effort.md).
  - D5 fixed templates: [ADR 0013](adr/0013-intro-and-floor-note-templates.md).
  - D6 closed: how llmgw signs in is llmgw's business.
  - Dev runs on localhost until M8.
- **llmgw gap found:** its streams carry no `usage`, `cost_usd` or `req_id`, and it ignores an incoming
  `X-Request-Id`. homestorm reads those fields if they ever appear and saves a marked estimate meanwhile
  (ADR 0009). A small llmgw follow-up would close it; llmgw itself is out of scope here.
- **Repo created and made public:** `autumnfallenwang/homestorm`, with README, plan, this log, ADRs 0001–0008 and the
  two design docs. It's plain Markdown docs only: no devkit scaffold, hooks or project skills. Account-specific details
  (plans, balances, allowance numbers, how llmgw signs in, private links) live in the gitignored `private/notes.md`.
- **Name decided:** homestorm, as in brainstorming together ([ADR 0008](adr/0008-name-homestorm.md)).
- **UI mockup approved:** a three-pane meeting UI plus a controls-and-states board
  ([ADR 0007](adr/0007-three-pane-meeting-ui.md)).
- **Meeting control designed** ([meeting-control-design.md](meeting-control-design.md)):
  - the user is chair and participant;
  - seats speak only when given the floor;
  - blind and in-turn rounds;
  - a single visibility rule;
  - control lives in server code behind one action API; etiquette lives in the prompts
    ([ADR 0005](adr/0005-chair-controlled-meetings.md), [ADR 0006](adr/0006-control-in-code-etiquette-in-prompts.md)).
- **Chat-wrapper research done** ([chat-wrapper-research.md](chat-wrapper-research.md)):
  - build our own instead of forking ([ADR 0003](adr/0003-build-our-own-app.md));
  - a per-seat view of one shared transcript, based on LobeHub's group-chat design
    ([ADR 0004](adr/0004-per-seat-view-of-shared-transcript.md)).
- **llmgw 0.5.0 verified in production** (commit `e36e08c`):
  - models not on the plan report `unavailable` in `/v1/limits`;
  - usage log lines share `req_id` with the request line;
  - provider names in logs match the API;
  - `GET /` returns the version and commit.
  - One correction: `req_id` isn't a Loki label. Query `{namespace="llmgw"} | json | req_id="<id>"`.
- **DeepSeek wired into llmgw:** `deepseek-v4-pro` and `deepseek-flash` work with plain and `deepseek/…` names, normal
  and streaming. `deepseek-v4-flash` is a 404 at the gateway (good: exact names only).
- **llmgw `/v1/limits` checked** for all three paid sources: weekly windows for Claude (Fable models have their own),
  a monthly window for GPT, and a prepaid balance for DeepSeek.
- **GPT models tested:**
  - **working:** `gpt-6-luna`, `gpt-5.6-terra`, `gpt-5.6-luna`;
  - catalog models that aren't on the current plan return 404.
- **llmgw behavior confirmed from its source:**
  - exact model match only, no fallback to other models;
  - the one exception is the image fallback, when a text-only model receives an image.

## 2026-11-01

- **Idea:** one room where Claude, GPT and Gemini answer the same question with the user as chair, instead of
  copy-pasting between web apps. Existing open-source options surveyed; none does chair-controlled meetings well.
- **llmgw found** at `http://llmgw.arch.internal`. All seven Claude 5.x models work, normal and streaming
  (`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5`, `claude-opus-5`,
  `claude-sonnet-5`).
