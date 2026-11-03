// Rough token counts. homestorm has no tokenizer (ADR 0012): numbers only need to be roughly right.

/** For fitting a view into its budget: errs on the large side. */
export function budgetTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** For showing usage when llmgw returns none (ADR 0009), shown as "≈ N tokens". */
export function displayTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Each chat message costs a few tokens of framing on top of its text. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/** Room left for the reply and for estimation error. */
export const BUDGET_MARGIN_TOKENS = 4_000;

/** Room for the visible answer, per answer length (ADR 0012). */
export const ANSWER_CAP = { concise: 2_048, detailed: 8_192 } as const;

/**
 * Extra room for thinking, per thinking effort (ADR 0012). Reasoning models count thinking inside `max_tokens`, and
 * how long they think varies a lot: DeepSeek V4 Pro spent over 2,048 tokens thinking on a short question.
 */
export const THINKING_ROOM = { low: 8_192, medium: 16_384, high: 32_768 } as const;

/**
 * `max_tokens` for one turn: the answer cap plus thinking room, never more than the model's own limit. It's a
 * backstop against runaway answers; the intro's length rule keeps answers short. GPT models ignore it.
 */
export function maxOutputTokens(
  answerLength: keyof typeof ANSWER_CAP,
  effort: keyof typeof THINKING_ROOM,
  modelMaxTokens: number | null,
): number {
  const cap = ANSWER_CAP[answerLength] + THINKING_ROOM[effort];
  return modelMaxTokens ? Math.min(cap, modelMaxTokens) : cap;
}

/**
 * How many tokens one seat's view may use: the model's window minus the reply and a margin, and never more than
 * homestorm's own cap.
 */
export function viewBudget(contextWindow: number | null, outputCap: number, cap: number): number {
  if (!contextWindow) return cap;
  return Math.max(1_000, Math.min(contextWindow - outputCap - BUDGET_MARGIN_TOKENS, cap));
}
