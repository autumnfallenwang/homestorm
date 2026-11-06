"use client";

import { canTakeFloor, type Seat } from "@homestorm/shared";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Hand,
  MoreHorizontal,
  Pencil,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { allowanceLine, compactNumber, seatStatus } from "@/lib/format";
import { percentLabel, type SeatContext, seatContext } from "@/lib/seat-context";
import { cn } from "@/lib/utils";
import { AddSeatDialog } from "./add-seat-dialog";
import { LENGTH_LABEL } from "./answer-length-select";
import { BUDGET_LABEL } from "./context-budget-select";
import { useRoom } from "./room-context";
import { SeatAvatar } from "./source";

/** Right pane, always visible on wide screens (ADR 0007): seat cards, then the room rules. */
export function SeatsPanel() {
  const { state } = useRoom();
  const seats = state.seats.filter((s) => !s.removedAt);
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-sidebar" aria-label="Seats">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold">
          Seats <span className="font-normal text-muted-foreground">· {seats.length}</span>
        </h2>
        <AddSeatDialog />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {seats.length === 0 && (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No seats yet. Add Claude, GPT or DeepSeek models to the table.
          </p>
        )}
        {seats.map((s, i) => (
          <SeatCard key={s.id} seat={s} first={i === 0} last={i === seats.length - 1} />
        ))}
      </div>
      <RoomRules />
    </aside>
  );
}

const STATUS_TONE: Record<string, string> = {
  Answering: "text-brand",
  Next: "text-brand",
  Idle: "text-muted-foreground",
  Muted: "text-muted-foreground",
  "Rate limited": "text-warn",
  "Out of allowance": "text-destructive",
  "Allowance low": "text-warn",
  Unavailable: "text-destructive",
};

function SeatCard({ seat, first, last }: { seat: Seat; first: boolean; last: boolean }) {
  const { id, state, limits, running, act, openEditSeat } = useRoom();
  const context = useContextLine(seat);
  const lim = limits[seat.id];
  const status = seatStatus(seat, state, lim);
  const allowance = allowanceLine(lim);
  const canAsk = !running && canTakeFloor(lim);
  const ask = () => act(() => api.send(id, { text: "", mode: "blind", targets: [seat.id] }));
  const toggleMute = () => act(() => api.updateSeat(id, seat.id, { muted: !seat.muted }));

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3",
        seat.muted && "border-dashed bg-transparent",
        status === "Answering" && "ring-2 ring-brand/40",
      )}
    >
      <div className="flex items-start gap-2.5">
        <SeatAvatar name={seat.displayName} source={seat.ownedBy} dashed={seat.muted} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{seat.displayName}</p>
          <p className="truncate font-mono text-[0.6875rem] text-muted-foreground">
            {seat.model}
            {seat.reasoningEffort !== "low" && ` · effort ${seat.reasoningEffort}`}
            {seat.answerLength && ` · ${LENGTH_LABEL[seat.answerLength]} answers`}
            {seat.contextBudget &&
              seat.contextBudget !== "standard" &&
              ` · ${BUDGET_LABEL[seat.contextBudget]} context`}
            {seat.webAccess === "on" && " · web tools"}
            {seat.webAccess === "must" && " · searches first"}
          </p>
        </div>
        <span className={cn("shrink-0 text-xs font-medium", STATUS_TONE[status])}>{status}</span>
      </div>

      {seat.muted ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Skipped in rounds. Still hears everything.
        </p>
      ) : (
        seat.persona && (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">Persona: {seat.persona}</p>
        )
      )}

      <div className="mt-2">
        <p
          className={cn(
            "text-xs",
            allowance.tone === "bad"
              ? "text-destructive"
              : allowance.tone === "warn"
                ? "text-warn"
                : "text-muted-foreground",
          )}
        >
          {allowance.text}
        </p>
        {allowance.percent !== null && (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className={cn(
                "h-full rounded-full",
                allowance.tone === "warn"
                  ? "bg-warn"
                  : allowance.tone === "bad"
                    ? "bg-destructive"
                    : "bg-ok",
              )}
              style={{ width: `${allowance.percent}%` }}
            />
          </div>
        )}
      </div>

      {context && (
        <div className="mt-2">
          <p
            title={context.detail}
            className={cn("text-xs", context.tone === "ok" ? "text-muted-foreground" : "text-warn")}
          >
            {context.text}
          </p>
          {context.percent !== null && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className={cn(
                  "h-full rounded-full",
                  context.tone === "ok" ? "bg-muted-foreground/50" : "bg-warn",
                )}
                style={{ width: `${Math.max(2, context.percent)}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-2.5 flex gap-1.5">
        <Button size="sm" variant="outline" className="h-7 flex-1" onClick={ask} disabled={!canAsk}>
          <Hand className="size-3.5" />
          Ask
        </Button>
        <Button size="sm" variant="outline" className="h-7 flex-1" onClick={toggleMute}>
          {seat.muted ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          {seat.muted ? "Unmute" : "Mute"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={`More for ${seat.displayName}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={ask} disabled={!canAsk}>
              <Hand />
              Ask now
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleMute}>
              {seat.muted ? <Volume2 /> : <VolumeX />}
              {seat.muted ? "Unmute for rounds" : "Mute in rounds"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openEditSeat(seat)}>
              <Pencil />
              Edit seat…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={first}
              onSelect={() => act(() => api.moveSeat(id, seat.id, "up"))}
            >
              <ArrowUp />
              Move up in seat order
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={last}
              onSelect={() => act(() => api.moveSeat(id, seat.id, "down"))}
            >
              <ArrowDown />
              Move down in seat order
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => act(() => api.removeSeat(id, seat.id))}
            >
              <Trash2 />
              Remove from meeting
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function RoomRules() {
  const { id, state, act } = useRoom();
  const m = state.meeting;
  return (
    <section className="border-t px-4 py-3" aria-label="Room rules">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Room rules
      </h3>
      <div className="space-y-2 text-sm">
        <label className="flex items-center justify-between gap-2">
          <span className="whitespace-nowrap text-muted-foreground">Answer length</span>
          <Select
            value={m.answerLength}
            onValueChange={(v) =>
              act(() => api.updateMeeting(id, { answerLength: v as "concise" | "detailed" }))
            }
          >
            <SelectTrigger size="sm" className="h-7 w-40 text-xs" aria-label="Answer length">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="concise">Concise</SelectItem>
              <SelectItem value="detailed">Detailed</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 text-ok" /> Seats speak only when called
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 text-ok" /> Seats may disagree with the chair
        </p>
      </div>
    </section>
  );
}

/**
 * "Context 6.4k of 120k · 5%": the seat's last view against its budget (ADR 0015). The count is llmgw's when it
 * reported one (0.6.0+), else homestorm's estimate (≈). Amber and "Trimming older turns" follow the estimate, because
 * that's what trimming acts on, and it errs high. Null until the models have loaded.
 */
function useContextLine(seat: Seat): {
  text: string;
  detail: string;
  percent: number | null;
  tone: SeatContext["tone"];
} | null {
  const { state, models, standardContextBudget } = useRoom();
  if (standardContextBudget === null) return null;
  const ctx = seatContext(seat, state, models, standardContextBudget);
  const n = (x: number) => x.toLocaleString("en-US");
  const windowLine = ctx.window ? `Model window: ${n(ctx.window)} tokens.` : "";
  if (ctx.last === null || ctx.percent === null)
    return {
      text: `Context budget ${compactNumber(ctx.budget)}`,
      detail: `No turn yet. ${windowLine}`.trim(),
      percent: null,
      tone: "ok",
    };
  const shown = ctx.real ?? ctx.last;
  const size = `Context ${ctx.real === null ? "≈" : ""}${compactNumber(shown)} of ${compactNumber(ctx.budget)} · ${percentLabel(ctx.percent)}`;
  const ofWindow = ctx.window
    ? ` That's ${percentLabel((shown / ctx.window) * 100)} of the model's ${compactNumber(ctx.window)} window.`
    : "";
  const counted =
    ctx.real === null
      ? `Last view ≈${n(ctx.last)} tokens (homestorm's estimate)`
      : `Last view ${n(ctx.real)} tokens, counted by llmgw (homestorm's estimate, which trimming uses: ≈${n(ctx.last)})`;
  return {
    text: ctx.tone === "trimming" ? `Trimming older turns · ${size}` : size,
    detail: `${counted} of this seat's ${n(ctx.budget)}-token budget.${ofWindow}`,
    percent: ctx.percent,
    tone: ctx.tone,
  };
}
