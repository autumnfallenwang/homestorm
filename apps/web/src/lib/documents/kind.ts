// Which files are read as documents (ADR 0019). Kept apart from the readers, so knowing a file is a PDF doesn't load
// pdf.js into the page: the readers load only in the Web Worker, when one is attached.

export type DocumentKind = "pdf" | "docx";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A PDF or a .docx, by type or name (browsers often give no type). Old .doc files aren't read. */
export function documentKind(name: string, type: string): DocumentKind | null {
  const lower = name.toLowerCase();
  if (type === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (type === DOCX_TYPE || lower.endsWith(".docx")) return "docx";
  return null;
}

/** What a file chip says about where its text came from. */
export const DOCUMENT_LABEL: Record<DocumentKind, string> = { pdf: "PDF", docx: "Word" };

/** For the paperclip's file picker. */
export const DOCUMENT_ACCEPT = `.pdf,.docx,application/pdf,${DOCX_TYPE}`;
