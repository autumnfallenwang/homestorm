"use client";

import { BRIEF_MAX_CHARS, briefAt } from "@homestorm/shared";
import { FileText, Loader2, Pencil } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useRoom } from "./room-context";

/** The meeting brief as it stands now (ADR 0015). */
export function useCurrentBrief(): string {
  const { state } = useRoom();
  return briefAt(state.messages, state.meeting.clock);
}

/** Pinned at the top of the meeting: the standing context every seat always sees. */
export function BriefCard() {
  const { openBrief } = useRoom();
  const brief = useCurrentBrief();
  const [open, setOpen] = useState(false);
  if (!brief) {
    return (
      <button
        type="button"
        onClick={() => openBrief()}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
      >
        <FileText className="size-3.5 shrink-0" />
        Add a meeting brief: background and facts every seat always sees, never trimmed.
      </button>
    );
  }
  return (
    <section aria-label="Meeting brief" className="rounded-lg border bg-muted/40 px-3 py-2.5">
      <header className="flex items-center gap-2">
        <FileText className="size-3.5 text-muted-foreground" />
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Meeting brief
        </h2>
        <span className="text-xs text-muted-foreground">· every seat always sees this</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 gap-1 px-2 text-xs"
          onClick={() => openBrief()}
        >
          <Pencil className="size-3" />
          Edit
        </Button>
      </header>
      <p className={cn("mt-1.5 text-sm whitespace-pre-wrap", !open && "line-clamp-4")}>{brief}</p>
      {brief.split("\n").length > 4 || brief.length > 320 ? (
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
    </section>
  );
}

/** Edit the brief. `draft` pre-fills it, e.g. with a wrap-up to copy in; the chair edits before saving. */
export function BriefDialog({ draft, onClose }: { draft: string | null; onClose: () => void }) {
  const { id, act } = useRoom();
  const current = useCurrentBrief();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (draft !== null) setText(draft);
  }, [draft]);

  const over = text.length > BRIEF_MAX_CHARS;
  const unchanged = text.trim() === current;

  async function save() {
    if (over || unchanged) return;
    setBusy(true);
    const ok = await act(() => api.setBrief(id, text));
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Meeting brief</DialogTitle>
          <DialogDescription>
            Background, facts and constraints for the whole meeting. Every seat gets it at the top
            of its instructions, and it's never trimmed. When you change it, seats are told.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Meeting brief"
          rows={14}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. One-node k3s cluster on a desktop; local-path storage; five apps with their own Postgres; no backups yet."
          className="font-mono text-xs"
        />
        <p className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")}>
          {text.length.toLocaleString("en-US")} / {BRIEF_MAX_CHARS.toLocaleString("en-US")}{" "}
          characters
          {over && ": too long. Shorten it so it fits every seat's context."}
          {!text.trim() && current && " · Saving it empty clears the brief."}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || over || unchanged}>
            {busy && <Loader2 className="animate-spin" />}
            {!text.trim() && current ? "Clear brief" : "Save brief"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
