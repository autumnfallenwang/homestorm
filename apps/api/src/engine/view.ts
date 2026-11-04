// buildView: one seat's view of the shared transcript (ADR 0004). A pure function of saved state, so it's tested
// directly (view.test.ts). The rules:
//
// 1. Own messages stay `assistant`.
// 2. Everyone else's become `user`, with a speaker tag: "[Chair]: …", "[GPT-6 Luna]: …".
// 3. Back-to-back messages of the same role are merged, since some providers reject two in a row.
// 4. The intro comes first (the system prompt).
// 5. Only ever add at the end: messages are ordered by when they entered the shared record (visible_seq), so a
//    message that becomes visible later always lands after everything the seat saw before. The floor note, the
//    only part that changes from turn to turn, goes last.
// 6. Visibility (ADR 0005): a seat sees the messages that entered the record before its turn started
//    (visible_seq <= cutoff_seq). Comments ("events"), unfinished answers and unposted minutes are never shown.
// 7. Long meetings (ADR 0015): over budget, turns are dropped from the middle. Never dropped: the intro (with the
//    meeting brief), the first chair message, the latest posted wrap-up, the newest message and the floor note.
//    Turns before that wrap-up go first, since it summarizes them.
// 8. An answer the chair stopped and kept ends with a note saying so, so it isn't read as a finished answer.

import {
  type AnswerLength,
  briefAt,
  imageTokens,
  type Message,
  type Seat,
  seatAnswerLength,
  type WrapKind,
} from "@homestorm/shared";
import {
  ATTACHMENTS_ONLY,
  BRIEF_CLEARED_NOTE,
  BRIEF_UPDATED_NOTE,
  briefImagesNote,
  CUT_OFF_NOTE,
  type Floor,
  imagesNote,
  MEETING_STARTED,
  type RosterEntry,
  renderFloorNote,
  renderIntro,
  trimmedNote,
} from "./prompts.js";
import { budgetTokens, MESSAGE_OVERHEAD_TOKENS } from "./tokens.js";

/** OpenAI-style content parts, as llmgw takes them (ADR 0016). */
export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** Plain text, or parts when the message carries images. */
  content: string | ChatPart[];
}

/** An attachment as a view needs it: an image as a data URL, a text file as its text. */
export interface ViewAttachment {
  kind: "image" | "text";
  name: string;
  width: number | null;
  height: number | null;
  url?: string;
  text?: string;
}

export interface ViewInput {
  meeting: { title: string; answerLength: AnswerLength };
  /** Every seat of the meeting, removed ones included (their old messages need a name). */
  seats: Seat[];
  /** Every message of the meeting. */
  messages: Message[];
  /** The seat about to speak. */
  seat: Seat;
  /** The meeting clock when this turn started. */
  cutoffSeq: number;
  floor: Floor;
  /** Most tokens the whole view may use (ADR 0012). */
  budget: number;
  /** Attachments by message id, chair messages and brief versions (ADR 0016). */
  attachments?: Map<string, ViewAttachment[]>;
}

export interface View {
  messages: ChatMessage[];
  /** How many older messages were left out to fit the budget. */
  trimmedCount: number;
  /** The view's size by the budget estimate, images included. */
  estimatedTokens: number;
  /** The images' share of it. */
  imageTokens: number;
}

const CHAIR = "Chair";

const WRAP_LABEL: Record<WrapKind, string> = {
  minutes: "meeting minutes",
  decision: "decision",
  open_questions: "open questions",
};

interface ImagePart {
  url: string;
  tokens: number;
}

interface Item {
  role: "user" | "assistant";
  content: string;
  images: ImagePart[];
  /** Follows the images: "(The image above is …)" (ADR 0016). */
  imageLabel?: string;
  isChair: boolean;
  /** A posted wrap-up: the latest one is kept when trimming (ADR 0015). */
  isSummary: boolean;
  /** Never trimmed: the brief's images (ADR 0016). */
  pinned?: boolean;
}

/** A text file as a seat reads it: inline, with its name (ADR 0016). */
export function fileBlock(name: string, text: string): string {
  return `<file name="${name.replace(/"/g, "'")}">\n${text}\n</file>`;
}

/** The shared record at a cutoff, brief versions included, in the order things entered it. */
function recordAt(messages: Message[], cutoffSeq: number): Message[] {
  return messages
    .filter(
      (m) =>
        m.visibleSeq !== null &&
        m.visibleSeq <= cutoffSeq &&
        m.status === "done" &&
        m.authorKind !== "event" &&
        !m.hiddenFromSeats,
    )
    .sort((a, b) => (a.visibleSeq ?? 0) - (b.visibleSeq ?? 0) || a.seq - b.seq);
}

/** Messages a seat may see at a cutoff, in the order they entered the shared record. Brief versions aren't messages. */
export function visibleMessages(messages: Message[], cutoffSeq: number): Message[] {
  return recordAt(messages, cutoffSeq).filter(
    (m) => m.authorKind !== "brief" && m.content.trim() !== "",
  );
}

export function buildView(input: ViewInput): View {
  const { seat, seats, messages } = input;
  const seatName = new Map(seats.map((s) => [s.id, s.displayName]));
  const byId = new Map(messages.map((m) => [m.id, m]));
  const authorOf = (m: Message): string =>
    m.authorKind === "chair" ? CHAIR : (seatName.get(m.seatId ?? "") ?? "A former participant");

  const roster: RosterEntry[] = seats
    .filter((s) => s.removedAt === null)
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ displayName: s.displayName, model: s.model }));

  const record = recordAt(messages, input.cutoffSeq);
  const filesOf = (m: Message) => input.attachments?.get(m.id) ?? [];
  const textBlocks = (m: Message) =>
    filesOf(m)
      .filter((f) => f.kind === "text" && f.text !== undefined)
      .map((f) => fileBlock(f.name, f.text as string))
      .join("\n\n");
  const imagesOf = (m: Message): (ImagePart & { name: string })[] =>
    filesOf(m)
      .filter((f) => f.kind === "image" && f.url)
      .map((f) => ({
        name: f.name,
        url: f.url as string,
        tokens: imageTokens(f.width ?? 1024, f.height ?? 1024),
      }));

  // The brief at this cutoff: its text and text files in the intro, its images pinned at the top (ADR 0016).
  const briefMessage = record.filter((m) => m.authorKind === "brief").at(-1);
  const briefFiles = briefMessage ? textBlocks(briefMessage) : "";
  const briefText = [briefAt(messages, input.cutoffSeq), briefFiles].filter(Boolean).join("\n\n");

  const intro = renderIntro({
    meetingTitle: input.meeting.title,
    self: { displayName: seat.displayName, model: seat.model, persona: seat.persona },
    roster,
    answerLength: seatAnswerLength(seat, input.meeting),
    brief: briefText,
  });
  const floor = renderFloorNote(input.floor);

  const items: Item[] = [];
  const briefImages = briefMessage ? imagesOf(briefMessage) : [];
  if (briefImages.length) {
    // Claude takes no images in the system prompt, so the brief's images open the conversation instead.
    items.push({
      role: "user",
      content: "",
      images: briefImages,
      imageLabel: briefImagesNote(briefImages.map((i) => i.name)),
      isChair: false,
      isSummary: false,
      pinned: true,
    });
  }
  let started = false;
  for (const m of record) {
    if (m.authorKind === "brief") {
      // The brief itself is in the intro. Once the discussion has started, a change leaves a line where it happened.
      const empty = !m.content.trim() && !filesOf(m).length;
      if (started)
        items.push({
          role: "user",
          content: empty ? BRIEF_CLEARED_NOTE : BRIEF_UPDATED_NOTE,
          images: [],
          isChair: false,
          isSummary: false,
        });
      continue;
    }
    const files = textBlocks(m);
    const images = imagesOf(m);
    if (!m.content.trim() && !files && !images.length) continue;
    started = true;
    const text = m.content.trim() ? m.content : ATTACHMENTS_ONLY;
    const imageLabel = images.length ? imagesNote(images.map((i) => i.name)) : undefined;
    const withFiles = files ? `${text}\n\n${files}` : text;
    const content = m.stoppedEarly ? `${withFiles}\n\n${CUT_OFF_NOTE}` : withFiles;
    const isSummary = m.authorKind === "seat" && !!m.wrapKind;
    if (m.authorKind === "seat" && m.seatId === seat.id) {
      items.push({ role: "assistant", content, images, imageLabel, isChair: false, isSummary });
      continue;
    }
    items.push({
      role: "user",
      content: `${speakerTag(m)}: ${content}`,
      images,
      imageLabel,
      isChair: m.authorKind === "chair",
      isSummary,
    });
  }

  function speakerTag(m: Message): string {
    let tag = authorOf(m);
    const target = m.replyToId ? byId.get(m.replyToId) : undefined;
    if (target) {
      tag += `, replying to ${target.authorKind === "seat" && target.seatId === seat.id ? "you" : authorOf(target)}`;
    } else if (m.authorKind === "chair" && m.sendMode === "seats" && m.targetSeatIds?.length) {
      const names = m.targetSeatIds.map((id) =>
        id === seat.id ? "you" : (seatName.get(id) ?? "?"),
      );
      tag += ` → ${names.join(", ")}`;
    }
    if (m.wrapKind) tag += `, ${WRAP_LABEL[m.wrapKind as WrapKind]}`;
    return `[${tag}]`;
  }

  const { kept, trimmedCount } = fitToBudget(items, input.budget - cost(intro) - cost(floor));
  const merged = merge(kept);
  if (merged[0]?.role === "assistant") merged.unshift({ role: "user", content: MEETING_STARTED });
  const last = merged[merged.length - 1];
  if (last?.role === "user") appendText(last, floor);
  else merged.push({ role: "user", content: floor });

  const out: ChatMessage[] = [{ role: "system", content: intro }, ...merged];
  const imageTokenTotal = kept.reduce(
    (n, it) => n + it.images.reduce((t, i) => t + i.tokens, 0),
    0,
  );
  return {
    messages: out,
    trimmedCount,
    estimatedTokens: out.reduce((n, m) => n + cost(textOf(m)), 0) + imageTokenTotal,
    imageTokens: imageTokenTotal,
  };
}

/** A message's text, without its images. */
export function textOf(m: ChatMessage): string {
  return typeof m.content === "string"
    ? m.content
    : m.content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function cost(text: string): number {
  return budgetTokens(text) + MESSAGE_OVERHEAD_TOKENS;
}

function itemCost(it: Item): number {
  return cost(it.content + (it.imageLabel ?? "")) + it.images.reduce((n, i) => n + i.tokens, 0);
}

/**
 * Drop turns from the middle until the view fits (ADR 0015). Always kept: everything up to the first chair message
 * (the original question), the latest posted wrap-up, and the newest item, even alone over budget: it's what's being
 * answered. Turns before the wrap-up go first, since it summarizes them; then the oldest after it. Each run of
 * dropped turns becomes one "(N older messages trimmed)" line.
 */
function fitToBudget(items: Item[], budget: number): { kept: Item[]; trimmedCount: number } {
  let size = items.reduce((n, it) => n + itemCost(it), 0);
  if (size <= budget) return { kept: items, trimmedCount: 0 };

  const first = items.findIndex((it) => it.isChair);
  const last = items.length - 1;
  let summary = -1;
  for (let i = last; i > first; i--) {
    if (items[i]?.isSummary) {
      summary = i;
      break;
    }
  }
  const order: number[] = [];
  if (summary > first) for (let i = first + 1; i < summary; i++) order.push(i);
  for (let i = Math.max(first, summary) + 1; i < last; i++) order.push(i);
  const droppable = order.filter((i) => !items[i]?.pinned);

  // Room for the trim lines: at most one before the summary and one after it.
  size += 2 * cost(trimmedNote(999, true));
  const dropped = new Set<number>();
  for (const i of droppable) {
    if (size <= budget) break;
    dropped.add(i);
    size -= itemCost(items[i] as Item);
  }
  if (!dropped.size) return { kept: items, trimmedCount: 0 };

  const kept: Item[] = [];
  let run = 0;
  items.forEach((it, i) => {
    if (dropped.has(i)) {
      run++;
      return;
    }
    if (run) {
      kept.push({
        role: "user",
        content: trimmedNote(run, i === summary),
        images: [],
        isChair: false,
        isSummary: false,
      });
      run = 0;
    }
    kept.push(it);
  });
  return { kept, trimmedCount: dropped.size };
}

/**
 * Back-to-back items of the same role become one message (rule 3). A message with images becomes parts, in order:
 * each item's text, then its images.
 */
function merge(items: Item[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  // An item with images is a message of its own, so llmgw's vision fallback describes each source's images apart
  // and a text-only seat can tell them apart. Every family takes back-to-back user messages (checked 2026-11-04).
  let alone = false;
  for (const it of items) {
    let msg = out[out.length - 1];
    if (!msg || msg.role !== it.role || alone || it.images.length) {
      msg = { role: it.role, content: it.content };
      out.push(msg);
    } else {
      appendText(msg, it.content);
    }
    alone = it.images.length > 0;
    if (alone) {
      const parts: ChatPart[] = it.content ? [{ type: "text", text: it.content }] : [];
      for (const img of it.images) parts.push({ type: "image_url", image_url: { url: img.url } });
      if (it.imageLabel) parts.push({ type: "text", text: it.imageLabel });
      msg.content = parts;
    }
  }
  return out;
}

function appendText(msg: ChatMessage, text: string): void {
  if (typeof msg.content === "string") {
    msg.content = msg.content ? `${msg.content}\n\n${text}` : text;
    return;
  }
  const lastPart = msg.content[msg.content.length - 1];
  if (lastPart?.type === "text") lastPart.text += `\n\n${text}`;
  else msg.content.push({ type: "text", text });
}

export { stripSpeakerTag } from "@homestorm/shared";
