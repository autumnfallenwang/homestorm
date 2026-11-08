# 0017: Web tools are a room rule; the chair's search is removed

- **Status:** accepted, built 2026-11-08. Replaces "Chair search first" in [ADR 0014](0014-tools-through-mcpgw.md).
- **Date:** 2026-11-08

## Context

ADR 0014 gave the chair two ways to bring in the web:

- **"Search the web" in the message box.** homestorm ran one `web_search` and posted the results as one Sources
  message that every seat read.
- **A per-seat setting:** Off, "Can search and read pages", or "Must search before answering".

In use, the chair didn't need the first one. The real meeting on 2026-11-07 used it once. The seats with web tools did
their own research, which was better: they wrote their own queries, opened pages, and listed their sources under the
answer. Meanwhile, giving a whole room web tools meant opening Edit seat on every seat, one by one.

Answer length already solves the same problem with a room rule that each seat follows unless it has its own setting
(ADR 0012).

## Decision

**The chair's "Search the web" is removed:** the button in the message box, `POST /api/meetings/:id/search`, and the
engine's `search()`.

**Web tools are a room rule,** like answer length:

- **The room rule:** `meetings.web_access`, either Off (the default), Can search, or Must search first. It's in the
  Room rules box under the seats.
- **A seat's own setting:** `seats.web_access`, null by default, which follows the room rule. In Add seat and Edit
  seat, the choices are "Room rule (now …)", "Off, always", "Can search and read pages, always", and "Must search
  before answering, always".
- **Which applies:** the seat's own setting if it has one, else the room rule (`seatWebAccess` in `packages/shared`).
  It's read when each turn starts, so a change applies from the next turn on.
- **Recorded in the transcript:** changes add an event line, as answer length does. "You set web tools to Can search",
  "You set Scribe's web tools to Off", "… back to the room rule".
- **The seat card** shows only a seat's own setting ("web tools", "no web tools", "searches first"). The export lists
  each seat's effective setting.
- **Shown only when it can work:** the room rule, and the web tools field in the seat dialogs, appear when mcpgw is
  reachable, or when the setting isn't Off.

**Old Sources messages stay.** Meetings from before 2026-11-08 keep their posted searches. Seats still read them,
their links still count for the URL rule, and the transcript and the export still show them. Nothing new creates one.

**Migration:** seats that had web tools off now follow the room rule, which starts as off, so nothing changes for
them. Seats that had them on keep that as their own setting.

## Alternatives considered

- **Keep the chair's search alongside the room rule.** Rejected: the user asked for it to go. It was the one control
  in the message box that wasn't about who speaks.
- **A room rule with no per-seat setting.** Rejected: a note-taker or a "think from first principles" seat should be
  able to stay off the web in a room that searches, and one fact-checker should be able to search in a room that
  doesn't.
- **Turn web tools on by default.** Rejected: most meeting questions don't need the web, and tool turns are slower and
  use more allowance (ADR 0014).

## Consequences

- One setting turns a whole room's web tools on or off. Seats with their own setting aren't affected.
- A blind round no longer has a way to give every seat the same sources before they answer. If that's needed, the
  chair can paste links into the message; seats with web tools may read links the chair posted.
- `author_kind = 'sources'` stays in the schema and the code for old meetings, though nothing writes it any more.
