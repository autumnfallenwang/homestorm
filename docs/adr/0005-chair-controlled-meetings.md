# 0005: Chair-controlled meetings

- **Status:** accepted
- **Date:** 2026-11-02

## Context

The user wants more minds on one topic, and to decide who speaks and who answers whom. Formal procedures (Robert's
Rules, the UN, courts) were looked at for ideas; most of their machinery exists to manage people who all want to talk,
which bots don't. Details are in [meeting-control-design.md](../meeting-control-design.md) §1–3.

## Decision

- **The user is chair and participant:** they ask, comment, give their own view and decide who speaks next.
- **The one rule: a seat speaks only when the chair gives it the floor.** Bots never trigger each other.
- **Chair actions:**
  - message, with a send-to of *Everyone · blind* (the default for new questions), *Everyone · in turn*, chosen
    seats, or *No reply*;
  - @mention one or more seats;
  - reply to a specific message;
  - mute and unmute;
  - add, remove and reorder seats;
  - stop and retry;
  - wrap up into minutes, a decision or open questions.
- **Rounds:**
  - **Blind:** all seats answer at the same time, without seeing each other's answers. This is the default for a new
    question, because seats answering one after another anchor on the first answer.
  - **In turn:** seats answer one after another in seat order, each seeing the answers before it.
- **The visibility rule (the only one):** a seat sees every message that was finished before its turn started.
  Blind and in turn are just "start together" versus "start one after another".
- **Muted seats** are skipped in rounds, but still see the whole meeting and can be asked directly.
- **Every seat is told** that the chair wants independent views and that disagreeing with the chair is welcome.

## Alternatives considered

- **An AI moderator that picks speakers** (LobeHub's approach). Rejected: the user wants to be the chair.
- **A free-for-all, where any bot can reply to any message.** Rejected: unpredictable cost, loops, noise.
- **Full parliamentary procedure** (motions, seconding, votes, points of order). Rejected as overkill.

## Consequences

- The data model needs only **messages** and **rounds**: which seats answer, blind or in turn, and which message
  they're answering.
- The cost of every question is known up front: one call per seat called.
- For later: seats asking for the floor, auto-discussion with a cap, private questions, polls, council mode.
