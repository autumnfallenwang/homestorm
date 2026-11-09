# 0016: Attachments: images and text files on messages and the brief

- **Status:** accepted (phase 1 of 3)
- **Date:** 2026-11-04

## Context

- Chat apps take images and files in the message box: picked, dragged in or pasted.
  - **claude.ai and ChatGPT:** both, with multiple files per message.
  - **LibreChat:** upload as text (the whole file in context) or file search (RAG).
  - **Open WebUI:** focused retrieval or the entire document.
- **Tested through llmgw** on 2026-11-04 with generated images. Images work as `image_url` parts (data URLs), several
  per message, streamed or not:
  - **natively:** Claude, GPT (Go plan models) and DeepSeek Flash;
  - **text-only DeepSeek V4 Pro:** llmgw's vision fallback gets **a text description** from another model, and the
    model sees only that.
  - **Resizing:** llmgw scales images to at most 2,048 px and 5 MB.
  - **No `file` part:** a `{"type": "file"}` part is a 400, so text files have to become text in homestorm.
- **A meeting re-sends its record to every seat on every turn,** so an image costs tokens per seat per turn.
  Measured: 640×360 is about 355 tokens on Claude and 324 on GPT; 2048×1152 is about 3,100 and 2,800.

## Decision

**Phase 1: images and text files on the chair's messages and in the meeting brief.**

1. **What's accepted:**
   - **images:** PNG, JPEG, WebP and GIF, but no SVG, which is code that a browser would run;
   - **text files:** txt, md, csv, json, logs, config and code, about 50 extensions
     (`TEXT_FILE_EXTENSIONS`).
2. **Getting files in:** the paperclip, dragging onto the message box, or pasting a screenshot into it. The brief
   editor takes the same three.
3. **In the browser:**
   - **images over 2,048 px or 1.5 MB** are scaled down and saved as WebP; smaller ones, such as screenshots, stay
     as they are;
   - **text files** are read as UTF-8, and binary files are refused.
4. **On the server,** nothing from the browser is trusted:
   - the image bytes decide the type and the size (`image-size`);
   - text containing NUL is refused;
   - limits: 8 files per message, 5 MB per image, 100,000 characters per text file and 200,000 per message;
   - files ride in the action's JSON as base64, so those routes allow a 64 MB body.
5. **Storage:**
   - a table `attachments` (bytes in `bytea`), tied to the message and deleted with the meeting;
   - nothing is ever changed once saved;
   - **a new brief version copies the files it keeps,** so every version stays whole and Retry repeats it exactly.
6. **What a seat gets:**
   - **Text files go inline** in the message as `<file name="notes.md">…</file>`.
   - **Images go as `image_url` parts.** Each image-carrying message is its own user message, with a label **after**
     the images: "(The images above, in order: a.png, b.png.)".
     - **Why after:** llmgw puts a text-only seat's `[Image description: …]` at the start of the message, so the
       label then reads right for every seat.
     - **Why separate:** llmgw describes each message's images together, so mixing sources in one message blurred
       them. Every family takes back-to-back user messages.
   - **The brief's text files go in the intro; its images open the conversation.**
     - The brief images form the first user message, labeled "(The image above is from the meeting brief: …)".
     - They're never trimmed: Claude takes no images in the system prompt, so this is the next best place.
7. **Budgets:**
   - each image counts `width × height ÷ 750 + 60` tokens, after scaling to 2,048 px (`imageTokens`);
   - images in trimmed turns are dropped with their turn.
8. **The brief stays small:** at most 4 images and 24,000 characters of text files, since every seat gets it on
   every turn.
9. **What the chair sees:**
   - **Thumbnails:** about 80 px in the chat, about 48 px in the brief panel and the editors. Text files show as chips
     with their name and size.
   - **The full-size viewer:**
     - **click any file:** images open fitted to the window and are never stretched; text files open as their text;
     - **moving between files:** ← and → or the buttons, with "1 of 3" shown;
     - **Open original** opens the stored file.
   - **A text-only seat gets a hint in the message box:** "DeepSeek V4 Pro can't see images: llmgw gives it a text
     description written by another model." It reads llmgw's `/v1/models` `input` (0.6.0+). `TEXT_ONLY_MODELS` is
     only the fallback for an older llmgw.
   - **Serving files:**
     - text files are always served as `text/plain`, so an uploaded `.html` can't run as a page;
     - every file gets `X-Content-Type-Options: nosniff`.
10. **The export:**
    - images are listed by name and size;
    - text files are included whole in fenced blocks;
    - the brief's files sit under "Meeting brief".

**Later phases:**

| Phase | What |
|---|---|
| 2 | PDF and DOCX as text, read in the browser instead of on the server: [ADR 0019](0019-pdf-and-word-files-read-in-the-browser.md), built 2026-11-08 |
| 3 | Large documents through retrieval instead of inline (mcpgw's planned `docs_search`, ADR 0014) |

## Alternatives considered

- **Upload first, then send IDs.** Rejected for now: it leaves orphaned uploads to clean up. One JSON request per
  message is simpler at home scale.
- **Images in the system prompt for the brief.** Rejected: Claude's API takes only text there.
- **homestorm describing images itself for text-only seats.** Rejected: llmgw already has a vision fallback. The
  separate messages and the labels make its descriptions work, and it's better improved there (see Consequences).
- **Storing files on a volume instead of in Postgres.** Rejected for now: the database already has the meeting's
  lifecycle (deleted together, one backup to set up).

## Consequences

- **Database size:** images go in the meeting database, about 0.3–1 MB each after resizing. It's backed up nightly
  since 2026-11-07 (a `pg_dump` CronJob in the chart, newest 14 kept, on the same disk; `scripts/backup.sh`).
- **Cost:** every image is re-sent to every seat on every turn. The context meter counts it.
- **Text-only seats are slower:** llmgw re-describes the images on every turn (the first V4 Pro turn took 23 s),
  and the quality depends on the describing model.
- **llmgw follow-ups, done in llmgw 0.6.0 (2026-11-04):**
  - each image is described on its own, in place, and cached for 30 days by its bytes;
  - a message's text parts are joined with a blank line;
  - `/v1/models` has `input`;
  - DeepSeek's describer is `deepseek-flash`.

  Checked live: the case that had failed (brief and question images in one message) now answers right, and a
  repeat call used the cache (0 ms, no cost). homestorm keeps its separate image messages and after-image labels:
  they cost nothing and let every seat refer to images by name.
