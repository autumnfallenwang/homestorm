# 0012: Long meetings, answer length and thinking effort

- **Status:** accepted
- **Date:** 2026-11-02

## Context

Every seat re-reads the whole meeting on every turn, so views grow quickly. Answers can be long, and reasoning models
can think for a long time (D4 in [plan.md](../plan.md)).

llmgw facts, checked 2026-11-02:

- `/v1/models` gives each model's `context_window` and `max_tokens`.
- `reasoning_effort` accepts `none`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. Each model moves it to
  the nearest level it has.
- GPT (Codex) models ignore `max_tokens`.

## Decision

**Long meetings: trim the oldest turns, per seat.**

- A seat's view has a token budget, set per seat as a **context budget preset** (added 2026-11-03):

  | Preset | Size | 1M window (Claude, DeepSeek) | 272k window (GPT) |
  |---|---|---|---|
  | Small | 32,000 | 32k | 32k |
  | **Standard** (default) | `VIEW_TOKEN_BUDGET`, default 120,000 | 120k | 120k |
  | Large | half the window | 500k | 136k |
  | Full | the window minus the output cap minus 4,000 | ~986k | ~258k |

  - No preset goes past the window minus the output cap minus 4,000. Without a known window, Large and Full fall
    back to Standard.
  - Standard stays the default so one turn can't eat a large share of the allowance. The budget is only a ceiling:
    a short meeting sends the same tokens on any preset.
  - The preset is stored by name, not as a number, so it follows the model if llmgw reports a new window. A
    dropdown, not a slider or percentages: the same percentage means very different sizes across models, and the
    dropdown shows this seat's real numbers.
  - The seat card shows the last view against the budget ("Context ≈6.4k of 120k"), from `messages.view_tokens`,
    saved when each turn starts. Changing the preset adds an event line. The math is `contextBudgetTokens` in
    `packages/shared/src/budget.ts`, shared by the API and the web.
- Tokens are estimated as characters ÷ 3, erring on the large side.
- **What's kept and what's dropped when a view is over budget** is now [ADR 0015](0015-meeting-brief-and-full-context-policy.md)
  (2026-11-04): the intro with the meeting brief, the first chair message, the latest posted wrap-up and the newest
  messages stay; turns before the wrap-up go first. Each answer saves how many were trimmed, and the UI shows
  "older turns trimmed".
- Summaries are written by a seat the chair picks and posted by the chair (ADR 0015), never automatically.

**Answer length is a room rule, *Concise* (default) or *Detailed*.**

- **Concise:** the intro asks for short answers, with 2,048 tokens of room for the answer.
- **Detailed:** the intro asks for thorough answers, with 8,192 tokens of room for the answer.
- For GPT, which ignores `max_tokens`, the instruction is all there is.

**A seat can have its own answer length** (added 2026-11-03): *Room rule* (the default, stored as null), *Concise,
always* or *Detailed, always*, in the Add seat and Edit seat dialogs. The room rule stays the main control, because a
blind round compares best when everyone answers at the same length. The override is for seats with their own job: a
note-taker that writes full minutes in a Concise room, or one deep-dive seat. Which length applies, most specific
first:

1. **The chair's message** ("under 60 words", "give the full plan"): that turn only, through the prompt. The intro
   already says "unless the Chair asks for more".
2. **The seat's own length**, if set.
3. **The room rule.**

The intro line and the output cap both follow the seat's length (`seatAnswerLength` in `packages/shared`). The cap
doesn't follow a one-off ask in the message, so a very long one-off answer still needs Detailed on the seat or the
room. Put length in this setting, not in a persona: a persona is free text and the cap can't see it. The seat card
shows the override ("Detailed answers"), and setting or clearing it adds an event line.

**Thinking effort is per seat:** `reasoning_effort` of `low` (default), `medium` or `high`, picked in the seat's
settings.

**`max_tokens` is the answer room plus thinking room** (changed 2026-11-03), and never more than the model's own
`max_tokens` from `/v1/models`:

| Thinking effort | Thinking room | Concise | Detailed |
|---|---|---|---|
| Low | 8,192 | 10,240 | 16,384 |
| Medium | 16,384 | 18,432 | 24,576 |
| High | 32,768 | 34,816 | 40,960 |

- **Why:** reasoning models count thinking inside `max_tokens`. With the first caps (2,048 and 8,192 in total),
  DeepSeek V4 Pro spent all 2,048 tokens thinking on a short blind-round question and returned no text.
- **Thinking length varies a lot.** The same 743-token view, sent straight to DeepSeek, thought for 35 to 1,116
  tokens at `low` and up to 2,175 at `high`. So the room is generous: unused room costs nothing, and the intro's
  length rule, not the cap, keeps answers short. The cap only stops a runaway answer.
- **llmgw's mapping of effort** (seen in its source, 2026-11-03): its model data lists only `high` and `max` for
  DeepSeek V4 Pro, so `low` and `medium` become `high`, and the level isn't forwarded to DeepSeek; only thinking on
  is. homestorm still sends the seat's level, and the thinking room covers either outcome.

## Alternatives considered

- **Running summary of older turns.** Later: it needs an extra model call, and a choice of which model writes it.
- **A real tokenizer per model.** Rejected: one per provider, for a number that only has to be roughly right.
- **No homestorm cap, only the model limit.** Rejected: Claude and DeepSeek models have 1M-token windows, so a long
  meeting would re-send hundreds of thousands of tokens per turn.

## Consequences

- Trimming changes the start of that seat's view, so prompt caching restarts for it. That only happens on very long
  meetings.
- The first chair message is always kept, so a seat never loses the original question.
- A bigger output cap leaves less of a small context window for the view (window minus cap minus 4,000). That only
  matters for small local models, and their own `max_tokens` (4,096) caps it first.
