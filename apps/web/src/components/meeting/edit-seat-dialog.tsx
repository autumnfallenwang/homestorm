"use client";

import {
  type AnswerLength,
  type ContextBudget,
  maxOutputTokens,
  type ReasoningEffort,
  type Seat,
  seatNameClash,
  seatNameClashMessage,
  type WebAccess,
} from "@homestorm/shared";
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
import { AnswerLengthSelect } from "./answer-length-select";
import { ContextBudgetSelect } from "./context-budget-select";
import { useRoom } from "./room-context";
import { WebAccessSelect } from "./web-access-select";

/**
 * Edit name, persona, thinking effort, answer length, context budget and web tools. The model can't change: that would
 * be a different seat.
 */
export function EditSeatDialog({ seat, onClose }: { seat: Seat | null; onClose: () => void }) {
  const { id, state, act, models, standardContextBudget, webTools } = useRoom();
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [effort, setEffort] = useState<ReasoningEffort>("low");
  const [length, setLength] = useState<AnswerLength | null>(null);
  const [budget, setBudget] = useState<ContextBudget | null>(null);
  const [web, setWeb] = useState<WebAccess | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (seat) {
      setName(seat.displayName);
      setPersona(seat.persona ?? "");
      setEffort(seat.reasoningEffort);
      setLength(seat.answerLength);
      setBudget(seat.contextBudget);
      setWeb(seat.webAccess);
    }
  }, [seat]);

  const clash = seat && name.trim() ? seatNameClash(name, state.seats, seat.id) : undefined;
  const info = seat ? models.get(seat.model) : undefined;

  async function save() {
    if (!seat || !name.trim() || clash) return;
    setBusy(true);
    const ok = await act(() =>
      api.updateSeat(id, seat.id, {
        displayName: name.trim(),
        persona: persona.trim() || null,
        reasoningEffort: effort,
        answerLength: length,
        contextBudget: budget,
        webAccess: web,
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
              aria-invalid={!!clash}
              aria-describedby={clash ? "edit-name-error" : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {clash && (
              <p id="edit-name-error" className="text-xs text-destructive">
                {seatNameClashMessage(clash)}
              </p>
            )}
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
            <Label htmlFor="edit-effort">Thinking effort</Label>
            <Select value={effort} onValueChange={(v) => setEffort(v as ReasoningEffort)}>
              <SelectTrigger id="edit-effort" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AnswerLengthSelect
            value={length}
            onChange={setLength}
            roomRule={state.meeting.answerLength}
          />
          <ContextBudgetSelect
            value={budget}
            onChange={setBudget}
            contextWindow={info?.contextWindow ?? null}
            outputCap={maxOutputTokens(
              length ?? state.meeting.answerLength,
              effort,
              info?.maxTokens ?? null,
            )}
            standard={standardContextBudget}
          />
          {(webTools || (web ?? state.meeting.webAccess) !== "off") && (
            <WebAccessSelect value={web} onChange={setWeb} roomRule={state.meeting.webAccess} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim() || !!clash}>
            {busy && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
