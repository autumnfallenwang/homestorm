"use client";

import { BRIEF_MAX_CHARS } from "@homestorm/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMeetings } from "./meetings-context";

/** "New meeting": the chair types the title (automatic titles are out of v1) and, optionally, the brief. */
export function NewMeetingDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { refresh } = useMeetings();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const meeting = await api.createMeeting(title.trim(), brief);
      await refresh();
      setOpen(false);
      setTitle("");
      setBrief("");
      router.push(`/m/${meeting.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the meeting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New meeting</DialogTitle>
            <DialogDescription>What's the meeting about? You'll add seats next.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-title">Title</Label>
            <Input
              id="meeting-title"
              autoFocus
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Cache at the edge or in the API?"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-brief">
              Brief <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="meeting-brief"
              rows={5}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Background and facts every seat should always have. You can change it later."
            />
            <p
              className={cn(
                "text-xs",
                brief.length > BRIEF_MAX_CHARS ? "text-destructive" : "text-muted-foreground",
              )}
            >
              Every seat always sees it; it's never trimmed. {brief.length.toLocaleString("en-US")}{" "}
              / {BRIEF_MAX_CHARS.toLocaleString("en-US")} characters
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !title.trim() || brief.length > BRIEF_MAX_CHARS}
            >
              {busy && <Loader2 className="animate-spin" />}
              Create meeting
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
