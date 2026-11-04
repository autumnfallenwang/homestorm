# Progress

A dated log of what was done and decided, newest first. The plan and milestone status live in [plan.md](plan.md).

---

## 2026-11-04

- **An exhausted allowance no longer blocks a seat** ([ADR 0002](adr/0002-llm-access-through-llmgw.md), the user's
  call). Claude seats were refused because llmgw said `exhausted` with 10% of the week left: it reads Anthropic's
  near-limit severity as exhausted, while Claude still answered. Now only a model that isn't on the plan is refused;
  the card says "Allowance low" or "Out of allowance" in amber or red; a real provider refusal (a 429 about quota,
  balance or a usage limit) shows on the message as "Out of allowance". Checked: a Claude Haiku seat at 9% left
  answered, with its real 483-token prompt count.
- **llmgw 0.6.0 picked up** (it fixed what homestorm had reported).
  - **Image support:** the image hint reads `/v1/models` `input` instead of homestorm's own list.
  - **Real token counts:** streamed answers now carry usage, so messages save real counts. The context meter shows
    llmgw's count ("Context 941 of 120k", without ≈) and keeps the estimate in its tooltip; amber and trimming still
    follow the estimate.
  - **A Claude workaround:** llmgw reports only Claude's uncached prompt as `prompt_tokens`, so homestorm uses
    `total − completion` when that's larger. Found by checking a cached 7.2k prompt (reported as 4).
  - **Checked:** 124 tests; in the browser, the V4 Pro card showed llmgw's 941 against our ≈1,630 estimate.
  - **Seen on the way:** llmgw reports Claude `exhausted` with 10% of the week left (resets 2026-11-06), so Claude
    seats are refused until then.
- **Attachments, phase 1** ([ADR 0016](adr/0016-attachments-images-and-text-files.md)). Images and text files on
  the chair's messages and in the meeting brief.
  - **llmgw checked first:**
    - images work for Claude, GPT and DeepSeek Flash, streamed or not, several per message;
    - DeepSeek V4 Pro gets llmgw's text description instead;
    - a `file` part is refused, so text files are inlined by homestorm.
  - **Built:**
    - paperclip, drag and drop and paste, with browser-side resizing (a 4000×2250 photo became 2048×1152 WebP);
    - server checks with `image-size`;
    - an `attachments` table (migration `0005_attachments`);
    - image parts and inline `<file>` blocks in views, the brief's images pinned at the top, image tokens in budgets;
    - thumbnails, a full-size viewer, the export, and a hint naming seats that can't see images.
  - **Found and fixed while testing:**
    - **V4 Pro mixed up images from different messages.** llmgw's fallback writes one description per user message,
      at its start, and homestorm had merged the brief's images with a question's. Now each image-carrying message
      stands alone, with its names in a label after the images; V4 Pro then answered right.
    - **Stop all could miss a turn still setting up** (no abort controller yet). The turn now checks for a stop as
      soon as it registers. A test that waits on this had started timing out.
  - **Checked:**
    - 123 tests;
    - in the browser on localhost, with Claude Haiku, GPT-5.6 Luna and DeepSeek V4 Pro:
      - every seat read both images and the code word from a text file;
      - all three read the brief's image and spec;
      - the viewer, the brief editor and the export worked.
  - **For llmgw** (listed in ADR 0016): describe images one by one in place, separate a message's text parts, cache
    descriptions, and say which models take images.
- **Meeting brief and a new full-context policy** ([ADR 0015](adr/0015-meeting-brief-and-full-context-policy.md)).
  - **The brief:** standing context the chair writes (optional in New meeting, editable from a card pinned at the
    top). Every seat gets it in its intro after the title, and it's never trimmed. It follows the meeting clock
    (`author_kind = 'brief'`, one message per version, migration `0004_brief_author_kind`), so a blind round shares
    one version and Retry repeats it. A change after the discussion started leaves "(The Chair updated the meeting
    brief…)" in later views; the transcript shows "You updated the meeting brief · show this version"; the export
    puts the current brief at the top. Capped at 12,000 characters.
  - **Over budget:** the intro (with the brief), the first question, the latest posted wrap-up and the newest turns
    stay; turns before the wrap-up go first ("…the summary below covers them"), then the oldest after it.
  - **The chair's summaries:** "Copy into the brief" on a posted wrap-up opens the brief editor with it appended.
    The context bar turns amber at 80% and says "Trimming older turns" once a turn was trimmed; the message box then
    suggests minutes.
  - **Context % on the seat card:** "Context ≈6.4k of 120k · 5%", with the share of the model's window in a tooltip.
    It's our own estimate: llmgw 0.5.0 returns `usage` for non-streamed calls only (checked again today), and
    homestorm streams.
  - **Checked:** view, engine (Retry keeps the old brief), route, export and web tests (114 in all). In the browser
    on localhost, a throwaway meeting with a DeepSeek Flash seat answered "Pixel" from the brief, then "Nova" after
    the brief changed, noting the change. Found and fixed there: the export said "set" for every brief version.
- **Tools planned, through mcpgw** ([ADR 0014](adr/0014-tools-through-mcpgw.md), M9 in [plan.md](plan.md)). Models
  behind llmgw can't look anything up. Tools will come from a new home-cluster gateway, **mcpgw** (design at
  `~/agentic/mcpgw/docs/design.md`), and homestorm will run the tool loop: the date in the intro, then chair search,
  then seat tools. Waits for mcpgw.
- **Tool loop tried with a fake MCP server** against the real llmgw. Claude Haiku 5.5, GPT-5.6 Luna and DeepSeek
  Flash each chose to search for a price, wrote their own query and quoted the fake result. None searched for a
  question they already knew. They trusted the fake source differently (Claude doubted it, GPT didn't), so sources
  must stay visible. Scripts kept at `~/agentic/mcpgw/dev/tool-loop-demo/`.
- **GPT plan changed** (details in `private/notes.md`): all seven GPT models are available now. homestorm picked it
  up from llmgw with no change.

## 2026-11-03

- **Context budget per seat:** Small (32k), Standard (120k, the default), Large (half the window) or Full (the whole
  window minus room for the answer), in the Add seat and Edit seat dialogs, each showing its size for that model
  and the model's window ([ADR 0012](adr/0012-long-meetings-answer-length-effort.md)). The seat card shows "Context
  ≈6.4k of 120k" with a bar. Large and Full warn that a long meeting re-sends that much every turn. Migration
  `0003_seat_context_budget` adds `seats.context_budget` and `messages.view_tokens`; the budget math moved to
  `packages/shared/src/budget.ts` so the web shows the API's numbers. What to do when a meeting outgrows its
  budget (only trimming today) is still open.
- **Removed the "New questions go to" room rule.** It only chose where the message box started; the server never
  read it, and having it next to the message box's own selector confused people. Now the message box starts on
  Everyone · blind and keeps your pick after sending; the @mention toggle and the Reply to… picker also start on
  Blind (the picker started on In turn). Migration `0002_drop_default_mode` drops `meetings.default_mode`; nothing
  else read it. Room rules now holds only answer length and the two fixed rules.
- **A seat can have its own answer length:** Room rule (the default), Concise, always, or Detailed, always, in the
  Add seat and Edit seat dialogs. The chair's message still wins for one turn, then the seat's setting, then the room
  rule ([ADR 0012](adr/0012-long-meetings-answer-length-effort.md)). The intro line and the output cap follow it; the
  seat card shows "Detailed answers"; setting it adds an event line; the export lists it. Migration
  `0001_seat_answer_length` adds a nullable `seats.answer_length`. The seat menu's "Edit name and persona" is now
  "Edit seat…". Covered by unit, view, engine and route tests; checked in the browser on localhost.
- **Live test on localhost:** a 5-seat meeting run step by step, with the chair deciding each question from the
  answers. The seats were Claude Opus 5.5, GPT-6 Luna, DeepSeek V4 Pro, "The Skeptic" (GPT-6 Luna with a persona)
  and "Scribe" (DeepSeek Flash, muted). The topic: one shared Postgres for the cluster's apps, or one per app.
  - **Rounds:**
    - a blind first round (2–2);
    - an in-turn reaction round;
    - a reply to one message with two seats answering blind;
    - a comment with checked cluster facts (one node, local-path, five databases, no backup jobs);
    - @mentions with a new constraint;
    - a Detailed round with Stop, Keep partial, Skip and Retry;
    - blind final positions (unanimous: back up now, consolidate later);
    - a decision written by Scribe, then the export.
  - **Everything matched the design:** cutoffs in blind and in-turn rounds, comments, targets, Retry with the saved
    cutoff and its 409 once others have spoken, a muted seat writing the wrap-up, and the persona.
  - **Found and fixed:**
    - the output cap left no room for thinking (below);
    - the floor note said "All 2 participants": now "Both participants";
    - a kept partial reached other seats unmarked: it now ends with "(The Chair stopped this answer here.)"
      ([ADR 0013](adr/0013-intro-and-floor-note-templates.md));
    - room-rule changes left no event line: they now add "You set answers to Detailed";
    - the export dropped skipped turns, didn't name who a reply went to, and cut personas mid-word.
  - **Wrap-ups are now held back for review.** Scribe's decision had the right answer but several wrong details
    (it counted itself as a participant and put The Skeptic on the wrong option). A wrap-up now starts "not
    posted", with **Post to the meeting** under it; posting adds an event line. "Post it right away" in the dialog
    skips the review.
- **Fix: DeepSeek V4 Pro returned an empty answer** in the live test's blind round ("empty_answer" after 46 s).
  llmgw's usage line showed exactly 2,048 output tokens: the Concise cap. DeepSeek counts thinking inside
  `max_tokens`, so it spent the whole cap thinking.
  - **Checked where the fault was,** with the same view sent straight to DeepSeek and through llmgw: both work.
    DeepSeek's thinking length varies a lot on the same question (35 to 1,116 tokens at `low`, up to 2,175 at
    `high`). llmgw turns `low` into `high` for this model and doesn't forward the level (its model data lists only
    `high` and `max`); that's noted for llmgw, not changed.
  - **Fix in homestorm:** `max_tokens` is now the answer room plus thinking room by effort (low 8,192, medium 16,384,
    high 32,768), within the model's own limit. Concise at low effort is 10,240
    ([ADR 0012](adr/0012-long-meetings-answer-length-effort.md)). The "empty answer" problem now names the limit.
  - Covered by unit tests (`maxOutputTokens`) and an engine test of what each seat is sent.
- **Fix: two seats could share a name.** Several seats on one model are fine (each is its own participant with its
  own view, persona and effort), but the Add seat dialog pre-filled the plain model name, which skipped the API's
  "(2)" suffix. Both twins were then called "Claude Opus 5.5": each saw the other's answers under its own name, and
  its participant list marked both as "(you)".
  - Seat names are now unique within a meeting, ignoring case and counting removed seats (their messages keep their
    names). The dialog suggests the next free name; adding or renaming to a taken name is refused (409), with the
    reason shown under the name field.
  - Covered by unit tests (`uniqueSeatName`, `seatNameClash`) and an integration test; checked in the browser.
- **Fix: Postgres notices broke the JSON log contract.** postgres-js prints NOTICEs with `console.log` as multi-line
  objects. The boot migration gets two on every restart after the first ("schema drizzle already exists, skipping"),
  so the cluster logs had plain-text lines. Notices now go to the logger as `db.notice` at debug level; an
  integration test checks that nothing reaches `console.log`.

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
