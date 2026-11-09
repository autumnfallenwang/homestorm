// Text out of a PDF or a Word file (ADR 0019). Runs in a Web Worker in the browser (./worker.ts), so the server never
// parses either format. No DOM here, so the tests run it under Node as well.

import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export interface DocumentText {
  text: string;
  /** PDFs only. */
  pages?: number;
}

/** Why a document gave no text. Shown to the chair as it is. */
export class DocumentError extends Error {}

/**
 * Each page's text, marked "[Page N]" when there's more than one, so seats can say where something is. A PDF with no
 * text at all is most likely a scan, which would need OCR.
 */
export async function pdfText(bytes: Uint8Array): Promise<DocumentText> {
  if (!startsWith(bytes, "%PDF-")) throw new DocumentError("isn't a PDF");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch {
    throw new DocumentError("couldn't be opened; it may be damaged or password-protected");
  }
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((t) => tidy(t));
    if (!pages.some(Boolean)) {
      throw new DocumentError("has no text to read; it may be a scan");
    }
    const joined =
      pages.length === 1
        ? pages[0]
        : pages.map((t, i) => `[Page ${i + 1}]\n${t || "(no text)"}`).join("\n\n");
    return { text: joined, pages: totalPages };
  } finally {
    // The worker is thrown away after each file anyway; this frees memory sooner, and never hides the real error.
    await pdf.loadingTask.destroy().catch(() => {});
  }
}

/** The document's text, without formatting. Tables come out one cell per line. */
export async function docxText(bytes: Uint8Array): Promise<DocumentText> {
  if (!startsWith(bytes, "PK")) throw new DocumentError("isn't a Word (.docx) file");
  let raw: string;
  try {
    // The browser build of mammoth reads `arrayBuffer`, the Node build `buffer`; both take the same bytes.
    const input = { arrayBuffer: toArrayBuffer(bytes), buffer: bytes };
    raw = (await mammoth.extractRawText(input as unknown as { arrayBuffer: ArrayBuffer })).value;
  } catch {
    throw new DocumentError("couldn't be opened; it may be damaged");
  }
  const text = tidy(raw);
  if (!text) throw new DocumentError("has no text in it");
  return { text };
}

/** Zero-width spaces and joiners, direction marks, the word joiner and the byte-order mark: invisible, and they split
 * words for the model. Built from code points so the source has no invisible characters itself. */
const INVISIBLE = new RegExp(
  `[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200f)}${String.fromCharCode(0x2060, 0xfeff)}]`,
  "g",
);

/** Readable text: no NULs (the API refuses them), no invisible characters, at most one blank line in a row. */
export function tidy(text: string): string {
  return text
    .replaceAll(String.fromCharCode(0), "")
    .replace(INVISIBLE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function startsWith(bytes: Uint8Array, magic: string): boolean {
  return [...magic].every((c, i) => bytes[i] === c.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
