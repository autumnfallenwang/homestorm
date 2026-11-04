"use client";

import type { AttachmentMeta } from "@homestorm/shared";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Paperclip, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { PendingFile } from "@/lib/attachments";
import { cn } from "@/lib/utils";

/** One file as the galleries and the viewer show it: saved (a URL) or still pending (a data URL or its text). */
interface Shown {
  key: string;
  kind: "image" | "text";
  name: string;
  src?: string;
  text?: string;
  width?: number | null;
  height?: number | null;
  textChars?: number | null;
  /** Saved files open from the API; pending ones only in the viewer. */
  href?: string;
}

export function shownSaved(meetingId: string, files: AttachmentMeta[]): Shown[] {
  return files.map((f) => ({
    key: f.id,
    kind: f.kind,
    name: f.name,
    width: f.width,
    height: f.height,
    textChars: f.textChars,
    src: f.kind === "image" ? api.attachmentUrl(meetingId, f.id) : undefined,
    href: api.attachmentUrl(meetingId, f.id),
  }));
}

export function shownPending(files: PendingFile[]): Shown[] {
  return files.map((f) =>
    f.kind === "image"
      ? {
          key: f.key,
          kind: "image",
          name: f.name,
          src: f.previewUrl,
          width: f.width,
          height: f.height,
        }
      : { key: f.key, kind: "text", name: f.name, text: f.text, textChars: f.text.length },
  );
}

function sizeLabel(f: Shown): string {
  if (f.kind === "image") return f.width && f.height ? `${f.width}×${f.height}` : "image";
  return `${(f.textChars ?? 0).toLocaleString("en-US")} characters`;
}

/**
 * Small thumbnails and file chips (ADR 0016). Click one to see it full size; `onRemove` turns on the ✕ buttons for
 * the message box and the brief editor.
 */
export function AttachmentStrip({
  files,
  onRemove,
  size = "md",
  className,
}: {
  files: Shown[];
  onRemove?: (key: string) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (!files.length) return null;
  const thumb = size === "sm" ? "size-12" : "size-20";
  return (
    <>
      <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Attachments">
        {files.map((f, i) => (
          <li key={f.key} className="relative">
            {f.kind === "image" ? (
              <button
                type="button"
                onClick={() => setOpen(i)}
                title={`${f.name} · ${sizeLabel(f)}`}
                aria-label={`Open ${f.name}`}
                className={cn(
                  "block overflow-hidden rounded-md border bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                  thumb,
                )}
              >
                {/* biome-ignore lint/performance/noImgElement: thumbnails from the API or data URLs, no Next optimizing */}
                <img src={f.src} alt={f.name} className="size-full object-cover" loading="lazy" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setOpen(i)}
                className={cn(
                  "flex max-w-56 items-center gap-2 rounded-md border bg-muted/50 px-2.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                  size === "sm" ? "h-12" : "h-14",
                )}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{f.name}</span>
                  <span className="block text-[0.6875rem] text-muted-foreground">
                    {sizeLabel(f)}
                  </span>
                </span>
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(f.key)}
                aria-label={`Remove ${f.name}`}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-background shadow-sm hover:bg-accent"
              >
                <X className="size-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <FileViewer files={files} index={open} onIndex={setOpen} />
    </>
  );
}

/** Full size: an image fitted to the window, or a text file's text. ← and → move between files. */
function FileViewer({
  files,
  index,
  onIndex,
}: {
  files: Shown[];
  index: number | null;
  onIndex: (i: number | null) => void;
}) {
  const file = index === null ? undefined : files[index];
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    if (file?.kind !== "text") return;
    if (file.text !== undefined) {
      setText(file.text);
      return;
    }
    if (file.href)
      fetch(file.href, { credentials: "include" })
        .then((r) => r.text())
        .then(setText, () => setText("Couldn't load the file."));
  }, [file]);

  const step = (d: number) => index !== null && onIndex((index + d + files.length) % files.length);

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onIndex(null)}>
      <DialogContent
        className="max-h-[92vh] w-[min(96vw,72rem)] max-w-none gap-3 sm:max-w-none"
        onKeyDown={(e) => {
          if (files.length < 2) return;
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
      >
        {file && (
          <>
            <div className="flex items-center gap-2 pr-8">
              <DialogTitle className="truncate text-sm">{file.name}</DialogTitle>
              <DialogDescription className="shrink-0 text-xs">
                {sizeLabel(file)}
                {files.length > 1 && ` · ${(index ?? 0) + 1} of ${files.length}`}
              </DialogDescription>
              {file.href && (
                <a
                  href={file.href}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" />
                  Open original
                </a>
              )}
            </div>
            <div className="relative grid min-h-0 place-items-center">
              {file.kind === "image" ? (
                // biome-ignore lint/performance/noImgElement: full-size view of an uploaded image
                <img
                  src={file.src}
                  alt={file.name}
                  className="max-h-[78vh] max-w-full rounded-md object-contain"
                />
              ) : (
                <pre className="max-h-[78vh] w-full overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                  {text ?? "Loading…"}
                </pre>
              )}
              {files.length > 1 && (
                <>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Previous file"
                    className="absolute top-1/2 left-1 -translate-y-1/2 shadow"
                    onClick={() => step(-1)}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Next file"
                    className="absolute top-1/2 right-1 -translate-y-1/2 shadow"
                    onClick={() => step(1)}
                  >
                    <ChevronRight />
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The paperclip: picks images and text files. */
export function AttachButton({
  onFiles,
  disabled,
  label = "Attach images or text files",
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        disabled && "pointer-events-none opacity-50",
      )}
      title={label}
    >
      <Paperclip className="size-4" />
      <span className="sr-only">{label}</span>
      <input
        type="file"
        multiple
        className="sr-only"
        disabled={disabled}
        accept="image/png,image/jpeg,image/webp,image/gif,text/*,.md,.csv,.json,.log,.yaml,.yml,.toml,.ts,.tsx,.js,.py,.go,.rs,.java,.sql,.sh,.xml,.html,.css"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </label>
  );
}
