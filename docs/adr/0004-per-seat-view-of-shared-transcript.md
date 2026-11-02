# 0004: Each seat gets its own view of one shared transcript

- **Status:** accepted
- **Date:** 2026-11-02

## Context

LLM APIs only know `system`, `user` and `assistant`. A meeting has many speakers: the chair plus several models.
Each model needs the meeting presented so that it knows who said what, which messages are its own, and what it's being
asked now. Details are in [chat-wrapper-research.md](../chat-wrapper-research.md) §5.

## Decision

There is one stored transcript per meeting. For each turn, `buildView(meeting, seat)` produces that seat's messages:

1. **Own messages stay `assistant`.**
2. **Everyone else becomes `user`, with a speaker tag:** `[Chair]: …`, `[GPT-6 Luna]: …`. Tagging only other
   speakers keeps the model from imitating tags. A leading `[Name]:` in a reply is stripped anyway.
3. **Back-to-back `user` messages are merged into one**, because some providers reject two in a row.
4. **The intro comes first** (system prompt):
   - who the seat is (name and model);
   - the roster;
   - the meeting purpose and rules;
   - the optional persona.
5. **Only ever add at the end.** Earlier messages are never rewritten, so the start of each request stays identical
   between turns and prompt caching can work. Anything that changes from turn to turn (the floor note) goes at the
   **end**.
6. **Visibility** follows [0005](0005-chair-controlled-meetings.md): a seat sees only messages that were finished
   before its turn started.

## Alternatives considered

- **Everyone as `user` with tags, including the seat's own messages.** Rejected: the model loses track of which
  opinions are its own.
- **The `name` field on messages.** Rejected: providers don't reliably show it to the model, so tags in the text are
  more reliable.
- **A different view format per provider.** Rejected: everything goes through llmgw in one format.

## Consequences

- The view builder is a pure function of saved messages plus the seat, so it's easy to unit test.
- Messages need start and finish times for the visibility rule.
- When a meeting outgrows a seat's context window, older turns are trimmed in that seat's view only. The exact policy
  is still open (see [plan](../plan.md)).
