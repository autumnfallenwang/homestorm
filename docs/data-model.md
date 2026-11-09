# Data Model

The tables behind a meeting, and how the visibility rule is stored. The schema is
`apps/api/src/db/schema.ts`; the shared types are `packages/shared/src/domain.ts`.

---

## Tables

| Table | One row per | Key fields |
|---|---|---|
| `meetings` | meeting | `title`; room rules `answer_length` (concise / detailed) and `web_access` (off / on / must); `clock` |
| `seats` | seat in a meeting | `model` (exact llmgw ID), `owned_by`, `display_name`, `persona`, `position`, `muted`, `reasoning_effort`, `answer_length` (null: follow the room rule), `context_budget` (small / standard / large / full; null is standard), `web_access` (off / on / must; null: follow the room rule), `removed_at` |
| `rounds` | time the chair gives the floor | `number`, `mode` (blind / in_turn / single / wrap_up / poll), `seat_ids` in answering order, `prompt_message_id`, `reply_to_id`, `wrap_kind`, `poll` (question and options, ADR 0020), `status` |
| `messages` | transcript entry | `author_kind` (chair / seat / event / brief / sources), `seat_id`, `round_id`, `content`, `status`, `visible_seq`, `cutoff_seq`, `tool_calls` (what a seat searched and read), tracing fields |
| `attachments` | image or text file on a chair message or a brief version | `message_id`, `position`, `kind` (image / text), `name`, `mime`, `size_bytes`, `width`, `height`, `text_chars`, `data` (bytea) ([ADR 0016](adr/0016-attachments-images-and-text-files.md)) |
| `users`, `sessions`, `accounts`, `verifications` | Better Auth | the one admin login ([ADR 0011](adr/0011-one-admin-login.md)) |

- **Removed seats are kept** (`removed_at`), so their earlier messages still have a name in every view. They leave
  the roster and are never called again.
- **Seat names are unique within a meeting,** ignoring case and counting removed seats, because every view tags
  messages by name. Several seats may use the same model: the default names are "Claude Opus 5.5", then
  "Claude Opus 5.5 (2)". The API refuses a taken name with 409 (`seatNameClash` in `packages/shared/src/names.ts`).
- **The meeting brief** ([ADR 0015](adr/0015-meeting-brief-and-full-context-policy.md)) is stored as messages with
  `author_kind = 'brief'`, one per saved version, each with the next clock value. A turn's intro gets the latest
  version with `visible_seq <= cutoff_seq` (`briefAt` in `packages/shared`), so blind rounds share one version and
  Retry repeats it. A version saved after the discussion started leaves a one-line note at its place in later views.
  At most 12,000 characters.
- **Attachments never change once saved.** A new brief version copies the files it keeps, so each version is whole
  and Retry rebuilds the same view. Deleting a meeting deletes its files.
- **Search results** the chair posted are messages with `author_kind = 'sources'`, on the clock, so a blind round shares
  them or doesn't by its cutoff, like any message ([ADR 0014](adr/0014-tools-through-mcpgw.md)). The chair's search was
  removed on 2026-11-08 ([ADR 0017](adr/0017-web-tools-room-rule.md)), so only older meetings have them.
- **Event lines** ("You muted Claude Sonnet 5.5 for rounds") are messages with `author_kind = 'event'`. Seats never
  see them. Room-rule changes ("You set answers to Detailed", "You set web tools to Can search") and posting a wrap-up ("You posted Scribe's decision")
  add one too, so the transcript and the export show when they happened.
- **Tracing fields** on seat messages: `model`, `owned_by`, `reasoning_effort`, `usage` (with an `estimated` flag),
  `cost_usd`, `llmgw_req_id`, `request_id` (homestorm's, sent as `X-Request-Id`), `trimmed_count`, `view_tokens` (the
  view's estimated size when the turn started), `started_at`,
  `finished_at` ([ADR 0009](adr/0009-first-version-scope.md)).

## Message statuses

| Status | Meaning | Seen by seats? |
|---|---|---|
| `queued` | waiting for its turn in an in-turn round ("Next") | no |
| `streaming` | the seat is answering | no |
| `done` | finished, part of the shared record | **yes** |
| `stopped` | stopped by the chair or an API restart; the partial text is kept | no, until the chair keeps it (then `done`, `stopped_early = true`) |
| `error` | llmgw failed, or the seat couldn't take the floor (rate limited, out of allowance) | no |
| `skipped` | the chair skipped the turn | no |

Wrap-up output starts with `hidden_from_seats = true`: the chair sees it, seats don't. **Post** clears it and gives it
the next clock value, so it enters the record at the moment it's posted, like a kept answer.

## The visibility rule, as a logical clock

The rule ([ADR 0005](adr/0005-chair-controlled-meetings.md)): **a seat sees every message that was finished before
its turn started.** It's stored as a per-meeting counter instead of timestamps, so ties and clock skew can't matter:

- `meetings.clock` goes up by one each time a message **enters the shared record**: a chair message when it's posted,
  a seat answer when it finishes, a stopped answer when the chair keeps it. The new value is saved on the message as
  `visible_seq`.
- When a seat's turn starts, the current clock is saved on its message as `cutoff_seq`.
- `buildView` shows the seat every message with `visible_seq <= cutoff_seq`.

So:

- **Blind round:** every seat's turn starts at the same clock value, so none sees another's answer.
- **In turn:** each turn starts after the previous answer bumped the clock, so it sees the earlier answers.
- **Retry:** reuses the message's original `cutoff_seq`, so the seat gets the same view again.

**Only adding at the end** ([ADR 0004](adr/0004-per-seat-view-of-shared-transcript.md)): views are ordered by
`visible_seq`, not by creation. A message that becomes visible later always has a higher `visible_seq` than
everything a seat saw before. So it lands at the end of that seat's next view, and the start of the view stays the
same between turns, which lets prompt caching work. The transcript in the UI is still shown in creation order
(`seq`).

## Migrations

- `apps/api/drizzle/` holds the SQL migrations, generated with
  `pnpm exec drizzle-kit generate --name <name> < /dev/null`. Closing stdin keeps drizzle-kit's rename prompt from
  looping (a homework lesson).
- **The API applies them itself at boot**, before it opens its port, and waits for Postgres if it's still starting
  (`apps/api/src/db/migrate.ts`). There's only ever one API process, so two migrations never race.
- On every boot after the first, Postgres answers the migrator with "already exists, skipping" NOTICEs. They're
  logged as `db.notice` at debug level (`apps/api/src/db/index.ts`), not printed.
- **Why not a Helm hook, like the sibling apps:** on homestorm's first install, the pre-install hook ran before the
  Postgres StatefulSet existed and waited forever. The chart's migrate Job is kept but off.

