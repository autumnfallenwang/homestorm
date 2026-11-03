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

- A seat's view has a token budget: the smaller of
  - the model's `context_window` minus its output cap minus 4,000;
  - homestorm's own cap, `VIEW_TOKEN_BUDGET`, default 120,000, so one turn can't eat a large share of the
    allowance.
- Tokens are estimated as characters ÷ 3, erring on the large side.
- **Always kept:** the intro, the meeting's first chair message, and the newest messages.
- **Dropped:** the oldest messages in between, replaced by one line: "(N older messages trimmed)".
- The message saves how many were trimmed, and the UI shows "older turns trimmed" on it.
- Running summaries come later.

**Answer length is a room rule, *Concise* (default) or *Detailed*.**

- **Concise:** the intro asks for short answers, with 2,048 tokens of room for the answer.
- **Detailed:** the intro asks for thorough answers, with 8,192 tokens of room for the answer.
- For GPT, which ignores `max_tokens`, the instruction is all there is.

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
