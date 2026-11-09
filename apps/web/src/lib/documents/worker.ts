// The Web Worker that reads one PDF or Word file (ADR 0019). In a worker, a slow or hostile file can't freeze the
// page; ./read.ts gives it a time limit and throws it away after each file.

import { DocumentError, docxText, pdfText } from "./extract";
import type { DocumentKind } from "./kind";

export type DocumentJob = { kind: DocumentKind; bytes: ArrayBuffer };
export type DocumentReply =
  | { ok: true; text: string; pages?: number }
  | { ok: false; message: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<DocumentJob>) => void) | null;
  postMessage: (reply: DocumentReply) => void;
};

scope.onmessage = async (e) => {
  const bytes = new Uint8Array(e.data.bytes);
  try {
    const out = e.data.kind === "pdf" ? await pdfText(bytes) : await docxText(bytes);
    scope.postMessage({ ok: true, ...out });
  } catch (err) {
    scope.postMessage({
      ok: false,
      message: err instanceof DocumentError ? err.message : "couldn't be read",
    });
  }
};
