// How full a seat's context is (ADR 0015): its last view against its budget, for the seat card and the message box.

import {
  contextBudgetTokens,
  type MeetingState,
  type ModelInfo,
  maxOutputTokens,
  type Seat,
  seatAnswerLength,
} from "@homestorm/shared";

/** The bar turns amber from here. */
export const CONTEXT_WARN_RATIO = 0.8;

export interface SeatContext {
  budget: number;
  /** The model's context window from llmgw, or null when it reports none. */
  window: number | null;
  /** homestorm's estimate of the last view (what trimming uses), or null before the seat's first turn. */
  last: number | null;
  /** The prompt tokens llmgw counted for that turn, when it reported them (llmgw 0.6.0+). */
  real: number | null;
  /** The shown size against the budget, 0–100: the real count when there is one, else the estimate. */
  percent: number | null;
  /** From the estimate, like trimming: ok, near the budget, or its last turn was trimmed. */
  tone: "ok" | "warn" | "trimming";
}

export function seatContext(
  seat: Seat,
  state: MeetingState,
  models: Map<string, ModelInfo>,
  standardBudget: number,
): SeatContext {
  const info = models.get(seat.model);
  const outputCap = maxOutputTokens(
    seatAnswerLength(seat, state.meeting),
    seat.reasoningEffort,
    info?.maxTokens ?? null,
  );
  const budget = contextBudgetTokens(
    seat.contextBudget ?? "standard",
    info?.contextWindow ?? null,
    outputCap,
    standardBudget,
  );
  const lastTurn = state.messages
    .filter((m) => m.seatId === seat.id && m.viewTokens !== null)
    .at(-1);
  const window = info?.contextWindow ?? null;
  if (!lastTurn || lastTurn.viewTokens === null) {
    return { budget, window, last: null, real: null, percent: null, tone: "ok" };
  }
  const last = lastTurn.viewTokens;
  const ratio = last / budget;
  const real = lastTurn.usage && !lastTurn.usage.estimated ? lastTurn.usage.promptTokens : null;
  return {
    budget,
    window,
    last,
    real,
    percent: Math.min(100, ((real ?? last) / budget) * 100),
    tone: lastTurn.trimmedCount > 0 ? "trimming" : ratio >= CONTEXT_WARN_RATIO ? "warn" : "ok",
  };
}

/** "5%", or "<1%" for a sliver, so a fresh meeting doesn't read as 0%. */
export function percentLabel(percent: number): string {
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}
