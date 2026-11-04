// Checks attachments before they're saved (ADR 0016). The browser already resized images; this trusts nothing it
// sent: sizes, image bytes and type, text that isn't really text.

import {
  ATTACHMENT_LIMITS,
  type AttachmentInput,
  type AttachmentMeta,
  IMAGE_MIME_TYPES,
  type ImageMimeType,
} from "@homestorm/shared";
import { imageSize } from "image-size";

export class AttachmentError extends Error {
  readonly status = 400;
}

/** A checked attachment, ready to insert (position, ids and the message come from the caller). */
export interface PreparedAttachment {
  kind: "image" | "text";
  name: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  textChars: number | null;
  data: Buffer;
}

const TYPE_TO_MIME: Record<string, ImageMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function prepareAttachments(inputs: AttachmentInput[]): PreparedAttachment[] {
  if (inputs.length > ATTACHMENT_LIMITS.perMessage) {
    throw new AttachmentError(`At most ${ATTACHMENT_LIMITS.perMessage} files per message.`);
  }
  const out = inputs.map((input): PreparedAttachment => {
    const name = input.name.replace(/[\\/\r\n]/g, "_").slice(0, 200);
    if (input.kind === "text") {
      if (input.text.includes("\u0000")) throw new AttachmentError(`${name} isn't a text file.`);
      const data = Buffer.from(input.text, "utf8");
      return {
        kind: "text",
        name,
        mime: "text/plain",
        sizeBytes: data.length,
        width: null,
        height: null,
        textChars: input.text.length,
        data,
      };
    }
    const data = Buffer.from(input.data, "base64");
    if (data.length > ATTACHMENT_LIMITS.imageBytes) {
      throw new AttachmentError(
        `${name} is over ${ATTACHMENT_LIMITS.imageBytes / 1024 / 1024} MB.`,
      );
    }
    let size: { width?: number; height?: number; type?: string };
    try {
      size = imageSize(data);
    } catch {
      throw new AttachmentError(`${name} isn't a readable image.`);
    }
    // The bytes decide the type, not the name or what the browser claimed.
    const mime = size.type ? TYPE_TO_MIME[size.type] : undefined;
    if (
      !mime ||
      !(IMAGE_MIME_TYPES as readonly string[]).includes(mime) ||
      !size.width ||
      !size.height
    ) {
      throw new AttachmentError(`${name}: only PNG, JPEG, WebP and GIF images are supported.`);
    }
    return {
      kind: "image",
      name,
      mime,
      sizeBytes: data.length,
      width: size.width,
      height: size.height,
      textChars: null,
      data,
    };
  });
  const textChars = out.reduce((n, a) => n + (a.textChars ?? 0), 0);
  if (textChars > ATTACHMENT_LIMITS.textCharsPerMessage) {
    throw new AttachmentError(
      `Text files on one message can add up to ${ATTACHMENT_LIMITS.textCharsPerMessage.toLocaleString("en-US")} characters.`,
    );
  }
  return out;
}

/** The brief is never trimmed, so its files have tighter limits (ADR 0016). */
export function checkBriefAttachments(
  kept: Pick<AttachmentMeta, "kind" | "textChars">[],
  added: PreparedAttachment[],
): void {
  const all = [...kept, ...added];
  if (all.length > ATTACHMENT_LIMITS.perMessage) {
    throw new AttachmentError(`The brief can hold at most ${ATTACHMENT_LIMITS.perMessage} files.`);
  }
  if (all.filter((a) => a.kind === "image").length > ATTACHMENT_LIMITS.briefImages) {
    throw new AttachmentError(
      `The brief can hold at most ${ATTACHMENT_LIMITS.briefImages} images.`,
    );
  }
  const chars = all.reduce((n, a) => n + (a.textChars ?? 0), 0);
  if (chars > ATTACHMENT_LIMITS.briefTextFileChars) {
    throw new AttachmentError(
      `Text files in the brief can add up to ${ATTACHMENT_LIMITS.briefTextFileChars.toLocaleString("en-US")} characters: every seat gets them on every turn.`,
    );
  }
}
