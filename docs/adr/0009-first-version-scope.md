# 0009: What the first version includes

- **Status:** accepted
- **Date:** 2026-11-02

## Context

The design (ADRs 0004–0007) covers more than a first version needs. [plan.md](../plan.md) proposed a v1 cut (D1),
and the user accepted it.

One item needed adjusting. On 2026-11-02, llmgw 0.5.0's streaming responses carry text and reasoning deltas only:
no `usage`, no `cost_usd`, and no `req_id`. llmgw makes its own random request id and doesn't return it or accept one
from the caller. Those fields exist only in llmgw's own `completion.usage` log line. llmgw is out of scope for this
project: homestorm uses its API as it is.

## Decision

v1 is the list in [plan.md](../plan.md) under "First version (v1)":

- meetings;
- seats;
- chair actions;
- live answers;
- allowance and errors;
- tracing;
- Markdown export.

Everything under "Out (later)" stays out.

**Tracing in v1** saves, per message:

- the model ID and `owned_by`;
- start and finish times;
- homestorm's own request id, sent to llmgw as `X-Request-Id`;
- `usage`, `cost_usd` and llmgw's `req_id`, but only when llmgw returns them. The client reads them from the stream
  or the response headers if they are there, so nothing changes in homestorm when llmgw adds them.

When llmgw returns no usage, homestorm saves an **estimate** (characters ÷ 4) flagged as estimated, and the UI shows
it as "≈ N tokens". Cost is shown only when llmgw reports it.

## Alternatives considered

- **Non-streaming calls, to get `usage` back.** Rejected: live answers are core to the meeting.
- **Changing llmgw to return usage and `req_id` in streams.** Out of scope here. It's a small llmgw follow-up and
  homestorm already reads the fields if they appear.
- **Show no token numbers until llmgw has them.** Rejected: a clearly marked estimate is still useful for spotting
  long meetings.

## Consequences

- Loki tracing from a homestorm message to llmgw's log line is by model and time until llmgw returns its `req_id`.
- The DeepSeek spend in the meeting header is shown only for messages whose cost llmgw reported.
