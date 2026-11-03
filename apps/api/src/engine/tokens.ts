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

/** Output caps per answer length (ADR 0012). GPT models ignore max_tokens. */
export const OUTPUT_CAP = { concise: 2_048, detailed: 8_192 } as const;

/**
 * How many tokens one seat's view may use: the model's window minus the reply and a margin, and never more than
 * homestorm's own cap.
 */
export function viewBudget(contextWindow: number | null, outputCap: number, cap: number): number {
  if (!contextWindow) return cap;
  return Math.max(1_000, Math.min(contextWindow - outputCap - BUDGET_MARGIN_TOKENS, cap));
}
