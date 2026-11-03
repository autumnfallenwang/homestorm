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
// 7. Long meetings (ADR 0012): over budget, the oldest messages are dropped, but the first chair message stays.

import type { AnswerLength, Message, Seat, WrapKind } from "@homestorm/shared";
import {
  type Floor,
  MEETING_STARTED,
  type RosterEntry,
  renderFloorNote,
  renderIntro,
  trimmedNote,
} from "./prompts.js";
import { budgetTokens, MESSAGE_OVERHEAD_TOKENS } from "./tokens.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
}

export interface View {
  messages: ChatMessage[];
  /** How many older messages were left out to fit the budget. */
  trimmedCount: number;
  /** The view's size by the budget estimate. */
  estimatedTokens: number;
}

const CHAIR = "Chair";

const WRAP_LABEL: Record<WrapKind, string> = {
  minutes: "meeting minutes",
  decision: "decision",
  open_questions: "open questions",
};

interface Item {
  role: "user" | "assistant";
  content: string;
  isChair: boolean;
}

/** Messages a seat may see at a cutoff, in the order they entered the shared record. */
export function visibleMessages(messages: Message[], cutoffSeq: number): Message[] {
  return messages
    .filter(
      (m) =>
        m.visibleSeq !== null &&
        m.visibleSeq <= cutoffSeq &&
        m.status === "done" &&
        m.authorKind !== "event" &&
        !m.hiddenFromSeats &&
        m.content.trim() !== "",
    )
    .sort((a, b) => (a.visibleSeq ?? 0) - (b.visibleSeq ?? 0) || a.seq - b.seq);
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

  const intro = renderIntro({
    meetingTitle: input.meeting.title,
    self: { displayName: seat.displayName, model: seat.model, persona: seat.persona },
    roster,
    answerLength: input.meeting.answerLength,
  });
  const floor = renderFloorNote(input.floor);

  const items: Item[] = visibleMessages(messages, input.cutoffSeq).map((m) => {
    if (m.authorKind === "seat" && m.seatId === seat.id) {
      return { role: "assistant", content: m.content, isChair: false };
    }
    return {
      role: "user",
      content: `${speakerTag(m)}: ${m.content}`,
      isChair: m.authorKind === "chair",
    };
  });

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
  if (last?.role === "user") last.content += `\n\n${floor}`;
  else merged.push({ role: "user", content: floor });

  const out: ChatMessage[] = [{ role: "system", content: intro }, ...merged];
  return {
    messages: out,
    trimmedCount,
    estimatedTokens: out.reduce((n, m) => n + cost(m.content), 0),
  };
}

function cost(text: string): number {
  return budgetTokens(text) + MESSAGE_OVERHEAD_TOKENS;
}

/**
 * Keep the newest items that fit, plus the first chair message (the original question). The dropped ones in between
 * become a single "(N older messages trimmed)" line.
 */
function fitToBudget(items: Item[], budget: number): { kept: Item[]; trimmedCount: number } {
  const total = items.reduce((n, it) => n + cost(it.content), 0);
  if (total <= budget) return { kept: items, trimmedCount: 0 };

  const anchorIndex = items.findIndex((it) => it.isChair);
  const anchor = anchorIndex >= 0 ? items[anchorIndex] : undefined;
  let room = budget - (anchor ? cost(anchor.content) : 0) - cost(trimmedNote(999));

  // Walk back from the newest. The newest item always stays, even alone over budget: it's what's being answered.
  let firstKept = items.length;
  for (let i = items.length - 1; i > anchorIndex; i--) {
    const c = cost((items[i] as Item).content);
    if (room - c < 0 && i < items.length - 1) break;
    room -= c;
    firstKept = i;
  }
  if (firstKept <= anchorIndex + 1) return { kept: items, trimmedCount: 0 };

  const dropped = firstKept - (anchorIndex + 1);
  const kept: Item[] = [
    ...items.slice(0, anchorIndex + 1),
    { role: "user", content: trimmedNote(dropped), isChair: false },
    ...items.slice(firstKept),
  ];
  return { kept, trimmedCount: dropped };
}

function merge(items: Item[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev && prev.role === it.role) prev.content += `\n\n${it.content}`;
    else out.push({ role: it.role, content: it.content });
  }
  return out;
}

export { stripSpeakerTag } from "@homestorm/shared";
