# homestorm

Brainstorm with several AI models at once. homestorm is a home app where Claude, GPT and DeepSeek sit around one
table and answer the same question. **You are the chair:** a model speaks only when you give it the floor, you decide
who answers whom, and you can join the discussion yourself.

It replaces copy-pasting the same question between the Claude, ChatGPT and Gemini web apps.

**Status:** v1 is live at http://homestorm.arch.internal. See [the plan](docs/plan.md) and [progress](docs/progress.md).

## How it works, in short

- **Every model call goes through llmgw**, the home LLM gateway. That covers Claude (subscription), GPT (ChatGPT
  subscription) and DeepSeek (prepaid API), plus per-model allowance from `/v1/limits`. The gateway uses the exact model
  you asked for and never falls back to another.
- **One shared transcript, a separate view for each seat.** A model's own messages are `assistant`; everyone else's,
  the chair included, are `user` with a speaker tag.
- **Web tools come through mcpgw,** the home tool gateway. A room rule, which each seat can override, lets seats search
  and read pages themselves, with their sources shown under each answer.
- **The chair runs it:** blind rounds (independent answers), in-turn rounds (discussion), @mentions, replies to a
  specific message, mute, stop and retry, wrap up into minutes.

## Develop locally

Needs Node 22+, pnpm 10 and Docker, plus llmgw at `http://llmgw.llmgw.svc.cluster.local`, which is only reachable from inside
the cluster and from arch, where `/etc/hosts` points that name at its Service IP. So local development happens on arch.

mcpgw is for the deployed app, at `http://mcpgw.mcpgw.svc.cluster.local`. Without `MCPGW_URL` the web features are off and
everything else works, which is how local development runs.

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

## Deploy

homestorm runs on the home k3s cluster like the sibling apps: GHCR images, the Helm chart in `deploy/chart`, and an
Argo CD Application in `arch-infra` (`apps/homestorm.yaml`; review copy in `deploy/arch-infra/`).

- **Web:** http://homestorm.arch.internal. **API:** http://homestorm-api.arch.internal (Traefik on 192.168.1.163).
- **CI** (`.github/workflows/build.yml`): fast tests, then both images tagged with the commit SHA, then the image tags
  bumped in arch-infra. The bump uses the `ARCH_INFRA_TOKEN` repo secret, the same token the other home apps use (a
  fine-grained token that can push to arch-infra). The workflow also takes an `ARCH_INFRA_DEPLOY_KEY` (a deploy key on
  arch-infra) instead. Without either, the job skips with a warning and tags are bumped by hand.
- **Secrets** (`homestorm-secrets`: `DATABASE_URL`, `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`) are created
  out-of-band: `HOMESTORM_SECRET_ENV=private/cluster-secrets.env bash scripts/create-cluster-secret.sh`. The file is
  gitignored; the template is `deploy/cluster-secrets.env.example`.
- **First run:** open the web app and create the admin at once (ADR 0011).
- **Backups:** a CronJob dumps the database every night at 03:30 (New York) into the `homestorm-backup` volume and
  keeps the newest 14. It's the same disk as the database, so copy one elsewhere for a lost disk.
  `scripts/backup.sh list | now | fetch <name> | restore <file>`; logs: `{namespace="homestorm"} | json | event=~"backup.*"`.
- **Your name, email, password and the app's look:** Settings, from the profile menu at the bottom of the meetings
  list.
- **Forgotten password:**
  `kubectl -n homestorm exec deploy/homestorm-api -- node --import tsx src/scripts/reset-password.ts <email>`.
- **Logs:** `{namespace="homestorm"} | json`. One request and every seat turn it started:
  `{namespace="homestorm"} | json | req_id="<id>"`.
- **Local check of the production images:** `docker compose -f deploy/compose.yaml up --build` (web on :52000).

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
| [0014](docs/adr/0014-tools-through-mcpgw.md) | Tools (web search and page reading) come from mcpgw, the tool gateway; homestorm runs the tool loop, and enforces which URLs a seat may read |
| [0015](docs/adr/0015-meeting-brief-and-full-context-policy.md) | A meeting brief every seat always sees; when a view is full, keep the start, the latest posted wrap-up and the newest turns |
| [0016](docs/adr/0016-attachments-images-and-text-files.md) | Images and text files on messages and the brief: thumbnails, a full-size viewer, inline text files, image tokens in budgets |
| [0017](docs/adr/0017-web-tools-room-rule.md) | Web tools are a room rule each seat can override; the chair's "Search the web" is removed |
| [0018](docs/adr/0018-settings-profile-and-appearance.md) | Settings, after homework's: Profile (name, email, password) and Appearance (palette, light or dark, size, per browser) |
| [0019](docs/adr/0019-pdf-and-word-files-read-in-the-browser.md) | PDF and Word files read into text in the browser, in a Web Worker; the server never parses them |
