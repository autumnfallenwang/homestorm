"use client";

import { ATTACHMENT_LIMITS, BRIEF_MAX_CHARS } from "@homestorm/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { AttachButton, AttachmentStrip, shownPending } from "@/components/meeting/attachments";
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
import {
  briefFilesProblem,
  filesFrom,
  type PendingFile,
  pendingForBrief,
  readFiles,
  toAttachmentInputs,
} from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { useMeetings } from "./meetings-context";

/**
 * "New meeting": the chair types the title (automatic titles are out of v1) and, optionally, the brief with its images
 * and text files, which used to need a second step in the brief editor.
 */
export function NewMeetingDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { refresh } = useMeetings();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileProblem = briefFilesProblem(files.map(pendingForBrief));

  async function addFiles(list: File[]) {
    const { ok, errors } = await readFiles(list);
    setFiles((f) => [...f, ...ok]);
    setFileError(errors.join(" ") || null);
  }

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const meeting = await api.createMeeting(title.trim(), brief, toAttachmentInputs(files));
      await refresh();
      setOpen(false);
      setTitle("");
      setBrief("");
      setFiles([]);
      setFileError(null);
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
              onPaste={(e) => {
                const pasted = filesFrom(e.clipboardData);
                if (!pasted.length) return;
                e.preventDefault();
                void addFiles(pasted);
              }}
              onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
              onDrop={(e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                void addFiles(filesFrom(e.dataTransfer));
              }}
              placeholder="Background and facts every seat should always have. You can change it later."
            />
            <AttachmentStrip
              files={shownPending(files)}
              size="sm"
              onRemove={(key) => setFiles((f) => f.filter((x) => x.key !== key))}
            />
            <div className="flex items-start gap-2">
              <AttachButton
                onFiles={(f) => void addFiles(f)}
                label="Add images or text files to the brief"
              />
              <p
                className={cn(
                  "pt-1 text-xs",
                  brief.length > BRIEF_MAX_CHARS || fileProblem || fileError
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                Every seat always sees it; it's never trimmed.{" "}
                {brief.length.toLocaleString("en-US")} / {BRIEF_MAX_CHARS.toLocaleString("en-US")}{" "}
                characters
                {(fileProblem || fileError) && ` · ${fileProblem ?? fileError}`}
                {!fileProblem &&
                  !fileError &&
                  ` · up to ${ATTACHMENT_LIMITS.briefImages} images and ${ATTACHMENT_LIMITS.briefTextFileChars.toLocaleString("en-US")} characters of text files`}
              </p>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !title.trim() || brief.length > BRIEF_MAX_CHARS || !!fileProblem}
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
