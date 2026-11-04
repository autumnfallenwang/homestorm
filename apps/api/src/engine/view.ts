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
  type Message,
  type Seat,
  seatAnswerLength,
  type WrapKind,
} from "@homestorm/shared";
import {
  BRIEF_CLEARED_NOTE,
  BRIEF_UPDATED_NOTE,
  CUT_OFF_NOTE,
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
  /** A posted wrap-up: the latest one is kept when trimming (ADR 0015). */
  isSummary: boolean;
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

  const intro = renderIntro({
    meetingTitle: input.meeting.title,
    self: { displayName: seat.displayName, model: seat.model, persona: seat.persona },
    roster,
    answerLength: seatAnswerLength(seat, input.meeting),
    brief: briefAt(messages, input.cutoffSeq),
  });
  const floor = renderFloorNote(input.floor);

  const items: Item[] = [];
  for (const m of recordAt(messages, input.cutoffSeq)) {
    if (m.authorKind === "brief") {
      // The brief itself is in the intro. Once the discussion has started, a change leaves a line where it happened.
      if (items.length)
        items.push({
          role: "user",
          content: m.content.trim() ? BRIEF_UPDATED_NOTE : BRIEF_CLEARED_NOTE,
          isChair: false,
          isSummary: false,
        });
      continue;
    }
    if (!m.content.trim()) continue;
    const content = m.stoppedEarly ? `${m.content}\n\n${CUT_OFF_NOTE}` : m.content;
    const isSummary = m.authorKind === "seat" && !!m.wrapKind;
    if (m.authorKind === "seat" && m.seatId === seat.id) {
      items.push({ role: "assistant", content, isChair: false, isSummary });
      continue;
    }
    items.push({
      role: "user",
      content: `${speakerTag(m)}: ${content}`,
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
 * Drop turns from the middle until the view fits (ADR 0015). Always kept: everything up to the first chair message
 * (the original question), the latest posted wrap-up, and the newest item, even alone over budget: it's what's being
 * answered. Turns before the wrap-up go first, since it summarizes them; then the oldest after it. Each run of
 * dropped turns becomes one "(N older messages trimmed)" line.
 */
function fitToBudget(items: Item[], budget: number): { kept: Item[]; trimmedCount: number } {
  let size = items.reduce((n, it) => n + cost(it.content), 0);
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

  // Room for the trim lines: at most one before the summary and one after it.
  size += 2 * cost(trimmedNote(999, true));
  const dropped = new Set<number>();
  for (const i of order) {
    if (size <= budget) break;
    dropped.add(i);
    size -= cost((items[i] as Item).content);
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
        isChair: false,
        isSummary: false,
      });
      run = 0;
    }
    kept.push(it);
  });
  return { kept, trimmedCount: dropped.size };
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
