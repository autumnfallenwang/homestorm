# 0002: Every model call goes through llmgw

- **Status:** accepted
- **Date:** 2026-11-02

## Context

homestorm needs several providers in one room. The home LLM gateway, llmgw (`~/agentic/llm-gateway`), already
serves them in the OpenAI format. As of 0.5.0 it adds per-model allowance (`/v1/limits`) and per-request usage logs.

The chair needs to trust that each reply came from the model shown: no silent substitution.

## Decision

- **Single entry point:** homestorm calls models **only** through llmgw (`http://llmgw.arch.internal`), never a
  provider directly. That includes DeepSeek, which llmgw now serves.
- **Sources** (llmgw's `owned_by`):
  - `anthropic`: Claude, on the Claude subscription;
  - `openai-codex`: GPT, on the ChatGPT subscription;
  - `deepseek`: DeepSeek, on the prepaid API key.
- **Excluded for now:** Ollama models, by the user's choice. Gemini isn't available.
- **Exact models only:** seats store the exact model ID (or `owned_by/model`). llmgw has no aliases and never falls
  back to another model. homestorm never retries on a *different* model either; retry always uses the same one.
- **Each saved message records** the model ID, `owned_by`, token usage, `cost_usd` and llmgw's `req_id`. Any message
  can then be traced in Loki with `{namespace="llmgw"} | json | req_id="<id>"`.
- **Seat cards** show allowance from `/v1/limits?model=`. A seat whose status is `unavailable` (not on the plan) can't
  take the floor.
- **An `exhausted` allowance is shown, not enforced** (changed 2026-11-04, the user's call). llmgw reported Claude
  `exhausted` at 90% of its week while Claude still answered, because it reads Anthropic's near-limit severity as
  exhausted. Now the card says "Allowance low" (some left) or "Out of allowance" (none), the seat can still be
  asked, and a real refusal comes back as a 429 shown as "Out of allowance" on the message.

## Alternatives considered

- **Call each provider's API directly** with a key per provider. Rejected: it duplicates what llmgw already does
  (logins, streaming, limits, cost logging), and the other home apps all go through llmgw.
- **OpenRouter.** Rejected: it would bill per token for Claude and GPT, which the user already pays for through
  subscriptions.

## Consequences

- homestorm holds no provider keys. Adding or removing a source is an llmgw change.
- llmgw is a dependency: if it's down, the meeting can't proceed.
- **How llmgw signs in to each provider** is llmgw's business, not homestorm's (D6, closed). homestorm's code is the
  same either way.
