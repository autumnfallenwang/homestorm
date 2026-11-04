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
  /** The last view's size, or null before the seat's first turn. */
  last: number | null;
  /** 0–100, or null before the first turn. */
  percent: number | null;
  /** ok, near the budget, or its last turn was trimmed. */
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
    return { budget, window, last: null, percent: null, tone: "ok" };
  }
  const last = lastTurn.viewTokens;
  const ratio = last / budget;
  return {
    budget,
    window,
    last,
    percent: Math.min(100, ratio * 100),
    tone: lastTurn.trimmedCount > 0 ? "trimming" : ratio >= CONTEXT_WARN_RATIO ? "warn" : "ok",
  };
}

/** "5%", or "<1%" for a sliver, so a fresh meeting doesn't read as 0%. */
export function percentLabel(percent: number): string {
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}
