# 0019: PDF and Word files, read in the browser

- **Status:** accepted, built 2026-11-08
- **Date:** 2026-11-08

## Context

- **Attachments phase 2** ([ADR 0016](0016-attachments-images-and-text-files.md)): the chair attaches PDFs and Word
  files, and seats read them. Phase 1 took images and text files only.
- **Parsing them is the risky part.** mcpgw found that a 0.2 MB PDF whose stream inflates to 256 MB took its process
  to 626 MB, past the pod's limit, so one small file could restart it for everyone (mcpgw ADR 0011). It now reads PDFs
  in capped workers with a memory watch. A .docx is a zip, with the same kind of risk.
- **homestorm's API runs the meetings.** A file that restarts it stops every round in progress.
- **Where it could run:**
  - **homestorm's API:** it would need mcpgw's worker pool and memory watch copied in.
  - **mcpgw:** it has that protection, but its tools are for models fetching URLs, and it can't reach homestorm (its
    ADR 0006). Files would go to it in the request, and attaching a PDF would fail whenever it's down. It reads PDFs
    only.
  - **The chair's browser,** where images are already resized before upload (ADR 0016).

## Decision

**The browser turns a PDF or a .docx into text, and it's attached as a text file.**

- **Where:** a Web Worker per file (`apps/web/src/lib/documents/`). In a worker, a slow file can't freeze the page;
  after 20 seconds it's thrown away, and so is every worker once its file is read. Files over 20 MB aren't read.
- **Readers:**
  - **PDF:** `unpdf`, the dependency-free pdf.js build mcpgw uses. Text only, nothing drawn.
  - **Word:** `mammoth`'s raw text. Old `.doc` files aren't read.
  - Both are pinned to exact versions at least two weeks old (`unpdf` 1.9.1, `mammoth` 1.13.0). They load only in the
    worker, when one of these files is attached, so the app doesn't get heavier.
- **What seats get:** the text, like any text file (`<file name="report.pdf">…</file>`). A PDF with more than one page
  is marked "[Page N]", so seats can say where something is.
- **Limits:** a document's text counts as a text file: 100,000 characters per file, and the brief's 24,000 in all.
- **Refused, with the reason shown:** a PDF with no text ("it may be a scan", since that would need OCR), a damaged or
  password-protected file, and a file that isn't what its name says.
- **The chip** says "text from PDF" or "text from Word", since the original file isn't kept.
- **The API doesn't change.** It gets a text file, checks it as it does any other, and never parses PDF or Word.

## Alternatives considered

- **In homestorm's API, with mcpgw's worker pool copied in.** Rejected: the risk sits next to the meetings, and it's
  a second copy of tricky code to keep right.
- **A tool in mcpgw.** Rejected for now: it would change mcpgw from tools for models into a service for apps,
  uploads would depend on it running, and the files would cross the network for text the browser can get itself.
  Phase 3 (retrieval for large documents through mcpgw's planned `docs_search`) is where documents would live there.
- **Keeping the original file** for download. Not now: the text is what seats use, and a stored PDF would need care
  when served from the API's origin.

## Consequences

- **The server never opens a PDF or a Word file.** A hostile one can at worst crash the chair's own tab.
- **A large file takes a moment** in the browser before it shows in the message box.
- **Only the text is kept.** A scan, a chart inside a PDF, or a table's layout is lost; a picture of a page can still
  go in as an image.
- **Phase 3** is still retrieval, for documents past the text limits.
