// Attachments on chair messages and on the meeting brief (ADR 0016): images and text files.

import { z } from "zod";

/** What llmgw takes as images. No SVG: it's code, and a browser would run it when opened. */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const ATTACHMENT_KINDS = ["image", "text"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_LIMITS = {
  /** Files on one message, or in the brief. */
  perMessage: 8,
  /** One image after the browser's resize (Anthropic's limit; llmgw enforces the same). */
  imageBytes: 5 * 1024 * 1024,
  /** The browser scales images down to this longest side; llmgw does the same. */
  imageMaxSide: 2048,
  /** One text file. About 33k tokens. */
  textFileChars: 100_000,
  /** All text files on one message together. */
  textCharsPerMessage: 200_000,
  /** The brief is never trimmed, so it stays small: images and text files in it. */
  briefImages: 4,
  briefTextFileChars: 24_000,
} as const;

export const AttachmentInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    name: z.string().trim().min(1).max(200),
    mime: z.enum(IMAGE_MIME_TYPES),
    /** Base64, no `data:` prefix. */
    data: z
      .string()
      .min(1)
      .max(Math.ceil((ATTACHMENT_LIMITS.imageBytes * 4) / 3) + 8),
  }),
  z.object({
    kind: z.literal("text"),
    name: z.string().trim().min(1).max(200),
    text: z.string().min(1).max(ATTACHMENT_LIMITS.textFileChars),
  }),
]);
export type AttachmentInput = z.infer<typeof AttachmentInput>;

/** An attachment as the API and the web see it; the bytes are fetched separately. */
export interface AttachmentMeta {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  textChars: number | null;
}

/**
 * Rough prompt tokens for one image, for budgets (ADR 0016). Measured through llmgw on 2026-11-04: 640×360 cost 355
 * tokens on Claude and 324 on GPT; 2048×1152 about 3,100 and 2,800. `width × height ÷ 750 + 60` errs a little high.
 * Sizes are scaled to llmgw's 2,048-px limit first.
 */
export function imageTokens(width: number, height: number): number {
  const scale = Math.min(1, ATTACHMENT_LIMITS.imageMaxSide / Math.max(width, height, 1));
  return Math.ceil((width * scale * height * scale) / 750) + 60;
}

/**
 * Models that can't read images, for an llmgw older than 0.6.0, whose /v1/models doesn't say. llmgw sends these a
 * text description written by another model instead (its vision fallback).
 */
export const TEXT_ONLY_MODELS: readonly string[] = ["deepseek-v4-pro"];

/** Whether a model reads images itself: llmgw's `input` when it gives one, else the list above. */
export function readsImages(model: string, info?: { input: ("text" | "image")[] | null }): boolean {
  if (info?.input) return info.input.includes("image");
  return !TEXT_ONLY_MODELS.includes(model);
}

/** Text files the message box and the brief take, by extension (browsers often give them no MIME type). */
export const TEXT_FILE_EXTENSIONS = [
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "log",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "env",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "sql",
  "graphql",
  "proto",
  "tf",
  "dockerfile",
  "makefile",
  "gitignore",
  "diff",
  "patch",
] as const;

export function isTextFileName(name: string): boolean {
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : lower;
  return (TEXT_FILE_EXTENSIONS as readonly string[]).includes(ext);
}
