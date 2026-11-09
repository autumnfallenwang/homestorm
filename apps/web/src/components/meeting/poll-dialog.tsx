"use client";

import {
  POLL_MAX_OPTIONS,
  POLL_OPTION_MAX_CHARS,
  POLL_QUESTION_MAX_CHARS,
  type Poll,
} from "@homestorm/shared";
import { Loader2, Plus, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useRoom } from "./room-context";

/**
 * A poll (ADR 0020): one question to every active seat, each answering privately in one line (a choice, how sure, and
 * why). With options, seats pick one; without, they answer in a few words of their own.
 */
export function PollDialog({ draft, onClose }: { draft: Poll | null; onClose: () => void }) {
  const { id, state, running, act } = useRoom();
  const asked = state.seats.filter((s) => !s.removedAt && !s.muted);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setQuestion(draft.question);
    setOptions(draft.options.length ? draft.options : ["", ""]);
  }, [draft]);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const duplicate = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;
  const problem = !question.trim()
    ? null
    : duplicate
      ? "The options must differ."
      : filled.length === 1
        ? "Give at least two options, or none for answers in the seats' own words."
        : null;

  async function ask() {
    if (!question.trim() || problem) return;
    setBusy(true);
    const ok = await act(() => api.poll(id, { question: question.trim(), options: filled }));
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Poll</DialogTitle>
          <DialogDescription>
            Every active seat answers privately, in one line: its choice, how sure it is, and why.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="poll-question">Question</Label>
          <Textarea
            id="poll-question"
            rows={2}
            autoFocus
            value={question}
            maxLength={POLL_QUESTION_MAX_CHARS}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Which drives should we buy this month?"
          />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">
            Options <span className="font-normal text-muted-foreground">(optional)</span>
          </legend>
          {options.map((o, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place; the index is the row
            <div key={i} className="flex items-center gap-1.5">
              <Input
                aria-label={`Option ${i + 1}`}
                value={o}
                maxLength={POLL_OPTION_MAX_CHARS}
                onChange={(e) =>
                  setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))
                }
                placeholder={`Option ${i + 1}`}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label={`Remove option ${i + 1}`}
                onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            {options.length < POLL_MAX_OPTIONS && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setOptions((list) => [...list, ""])}
              >
                <Plus className="size-3.5" />
                Add option
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              None: each seat answers in a few words of its own.
            </p>
          </div>
        </fieldset>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={ask}
            disabled={busy || running || !question.trim() || !!problem || !asked.length}
          >
            {busy && <Loader2 className="animate-spin" />}
            Ask {asked.length} seat{asked.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
