"use client";

import { canTakeFloor, type WrapKind } from "@homestorm/shared";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { api } from "@/lib/api";
import { useRoom } from "./room-context";
import { SeatAvatar } from "./source";

const KINDS: { value: WrapKind; label: string; detail: string; button: string }[] = [
  {
    value: "minutes",
    label: "Minutes",
    detail: "The question, each seat's position, where they agreed and disagreed",
    button: "Write minutes",
  },
  {
    value: "decision",
    label: "Decision and reasons",
    detail: "What the discussion points to, and why",
    button: "Write the decision",
  },
  {
    value: "open_questions",
    label: "Open questions",
    detail: "What's still unsettled",
    button: "List open questions",
  },
];

/** Wrap up (ADR 0007): one seat the chair picks writes the minutes, a decision, or the open questions. */
export function WrapUpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { id, state, limits, running, act } = useRoom();
  const seats = state.seats.filter((s) => !s.removedAt);
  const [seatId, setSeatId] = useState<string>("");
  const [kind, setKind] = useState<WrapKind>("minutes");
  const [post, setPost] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && !seats.some((s) => s.id === seatId))
      setSeatId(seats.find((s) => canTakeFloor(limits[s.id]))?.id ?? "");
  }, [open, seats, seatId, limits]);

  async function write() {
    if (!seatId) return;
    setBusy(true);
    const ok = await act(() => api.wrapUp(id, { seatId, kind, post }));
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Wrap up</DialogTitle>
          <DialogDescription>One seat writes it, from everything said so far.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Who writes it</Label>
          <RadioGroup value={seatId} onValueChange={setSeatId} className="gap-1">
            {seats.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-accent"
              >
                <RadioGroupItem value={s.id} disabled={!canTakeFloor(limits[s.id])} />
                <SeatAvatar name={s.displayName} source={s.ownedBy} size="sm" />
                <span className="text-sm">{s.displayName}</span>
              </label>
            ))}
          </RadioGroup>
        </div>
        <div className="space-y-1.5">
          <Label>What to write</Label>
          <RadioGroup value={kind} onValueChange={(v) => setKind(v as WrapKind)} className="gap-1">
            {KINDS.map((k) => (
              <label
                key={k.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 hover:bg-accent"
              >
                <RadioGroupItem value={k.value} className="mt-0.5" />
                <span>
                  <span className="block text-sm">{k.label}</span>
                  <span className="block text-xs text-muted-foreground">{k.detail}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <Checkbox checked={post} onCheckedChange={(c) => setPost(c === true)} />
          Post it in the meeting so every seat can see it
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={write} disabled={!seatId || busy || running}>
            {busy && <Loader2 className="animate-spin" />}
            {KINDS.find((k) => k.value === kind)?.button}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
