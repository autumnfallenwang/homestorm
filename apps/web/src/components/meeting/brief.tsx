"use client";

import { ATTACHMENT_LIMITS, BRIEF_MAX_CHARS, briefAt, type Message } from "@homestorm/shared";
import { FilePlus, FileText, Loader2, Pencil, X } from "lucide-react";
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
import {
  briefFilesProblem,
  filesFrom,
  type PendingFile,
  pendingForBrief,
  readFiles,
  toAttachmentInputs,
} from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { AttachButton, AttachmentStrip, shownPending, shownSaved } from "./attachments";
import { useRoom } from "./room-context";

/** The meeting brief as it stands now (ADR 0015). */
export function useCurrentBrief(): string {
  const { state } = useRoom();
  return briefAt(state.messages, state.meeting.clock);
}

/** The current brief version, with its files (ADR 0016). */
export function useCurrentBriefMessage(): Message | undefined {
  const { state } = useRoom();
  return state.messages
    .filter((m) => m.authorKind === "brief" && m.visibleSeq !== null)
    .sort((a, b) => (a.visibleSeq ?? 0) - (b.visibleSeq ?? 0))
    .at(-1);
}

/**
 * The header's Brief button. With a brief, it shows or hides the brief under the header; without one, it opens the
 * editor.
 */
export function BriefButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { openBrief } = useRoom();
  const brief = useCurrentBrief();
  const files = useCurrentBriefMessage()?.attachments ?? [];
  if (!brief && !files.length) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-muted-foreground"
        aria-label="Add a meeting brief"
        title="Add a meeting brief: background, facts, images or files every seat always sees, never trimmed"
        onClick={() => openBrief()}
      >
        <FilePlus />
        <span className="hidden sm:inline">Add brief</span>
      </Button>
    );
  }
  return (
    <Button
      variant={shown ? "secondary" : "outline"}
      size="sm"
      className="h-8"
      aria-label="Meeting brief"
      aria-expanded={shown}
      aria-controls="meeting-brief"
      title={shown ? "Hide the meeting brief" : "Show the meeting brief"}
      onClick={onToggle}
    >
      <FileText />
      <span className="hidden sm:inline">Brief</span>
    </Button>
  );
}

/**
 * The standing context every seat always sees, pinned under the header while it's shown, so it never scrolls away
 * with the transcript.
 */
export function BriefPanel({ onClose }: { onClose: () => void }) {
  const { id, openBrief } = useRoom();
  const brief = useCurrentBrief();
  const files = useCurrentBriefMessage()?.attachments ?? [];
  if (!brief && !files.length) return null;
  return (
    <section id="meeting-brief" aria-label="Meeting brief" className="border-b bg-muted/40">
      <div className="mx-auto max-w-3xl px-4 py-2.5">
        <header className="flex items-center gap-2">
          <FileText className="size-3.5 text-muted-foreground" />
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Meeting brief
          </h2>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            · every seat always sees this
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 gap-1 px-2 text-xs"
            onClick={() => openBrief()}
          >
            <Pencil className="size-3" />
            Edit
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            aria-label="Hide the meeting brief"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </header>
        <div className="mt-1.5 max-h-[40vh] overflow-y-auto">
          {brief && <p className="text-sm whitespace-pre-wrap">{brief}</p>}
          <AttachmentStrip
            files={shownSaved(id, files)}
            size="sm"
            className={brief ? "mt-2" : undefined}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Edit the brief and its files. `draft` pre-fills the text, e.g. with a wrap-up to copy in; the chair edits before
 * saving. The current files stay unless removed here.
 */
export function BriefDialog({ draft, onClose }: { draft: string | null; onClose: () => void }) {
  const { id, act } = useRoom();
  const current = useCurrentBrief();
  const currentFiles = useCurrentBriefMessage()?.attachments ?? [];
  const [text, setText] = useState("");
  const [keep, setKeep] = useState<string[]>([]);
  const [added, setAdded] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: opening the dialog resets it from the current brief
  useEffect(() => {
    if (draft === null) return;
    setText(draft);
    setKeep(currentFiles.map((f) => f.id));
    setAdded([]);
    setFileError(null);
  }, [draft]);

  const kept = currentFiles.filter((f) => keep.includes(f.id));
  const fileProblem = briefFilesProblem([
    ...kept.map((f) => ({ kind: f.kind, textChars: f.textChars ?? 0 })),
    ...added.map(pendingForBrief),
  ]);
  const over = text.length > BRIEF_MAX_CHARS;
  const sameFiles = !added.length && kept.length === currentFiles.length;
  const unchanged = text.trim() === current && sameFiles;
  const empty = !text.trim() && !kept.length && !added.length;

  async function addFiles(list: File[]) {
    const { ok, errors } = await readFiles(list);
    setAdded((a) => [...a, ...ok]);
    setFileError(errors.join(" ") || null);
  }

  async function save() {
    if (over || unchanged || fileProblem) return;
    setBusy(true);
    const ok = await act(() =>
      api.setBrief(id, text, { keepAttachmentIds: keep, attachments: toAttachmentInputs(added) }),
    );
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Meeting brief</DialogTitle>
          <DialogDescription>
            Background, facts, images and files for the whole meeting. Every seat gets it on every
            turn, and it's never trimmed. When you change it, seats are told.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Meeting brief"
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
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
          placeholder="e.g. One-node k3s cluster on a desktop; local-path storage; five apps with their own Postgres; no backups yet."
          className="font-mono text-xs"
        />
        <AttachmentStrip
          files={[...shownSaved(id, kept), ...shownPending(added)]}
          size="sm"
          onRemove={(key) => {
            setKeep((k) => k.filter((x) => x !== key));
            setAdded((a) => a.filter((x) => x.key !== key));
          }}
        />
        <div className="flex items-start gap-2">
          <AttachButton
            onFiles={(f) => void addFiles(f)}
            label="Add images or text files to the brief"
          />
          <p
            className={cn(
              "pt-1 text-xs",
              over || fileProblem || fileError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {text.length.toLocaleString("en-US")} / {BRIEF_MAX_CHARS.toLocaleString("en-US")}{" "}
            characters
            {over && ": too long. Shorten it so it fits every seat's context."}
            {(fileProblem || fileError) && ` · ${fileProblem ?? fileError}`}
            {!fileProblem &&
              !fileError &&
              ` · up to ${ATTACHMENT_LIMITS.briefImages} images and ${ATTACHMENT_LIMITS.briefTextFileChars.toLocaleString("en-US")} characters of text files; paste or drop them in`}
            {empty && current && " · Saving it empty clears the brief."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || over || unchanged || !!fileProblem}>
            {busy && <Loader2 className="animate-spin" />}
            {empty && (current || currentFiles.length) ? "Clear brief" : "Save brief"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
