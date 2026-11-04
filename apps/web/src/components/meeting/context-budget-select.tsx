"use client";

import { CONTEXT_BUDGETS, type ContextBudget, contextBudgetTokens } from "@homestorm/shared";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compactNumber } from "@/lib/format";

export const BUDGET_LABEL: Record<ContextBudget, string> = {
  small: "Small",
  standard: "Standard",
  large: "Large",
  full: "Full",
};

const BUDGET_HINT: Record<ContextBudget, string> = {
  small: "cheapest; trims a long meeting first",
  standard: "the default",
  large: "half the model's window",
  full: "the whole window, minus room for the answer",
};

/**
 * A seat's context budget (ADR 0012): how much of the meeting its view may hold before the oldest turns are
 * trimmed. Each option shows its size for this seat's model. null is Standard.
 */
export function ContextBudgetSelect({
  value,
  onChange,
  contextWindow,
  outputCap,
  standard,
}: {
  value: ContextBudget | null;
  onChange: (v: ContextBudget | null) => void;
  contextWindow: number | null;
  outputCap: number;
  /** The server's Standard size; null until the model list has loaded. */
  standard: number | null;
}) {
  const preset = value ?? "standard";
  const size = (p: ContextBudget) =>
    standard === null ? null : contextBudgetTokens(p, contextWindow, outputCap, standard);
  const chosen = size(preset);
  return (
    <div className="space-y-1.5">
      <Label>Context budget</Label>
      <Select
        value={preset}
        onValueChange={(v) => onChange(v === "standard" ? null : (v as ContextBudget))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONTEXT_BUDGETS.map((p) => {
            const n = size(p);
            return (
              <SelectItem key={p} value={p}>
                {BUDGET_LABEL[p]}
                {n !== null && ` · ${compactNumber(n)}`}
                <span className="text-muted-foreground"> ({BUDGET_HINT[p]})</span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {contextWindow
          ? `Model window: ${contextWindow.toLocaleString("en-US")} tokens. `
          : "llmgw doesn't report this model's window. "}
        Older turns are trimmed past the budget.
        {(preset === "large" || preset === "full") && chosen !== null && (
          <span className="text-warn">
            {" "}
            In a long meeting, every turn re-sends up to {compactNumber(chosen)} tokens.
          </span>
        )}
      </p>
    </div>
  );
}
