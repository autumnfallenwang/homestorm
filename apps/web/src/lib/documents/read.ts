// Reads a PDF or Word file into text in the browser (ADR 0019): one Web Worker per file, with a size and a time
// limit, thrown away afterwards. The server only ever gets the text.

import type { DocumentKind } from "./kind";
import type { DocumentJob, DocumentReply } from "./worker";

/** Larger than this isn't read: 20 MB is hundreds of pages, far past what a seat's context takes anyway. */
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
/** Real files take well under a second; this stops one built to be slow. */
export const DOCUMENT_TIMEOUT_MS = 20_000;

export async function readDocument(
  file: File,
  kind: DocumentKind,
  name: string,
): Promise<{ text: string; pages?: number }> {
  if (file.size > DOCUMENT_MAX_BYTES) throw new Error(`${name} is over 20 MB.`);
  const bytes = await file.arrayBuffer();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${name} took too long to read. It may be damaged.`)),
        DOCUMENT_TIMEOUT_MS,
      );
      // Our answer comes on this channel; anything pdf.js posts on the worker itself is ignored (see worker.ts).
      const channel = new MessageChannel();
      channel.port1.onmessage = (e: MessageEvent<DocumentReply>) => {
        clearTimeout(timer);
        channel.port1.close();
        const reply = e.data;
        if (reply.ok) resolve({ text: reply.text, pages: reply.pages });
        else reject(new Error(`${name} ${reply.message}.`));
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        e.preventDefault();
        reject(new Error(`${name} couldn't be read.`));
      };
      const job: DocumentJob = { kind, bytes, reply: channel.port2 };
      worker.postMessage(job, [bytes, channel.port2]);
    });
  } finally {
    worker.terminate();
  }
}
