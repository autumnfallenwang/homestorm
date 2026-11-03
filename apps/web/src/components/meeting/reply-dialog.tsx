"use client";

import { canTakeFloor, type Message, stripSpeakerTag } from "@homestorm/shared";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { plainText } from "@/lib/format";
import { useRoom } from "./room-context";
import { SeatAvatar } from "./source";

/** "Who should respond?" to one message (ADR 0007). The message's author isn't listed. */
export function ReplyDialog({ target, onClose }: { target: Message | null; onClose: () => void }) {
  const { id, state, limits, running, act, seatName } = useRoom();
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<"blind" | "in_turn">("in_turn");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new target resets the form
  useEffect(() => {
    setPicked([]);
    setNote("");
    setMode("in_turn");
  }, [target]);

  const seats = state.seats.filter((s) => !s.removedAt && s.id !== target?.seatId);
  const author = target
    ? target.authorKind === "chair"
      ? "your message"
      : `${seatName(target.seatId)}'s message`
    : "";

  async function send() {
    if (!target || !picked.length) return;
    setBusy(true);
    const ordered = seats.filter((s) => picked.includes(s.id)).map((s) => s.id);
    const ok = await act(() =>
      api.send(id, { text: note, mode, targets: ordered, replyTo: target.id }),
    );
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who should respond?</DialogTitle>
          <DialogDescription>To {author}</DialogDescription>
        </DialogHeader>
        {target && (
          <blockquote className="rounded-md border-l-2 bg-muted px-3 py-2 text-sm text-muted-foreground">
            <span className="line-clamp-3">{plainText(stripSpeakerTag(target.content))}</span>
          </blockquote>
        )}
        <fieldset className="space-y-1">
          <legend className="sr-only">Seats</legend>
          {seats.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-accent"
            >
              <Checkbox
                checked={picked.includes(s.id)}
                disabled={!canTakeFloor(limits[s.id])}
                onCheckedChange={(c) =>
                  setPicked((p) => (c ? [...p, s.id] : p.filter((x) => x !== s.id)))
                }
              />
              <SeatAvatar name={s.displayName} source={s.ownedBy} size="sm" />
              <span className="text-sm">{s.displayName}</span>
              {s.muted && <span className="text-xs text-muted-foreground">muted</span>}
            </label>
          ))}
          {!seats.length && <p className="text-sm text-muted-foreground">No other seats to ask.</p>}
        </fieldset>
        {picked.length >= 2 && (
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as "blind" | "in_turn")}
            className="flex gap-4"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="in_turn" /> In turn
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="blind" /> Blind
            </label>
          </RadioGroup>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="reply-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="reply-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Push back on the cost argument."
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} disabled={!picked.length || busy || running}>
            {busy && <Loader2 className="animate-spin" />}
            {picked.length ? `Ask ${picked.length} seat${picked.length === 1 ? "" : "s"}` : "Ask"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
