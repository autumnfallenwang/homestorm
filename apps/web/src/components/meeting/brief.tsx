"use client";

import { ATTACHMENT_LIMITS, BRIEF_MAX_CHARS, briefAt, type Message } from "@homestorm/shared";
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
import { filesFrom, type PendingFile, readFiles, toAttachmentInputs } from "@/lib/attachments";
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

/** Pinned at the top of the meeting: the standing context every seat always sees. */
export function BriefCard() {
  const { id, openBrief } = useRoom();
  const brief = useCurrentBrief();
  const files = useCurrentBriefMessage()?.attachments ?? [];
  const [open, setOpen] = useState(false);
  if (!brief && !files.length) {
    return (
      <button
        type="button"
        onClick={() => openBrief()}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
      >
        <FileText className="size-3.5 shrink-0" />
        Add a meeting brief: background, facts, images or files every seat always sees, never
        trimmed.
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
      {brief && (
        <p className={cn("mt-1.5 text-sm whitespace-pre-wrap", !open && "line-clamp-4")}>{brief}</p>
      )}
      {brief.split("\n").length > 4 || brief.length > 320 ? (
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
      <AttachmentStrip files={shownSaved(id, files)} size="sm" className="mt-2" />
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
  const images =
    kept.filter((f) => f.kind === "image").length + added.filter((f) => f.kind === "image").length;
  const fileChars =
    kept.reduce((n, f) => n + (f.textChars ?? 0), 0) +
    added.reduce((n, f) => n + (f.kind === "text" ? f.text.length : 0), 0);
  const tooMany = kept.length + added.length > ATTACHMENT_LIMITS.perMessage;
  const fileProblem = tooMany
    ? `At most ${ATTACHMENT_LIMITS.perMessage} files in the brief.`
    : images > ATTACHMENT_LIMITS.briefImages
      ? `At most ${ATTACHMENT_LIMITS.briefImages} images in the brief.`
      : fileChars > ATTACHMENT_LIMITS.briefTextFileChars
        ? `Text files in the brief can add up to ${ATTACHMENT_LIMITS.briefTextFileChars.toLocaleString("en-US")} characters: every seat gets them on every turn.`
        : null;
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
