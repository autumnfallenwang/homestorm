// Getting files ready in the browser (ADR 0016): images scaled to 2,048 px and re-encoded when large, text files
// read as UTF-8, PDF and Word files turned into text in a Web Worker (ADR 0019). The API checks everything again.

import {
  ATTACHMENT_LIMITS,
  type AttachmentInput,
  IMAGE_MIME_TYPES,
  type ImageMimeType,
  isTextFileName,
} from "@homestorm/shared";
import { documentKind } from "./documents/kind";
import { readDocument } from "./documents/read";

/** A file waiting in the message box or the brief editor. */
export type PendingFile = {
  key: string;
  name: string;
  sizeBytes: number;
} & (
  | { kind: "image"; mime: string; data: string; width: number; height: number; previewUrl: string }
  | { kind: "text"; text: string }
);

/** Kept as they are when already small: a screenshot stays a crisp PNG. */
const KEEP_IMAGE_BYTES = 1_500_000;

let counter = 0;

export async function readFiles(files: File[]): Promise<{ ok: PendingFile[]; errors: string[] }> {
  const ok: PendingFile[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      ok.push(await readFile(file));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `${file.name}: couldn't read it.`);
    }
  }
  return { ok, errors };
}

async function readFile(file: File): Promise<PendingFile> {
  const key = `f${++counter}`;
  const name = file.name || `pasted-${counter}.png`;
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(file.type))
    return readImage(file, key, name);
  if (file.type.startsWith("image/")) {
    throw new Error(`${name}: only PNG, JPEG, WebP and GIF images.`);
  }
  const doc = documentKind(name, file.type);
  if (doc) {
    // Seats get the text, like any text file; the server never opens the PDF or Word file itself.
    const { text } = await readDocument(file, doc, name);
    if (text.length > ATTACHMENT_LIMITS.textFileChars) {
      throw new Error(
        `${name} has ${text.length.toLocaleString("en-US")} characters of text; the limit is ${ATTACHMENT_LIMITS.textFileChars.toLocaleString("en-US")}. Attach the part that matters.`,
      );
    }
    return { key, kind: "text", name, sizeBytes: file.size, text };
  }
  if (file.type.startsWith("text/") || file.type === "application/json" || isTextFileName(name)) {
    const text = await file.text();
    if (text.includes("\u0000")) throw new Error(`${name} isn't a text file.`);
    if (!text.trim()) throw new Error(`${name} is empty.`);
    if (text.length > ATTACHMENT_LIMITS.textFileChars) {
      throw new Error(
        `${name} is ${text.length.toLocaleString("en-US")} characters; the limit is ${ATTACHMENT_LIMITS.textFileChars.toLocaleString("en-US")}.`,
      );
    }
    return { key, kind: "text", name, sizeBytes: file.size, text };
  }
  throw new Error(`${name}: homestorm takes images, text files, PDFs and Word (.docx) files.`);
}

async function readImage(file: File, key: string, name: string): Promise<PendingFile> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, ATTACHMENT_LIMITS.imageMaxSide / Math.max(width, height));
  const keep = file.type === "image/gif" || (scale === 1 && file.size <= KEEP_IMAGE_BYTES);
  if (keep) {
    bitmap.close();
    if (file.size > ATTACHMENT_LIMITS.imageBytes) throw new Error(`${name} is over 5 MB.`);
    const data = await toBase64(file);
    return {
      key,
      kind: "image",
      name,
      mime: file.type,
      data,
      width,
      height,
      sizeBytes: file.size,
      previewUrl: `data:${file.type};base64,${data}`,
    };
  }
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let blob = await toBlob(canvas, 0.85);
  if (blob.size > ATTACHMENT_LIMITS.imageBytes) blob = await toBlob(canvas, 0.65);
  if (blob.size > ATTACHMENT_LIMITS.imageBytes)
    throw new Error(`${name} is too large even scaled down.`);
  const data = await toBase64(blob);
  return {
    key,
    kind: "image",
    name: `${name.replace(/\.[^.]+$/, "")}.webp`,
    mime: "image/webp",
    data,
    width: w,
    height: h,
    sizeBytes: blob.size,
    previewUrl: `data:image/webp;base64,${data}`,
  };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image."))),
      "image/webp",
      quality,
    ),
  );
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("Couldn't read the file."));
    reader.readAsDataURL(blob);
  });
}

export function toAttachmentInputs(files: PendingFile[]): AttachmentInput[] {
  return files.map((f) =>
    f.kind === "image"
      ? { kind: "image", name: f.name, mime: f.mime as ImageMimeType, data: f.data }
      : { kind: "text", name: f.name, text: f.text },
  );
}

/** Files from a paste or a drop. */
export function filesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []);
}

/**
 * Why a brief's files can't be saved, or null (ADR 0016): at most 8 files, 4 images, and 24,000 characters of text
 * files, since every seat gets them on every turn. The API checks the same; this says so before sending.
 */
export function briefFilesProblem(
  files: ReadonlyArray<{ kind: "image" | "text"; textChars: number }>,
): string | null {
  const images = files.filter((f) => f.kind === "image").length;
  const chars = files.reduce((n, f) => n + (f.kind === "text" ? f.textChars : 0), 0);
  if (files.length > ATTACHMENT_LIMITS.perMessage)
    return `At most ${ATTACHMENT_LIMITS.perMessage} files in the brief.`;
  if (images > ATTACHMENT_LIMITS.briefImages)
    return `At most ${ATTACHMENT_LIMITS.briefImages} images in the brief.`;
  if (chars > ATTACHMENT_LIMITS.briefTextFileChars)
    return `Text files in the brief can add up to ${ATTACHMENT_LIMITS.briefTextFileChars.toLocaleString("en-US")} characters: every seat gets them on every turn.`;
  return null;
}

/** A waiting file as `briefFilesProblem` counts it. */
export function pendingForBrief(f: PendingFile): { kind: "image" | "text"; textChars: number } {
  return { kind: f.kind, textChars: f.kind === "text" ? f.text.length : 0 };
}
