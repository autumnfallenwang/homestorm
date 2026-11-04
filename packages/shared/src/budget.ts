// Token budgets (ADR 0012), shared so the API applies them and the web shows the same numbers.

import type { AnswerLength, ContextBudget, ReasoningEffort } from "./domain.js";

/** Room for the visible answer, per answer length. */
export const ANSWER_CAP = { concise: 2_048, detailed: 8_192 } as const;

/**
 * Extra room for thinking, per thinking effort. Reasoning models count thinking inside `max_tokens`, and how long
 * they think varies a lot: DeepSeek V4 Pro spent over 2,048 tokens thinking on a short question.
 */
export const THINKING_ROOM = { low: 8_192, medium: 16_384, high: 32_768 } as const;

/** Room left for the reply's estimation error, on top of the output cap. */
export const BUDGET_MARGIN_TOKENS = 4_000;

/** The Small preset. Standard is the server's `VIEW_TOKEN_BUDGET` (120,000 by default). */
export const SMALL_CONTEXT_BUDGET = 32_000;

/**
 * `max_tokens` for one turn: the answer cap plus thinking room, never more than the model's own limit. It's a
 * backstop against runaway answers; the intro's length rule keeps answers short. GPT models ignore it.
 */
export function maxOutputTokens(
  answerLength: AnswerLength,
  effort: ReasoningEffort,
  modelMaxTokens: number | null,
): number {
  const cap = ANSWER_CAP[answerLength] + THINKING_ROOM[effort];
  return modelMaxTokens ? Math.min(cap, modelMaxTokens) : cap;
}

/**
 * How many tokens one seat's view may use, for its context-budget preset. Never more than the model's window minus
 * the reply and a margin. Without a known window, Large and Full fall back to Standard.
 */
export function contextBudgetTokens(
  preset: ContextBudget,
  contextWindow: number | null,
  outputCap: number,
  standard: number,
): number {
  const ceiling = contextWindow
    ? contextWindow - outputCap - BUDGET_MARGIN_TOKENS
    : Number.POSITIVE_INFINITY;
  const wanted =
    preset === "small"
      ? SMALL_CONTEXT_BUDGET
      : preset === "standard" || !contextWindow
        ? standard
        : preset === "large"
          ? Math.floor(contextWindow / 2)
          : ceiling;
  return Math.max(1_000, Math.min(wanted, ceiling));
}
