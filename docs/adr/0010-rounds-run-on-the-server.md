# 0010: Rounds run on the server; the browser follows one live stream per meeting

- **Status:** accepted
- **Date:** 2026-11-02

## Context

A round calls several models, possibly one after another, and each answer streams for up to a few minutes. Something
has to drive that sequence and keep the results (D2 in [plan.md](../plan.md)).

## Decision

- **The browser only sends actions** (ADR [0006](0006-control-in-code-etiquette-in-prompts.md)). The API creates the
  round, calls llmgw for each seat, and saves the text as it streams: to memory on every chunk, to Postgres at
  most every half second and at the end.
- **One live stream (SSE) per meeting:** `GET /api/meetings/:id/events`.
  - On connect it sends a `snapshot` event: the whole meeting, including the partial text of answers still streaming.
  - Then it sends small events: message created, text added (with its character offset), message finished, round
    status, seat changes.
  - A text event applies only at its offset, so a duplicate or missed chunk can't garble an answer.
  - After a missed chunk, or on reconnect, the browser takes a fresh snapshot.
- **Closing the tab doesn't stop a round.** Reloading gets a snapshot and carries on.
- **One API instance** (Deployment `replicas: 1`, `Recreate`): the round runner and the live streams live in that one
  process, so there's no Redis and no queue.
- **One running round per meeting.** A new question waits until the current round is finished or stopped. A comment
  with *No reply* can be posted at any time.
- **On API restart:** answers still marked streaming are set to `stopped` with their partial text, so the chair can
  keep or retry them.

## Alternatives considered

- **The browser drives the round** (calls llmgw itself, one seat after another). Rejected: closing the tab would kill
  the round, and llmgw would be exposed to the browser.
- **A job queue (Redis, BullMQ) and several API instances.** Rejected: one person chairs one meeting at a time.
- **WebSockets.** Rejected: the browser only sends occasional actions, which plain HTTP covers; server-to-browser is
  all that needs streaming.

## Consequences

- The API can't be scaled out without moving the round runner and event fan-out somewhere shared.
- A deploy restarts the API and stops any running answer; the chair sees it as stopped and can retry.
