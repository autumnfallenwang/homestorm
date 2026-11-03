"use client";

import type { ReasoningEffort, Seat } from "@homestorm/shared";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useRoom } from "./room-context";

/** Edit name, persona and thinking effort. The model can't change: that would be a different seat. */
export function EditSeatDialog({ seat, onClose }: { seat: Seat | null; onClose: () => void }) {
  const { id, act } = useRoom();
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [effort, setEffort] = useState<ReasoningEffort>("low");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (seat) {
      setName(seat.displayName);
      setPersona(seat.persona ?? "");
      setEffort(seat.reasoningEffort);
    }
  }, [seat]);

  async function save() {
    if (!seat || !name.trim()) return;
    setBusy(true);
    const ok = await act(() =>
      api.updateSeat(id, seat.id, {
        displayName: name.trim(),
        persona: persona.trim() || null,
        reasoningEffort: effort,
      }),
    );
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open={!!seat} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit seat</DialogTitle>
          <DialogDescription className="font-mono text-xs">{seat?.model}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Display name</Label>
            <Input
              id="edit-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-persona">
              Persona <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="edit-persona"
              rows={3}
              maxLength={2000}
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Thinking effort</Label>
            <Select value={effort} onValueChange={(v) => setEffort(v as ReasoningEffort)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
