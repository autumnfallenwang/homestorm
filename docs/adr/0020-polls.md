# 0020: Polls

- **Status:** accepted, built 2026-11-08
- **Date:** 2026-11-08

## Context

- **Where does the room stand?** After a long discussion the chair reads four essays to find out. The full meeting
  test on the cluster (2026-11-08) took four rounds of 1,500–3,800 characters per seat to reach the same question:
  which drives, and how sure is each seat.
- **The smallest feature on the "Later" list** (plan.md): each seat's position and confidence.
- **Seats must still read it later.** Whatever a seat answers enters the record, and the others see it in their next
  turns, as with every message.

## Decision

**A poll is a round where every active seat answers one question privately, in one line, shown as a table.**

- **Asking:** Poll in the meeting header. A question, and up to 6 options, or none for answers in a seat's own words.
  `POST /api/meetings/:id/poll` posts the question as the chair's message (with "Options: A / B" under it), then runs
  a `poll` round: every unmuted seat at once, blind, like "Everyone · blind".
- **Answering:** the floor note asks for exactly one line,
  `Choice: <one of: A | B> · Confidence: <0–100>% · Why: <one short sentence>`. No web tools: a poll asks what a
  seat thinks now, after the discussion. No length reminder: the line is the length.
- **Reading it:** `parsePollAnswer` (`packages/shared/src/poll.ts`) reads the line leniently: bold, other separators,
  parts on their own lines, a choice in different case or punctuation. A choice that matches no option is kept as
  written and counted as Other. A line with no choice isn't tallied; that message shows in full below the table.
- **The table:** a tally bar per option, then one row per seat: its choice, how sure it is, why. A failed answer
  shows as its message, where Retry is.
- **Polling again:** "Poll again" asks exactly the same question; "Change and poll again…" opens it in the dialog. A
  seat's row then says how it moved since the same poll last time: "+15 pts", "was Neither".
- **Stored:** the round keeps `poll` (question and options; `rounds.poll`, migration 0008). The answers are ordinary
  seat messages, so later views, wrap-ups and the export read them as they read anything else.
- **Export:** the question, the tally, and a table; only an answer that failed or couldn't be read is listed on its
  own.

## Alternatives considered

- **A forced tool call (`answer_poll`) for structured answers.** Rejected: forcing a tool interacts with thinking
  differently on each provider (homestorm's must-search already had to name the tool for Claude), and the answer would
  be tool arguments, not a message seats can read in later turns.
- **Free answers, summarised into a table by another model.** Rejected: a second call per poll, slower, and the
  summary could misread a seat.
- **JSON in the answer.** Rejected: harder for models to keep valid, and unreadable as a message.
- **Fixed confidence words (low / medium / high).** Rejected for a percentage: it shows small moves between polls,
  and every model gives one readily.

## Consequences

- **A seat can ignore the format.** Its answer is then shown whole, not lost, and not tallied.
- **A poll is a round:** it waits for a running round, Stop and Retry work as for any other, and it counts in the
  meeting's clock and tokens.
- **Options are matched by words, not meaning:** "4x16TB" matches "4 × 16 TB", but a paraphrase counts as Other.
