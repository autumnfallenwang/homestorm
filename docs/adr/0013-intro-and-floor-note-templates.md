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
    - the answer-length rule.
  - **Optional persona:** the seat's own text, appended at the end of the intro.
  - **Floor notes:** one per way of being called, added at the end of the last `user` message as a line starting
    `[Floor]`:
    - asked directly;
    - blind round;
    - in turn, "You are 2nd of 3";
    - reply to a message, quoting its first 300 characters;
    - wrap up as minutes, a decision, or open questions.
- **No user-editable templates in v1.** Only the persona is per seat.
- **Unit tests pin the wording's key parts:** the roster, the disagree-with-the-chair rule, no name prefix, and the
  floor notes.

## Alternatives considered

- **Templates stored in the database and editable in the UI.** Later, if the fixed wording proves wrong often.
- **One generic floor note for every call.** Rejected: blind and in-turn rounds need different instructions to work.

## Consequences

- Changing the wording is a code change and a deploy.
- Adding or removing a seat changes the roster in every intro, which restarts prompt caching for all seats once.
