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
import { allowanceLine, seatStatus } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddSeatDialog } from "./add-seat-dialog";
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
  Unavailable: "text-destructive",
};

function SeatCard({ seat, first, last }: { seat: Seat; first: boolean; last: boolean }) {
  const { id, state, limits, running, act, openEditSeat } = useRoom();
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
              Edit name and persona
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
          <span className="whitespace-nowrap text-muted-foreground">New questions</span>
          <Select
            value={m.defaultMode}
            onValueChange={(v) =>
              act(() => api.updateMeeting(id, { defaultMode: v as "blind" | "in_turn" }))
            }
          >
            <SelectTrigger size="sm" className="h-7 w-40 text-xs" aria-label="New questions go to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blind">Everyone · blind</SelectItem>
              <SelectItem value="in_turn">Everyone · in turn</SelectItem>
            </SelectContent>
          </Select>
        </label>
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
