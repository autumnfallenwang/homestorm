// Rough token counts. homestorm has no tokenizer (ADR 0012): numbers only need to be roughly right. The budget
// math itself (output caps, context-budget presets) lives in @homestorm/shared, so the web shows the same numbers.

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
