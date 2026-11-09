// The Web Worker that reads one PDF or Word file (ADR 0019). In a worker, a slow or hostile file can't freeze the
// page; ./read.ts gives it a time limit and throws it away after each file.

import { DocumentError, docxText, pdfText } from "./extract";
import type { DocumentKind } from "./kind";

/**
 * The reply goes back on its own port, not on the worker itself: pdf.js, finding itself in a worker, sets itself up
 * as a pdf.js worker on `self` and posts its own messages there ("quote.pdf undefined" on the cluster, 2026-11-08).
 */
export type DocumentJob = { kind: DocumentKind; bytes: ArrayBuffer; reply: MessagePort };
export type DocumentReply =
  | { ok: true; text: string; pages?: number }
  | { ok: false; message: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<DocumentJob>) => void) | null;
};

scope.onmessage = async (e) => {
  const { kind, reply } = e.data ?? {};
  if (!(reply instanceof MessagePort)) return; // not ours
  const send = (r: DocumentReply) => reply.postMessage(r);
  const bytes = new Uint8Array(e.data.bytes);
  try {
    const out = kind === "pdf" ? await pdfText(bytes) : await docxText(bytes);
    send({ ok: true, ...out });
  } catch (err) {
    send({ ok: false, message: err instanceof DocumentError ? err.message : "couldn't be read" });
  } finally {
    reply.close();
  }
};
