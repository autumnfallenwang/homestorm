# homestorm

Brainstorm with several AI models at once. homestorm is a home app where Claude, GPT and DeepSeek sit around one
table and answer the same question. **You are the chair:** a model speaks only when you give it the floor, you decide
who answers whom, and you can join the discussion yourself.

It replaces copy-pasting the same question between the Claude, ChatGPT and Gemini web apps.

**Status:** in development, running on localhost. See [the plan](docs/plan.md) and [progress](docs/progress.md).

## How it works, in short

- **Every model call goes through llmgw**, the home LLM gateway. That covers Claude (subscription), GPT (ChatGPT
  subscription) and DeepSeek (prepaid API), plus per-model allowance from `/v1/limits`. The gateway uses the exact model
  you asked for and never falls back to another.
- **One shared transcript, a separate view for each seat.** A model's own messages are `assistant`; everyone else's,
  the chair included, are `user` with a speaker tag.
- **The chair runs it:** blind rounds (independent answers), in-turn rounds (discussion), @mentions, replies to a
  specific message, mute, stop and retry, wrap up into minutes.

## Develop locally

Needs Node 22+, pnpm 10 and Docker, plus llmgw reachable at `http://llmgw.arch.internal`.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
./scripts/db-start.sh                      # Postgres on 127.0.0.1:5433
pnpm --filter @homestorm/api db:migrate
pnpm dev                                   # web on http://localhost:3000, API on :3001
```

On first run, open the web app and create the admin login.

- `pnpm test:fast`: unit tests, no database or llmgw needed.
- `pnpm test`: adds integration tests against `homestorm_test` (created automatically; never the dev database).
- `LLMGW_LIVE=1 pnpm --filter @homestorm/api test:live`: smoke test against the real llmgw (spends a few tokens).
- `pnpm lint`, `pnpm typecheck`.

## Docs

| Doc | What's in it |
|---|---|
| [docs/plan.md](docs/plan.md) | First-version scope, milestones with status, decisions |
| [docs/progress.md](docs/progress.md) | Dated log of what was done and decided |
| [docs/adr/](docs/adr/) | Architecture decision records, one decision each |
| [docs/chat-wrapper-research.md](docs/chat-wrapper-research.md) | The llmgw backend, existing chat apps compared, wrapper features, how each seat's view is built |
| [docs/meeting-control-design.md](docs/meeting-control-design.md) | The chair, the ruleset, real code versus natural language, UI controls |
| [docs/data-model.md](docs/data-model.md) | Tables, message statuses, and the logical clock behind the visibility rule |

**UI mockup:** approved, and described in [meeting-control-design.md](docs/meeting-control-design.md) §5. The mockup
itself is kept outside the repo.

Account-specific details (plans, balances, how llmgw signs in to each provider) stay in a local, gitignored
`private/` folder.

## Decisions so far

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-house-stack.md) | Use the same stack and deployment as the other home apps |
| [0002](docs/adr/0002-llm-access-through-llmgw.md) | Every model call goes through llmgw: exact model, no fallback |
| [0003](docs/adr/0003-build-our-own-app.md) | Build our own app instead of forking an open-source chat app |
| [0004](docs/adr/0004-per-seat-view-of-shared-transcript.md) | Each seat gets its own view of one shared transcript, only ever added to at the end |
| [0005](docs/adr/0005-chair-controlled-meetings.md) | Chair-controlled meetings: seats speak only when given the floor; blind and in-turn rounds |
| [0006](docs/adr/0006-control-in-code-etiquette-in-prompts.md) | Floor control is server code behind one action API; only etiquette is natural language |
| [0007](docs/adr/0007-three-pane-meeting-ui.md) | A three-pane meeting UI, as in the mockup |
| [0008](docs/adr/0008-name-homestorm.md) | The app is called homestorm |
| [0009](docs/adr/0009-first-version-scope.md) | First-version scope; tracing saves what llmgw returns, plus a token estimate |
| [0010](docs/adr/0010-rounds-run-on-the-server.md) | Rounds run on the server; one live stream per meeting; one API instance |
| [0011](docs/adr/0011-one-admin-login.md) | One admin login with Better Auth, created at first-run setup |
| [0012](docs/adr/0012-long-meetings-answer-length-effort.md) | Long meetings trimmed per seat; Concise / Detailed; per-seat thinking effort |
| [0013](docs/adr/0013-intro-and-floor-note-templates.md) | Intro and floor-note templates fixed in code |
