# 0013: Fixed intro and floor-note templates in code

- **Status:** accepted
- **Date:** 2026-11-02

## Context

Each seat's view starts with an intro (identity, roster, etiquette) and ends with a floor note (what it's asked to do
now): ADRs [0004](0004-per-seat-view-of-shared-transcript.md) and
[0006](0006-control-in-code-etiquette-in-prompts.md). The wording decides how well seats behave (D5 in
[plan.md](../plan.md)).

## Decision

- **The templates live in code:** `apps/api/src/engine/prompts.ts`, drafted by Claude and open for the user to
  review.
  - **Intro:**
    - who the seat is (display name and model);
    - the roster (the chair and every seat);
    - how the meeting works;
    - the etiquette rules from [meeting-control-design.md](../meeting-control-design.md) §3;
    - the answer-length rule;
    - the meeting brief, when there is one, after the title (added 2026-11-04,
      [ADR 0015](0015-meeting-brief-and-full-context-policy.md)).
  - **Optional persona:** the seat's own text, appended at the end of the intro.
  - **Floor notes:** one per way of being called, added at the end of the last `user` message as a line starting
    `[Floor]`:
    - asked directly;
    - blind round;
    - in turn, "You are 2nd of 3";
    - reply to a message, quoting its first 300 characters;
    - wrap up as minutes, a decision, or open questions.
  - **Brief notes** (added 2026-11-04): where a brief version entered the record after the discussion started,
    "(The Chair updated the meeting brief. Your instructions have the current version.)", or "(The Chair cleared the
    meeting brief.)". Trim lines say "(N older messages trimmed; the summary below covers them.)" right before the
    latest posted wrap-up.
  - **Cut-off note** (added 2026-11-03): an answer the chair stopped and kept ends with "(The Chair stopped this
    answer here.)", in every view including its author's, so no seat reads the cut-off text as a finished answer.
- **No user-editable templates in v1.** Only the persona is per seat.
- **Unit tests pin the wording's key parts:** the roster, the disagree-with-the-chair rule, no name prefix, and the
  floor notes.

## Alternatives considered

- **Templates stored in the database and editable in the UI.** Later, if the fixed wording proves wrong often.
- **One generic floor note for every call.** Rejected: blind and in-turn rounds need different instructions to work.

## Consequences

- Changing the wording is a code change and a deploy.
- Adding or removing a seat changes the roster in every intro, which restarts prompt caching for all seats once.
