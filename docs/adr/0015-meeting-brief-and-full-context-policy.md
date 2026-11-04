# 0015: The meeting brief, and what happens when a view is full

- **Status:** accepted
- **Date:** 2026-11-04
- **Replaces:** the trimming rules in [ADR 0012](0012-long-meetings-answer-length-effort.md). Its budgets, answer
  length and thinking effort stay.

## Context

- A meeting gave the models only its title (`Meeting: <title>` in the intro). Background facts had to go into a
  chat message, where trimming could later drop them.
- ADR 0012 trimmed a full view by keeping the intro, the first chair message and the newest turns, and dropping
  the middle. A summary of the dropped turns had no protected place.
- Other apps separate **standing context**, always present and edited on purpose, from **history**, which grows
  and gets trimmed or summarized:
  - Claude Projects and ChatGPT Projects have instructions and files;
  - Gemini has Gems;
  - SillyTavern has the Author's Note;
  - Claude Code's `CLAUDE.md` is loaded again after `/compact`.
- Automatic summaries were rejected for homestorm:
  - they are hidden model calls the chair didn't ask for;
  - every seat would get a different summary of the past;
  - summaries get facts wrong (the live test's decision put a seat on the wrong option).

## Decision

### 1. The meeting brief

- **What it is:** standing context for the whole meeting, written by the chair: background, facts, constraints,
  the goal. It's optional, and it can be set when the meeting is created and changed at any time.
- **Size:** at most 12,000 characters (about 4,000 tokens), so it fits even a Small context budget.
- **Files** (added 2026-11-04, [ADR 0016](0016-attachments-images-and-text-files.md)): up to 4 images and 24,000
  characters of text files. Text files go in the intro with the brief; images open the conversation, pinned, since
  Claude takes no images in the system prompt.
- **Where seats see it:** in every seat's intro, after the title and before the persona, as "Meeting brief from
  the Chair". **It is never trimmed.**
- **It follows the meeting clock.** Each save is a new version stored as a message (`author_kind = 'brief'`) with
  the next clock value. A turn uses **the latest version at or before its cutoff**, so:
  - every seat in a blind round gets the same brief, even when it's edited during the round;
  - Retry rebuilds exactly the same view, brief included.
- **Seats are told when it changes.** Brief versions don't appear in the view as messages. A version saved after
  the discussion started puts one line where it entered the record: "(The Chair updated the meeting brief. Your
  instructions have the current version.)", or "cleared" when it's emptied. Seats can then square earlier answers
  with the new facts.
- **The chair sees it** pinned at the top of the meeting, with Edit. Each change shows in the transcript ("You
  updated the meeting brief"), and the export puts the current brief at the top.

### 2. When a view is over its budget: keep the start, the summary and the newest

Each seat is checked against its own context budget (ADR 0012).

| Part of the view | When over budget |
|---|---|
| The intro: identity, rules, answer length, **the brief**, persona | never trimmed |
| The first chair message (anchor 1) | never trimmed |
| **The latest posted wrap-up** (minutes, decision or open questions; anchor 2) | never trimmed |
| The newest message | never trimmed |
| The floor note | never trimmed |
| Turns **before** anchor 2 | dropped first, since the wrap-up summarizes them |
| Turns **after** anchor 2 | dropped next, oldest first |

- Each run of dropped turns becomes one line: "(N older messages trimmed to fit the context window.)". A run just
  before the wrap-up says "(N older messages trimmed; the summary below covers them.)".
- Only the latest posted wrap-up is an anchor. Older wrap-ups are trimmed like any turn, and unposted ones are never
  in a seat's view.
- **Rejected:**
  - a rolling window, which loses the first question;
  - automatic summaries (see Context);
  - stopping with an error, which would end a long meeting.

### 3. Summaries are the chair's call

| Step | Who | Effect |
|---|---|---|
| Write it | a seat the chair picks | Wrap up: held back as "not posted" |
| Check and post it | the chair | It becomes anchor 2, so older turns go first |
| Keep it permanently | the chair | **Copy into the brief** on a posted wrap-up opens the brief editor with the wrap-up appended, to edit and save |

### 4. Warnings

- **The seat card shows "Context ≈6.4k of 120k · 5%"**: the last view against the seat's budget, with the share of
  the model's window in a tooltip. It's homestorm's own estimate (characters ÷ 3, the same one trimming uses), saved
  when each turn starts. llmgw 0.5.0 reports token usage only for non-streamed calls, and homestorm streams. Even
  with real usage, the estimate is what trimming acts on, and it's known before the call.
- **The context bar turns amber at 80%** of the seat's budget.
- **When a seat's last turn was trimmed,** the card says "Trimming older turns".
- **When any seat is at 80% or trimming,** the message box shows one line: "A seat's context is nearly full: have a
  seat write minutes and post them, or copy them into the brief."

## Consequences

- **Prompt caching:** editing the brief changes the start of every seat's view, so caching restarts once per edit.
  Trimming also changes a view's start, as before.
- **Context:** a long meeting keeps its question, its facts and its latest reviewed summary in every seat's view,
  at no extra model cost.
- **Old answers stay as written,** even when the brief's facts change. The update line tells seats why.
- **Data:** briefs live in `messages`, so the clock, the live stream, deletion with the meeting, and the export need
  no new table.
