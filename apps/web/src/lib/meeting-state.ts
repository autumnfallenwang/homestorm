// The meeting as the browser holds it, updated from the live stream (ADR 0010). Pure, so it's unit tested.

import type { MeetingEvent, MeetingState, Message } from "@homestorm/shared";

export interface LiveState {
  state: MeetingState | null;
  /** message id → when the model last reported thinking (ms). */
  thinking: Record<string, number>;
}

export const emptyLive: LiveState = { state: null, thinking: {} };

export interface Applied {
  live: LiveState;
  /** A text chunk arrived beyond what we have: take a fresh snapshot. */
  gap: boolean;
}

const bySeq = (a: Message, b: Message) => a.seq - b.seq;

export function applyEvent(live: LiveState, event: MeetingEvent, now = Date.now()): Applied {
  if (event.type === "snapshot") return { live: { state: event.state, thinking: {} }, gap: false };
  const s = live.state;
  if (!s) return { live, gap: false };

  switch (event.type) {
    case "meeting":
      return { live: { ...live, state: { ...s, meeting: event.meeting } }, gap: false };

    case "seat": {
      const seats = upsert(s.seats, event.seat).sort((a, b) => a.position - b.position);
      return { live: { ...live, state: { ...s, seats } }, gap: false };
    }

    case "round": {
      const rounds = upsert(s.rounds, event.round).sort((a, b) => a.number - b.number);
      return { live: { ...live, state: { ...s, rounds } }, gap: false };
    }

    case "message": {
      let incoming = event.message;
      const existing = s.messages.find((m) => m.id === incoming.id);
      // A stale "started streaming" event must not wipe text we already have from the snapshot or deltas.
      if (
        existing &&
        incoming.status === "streaming" &&
        existing.status === "streaming" &&
        existing.content.length > incoming.content.length
      ) {
        incoming = { ...incoming, content: existing.content };
      }
      const messages = upsert(s.messages, incoming).sort(bySeq);
      const thinking = { ...live.thinking };
      if (incoming.status !== "streaming") delete thinking[incoming.id];
      return { live: { state: { ...s, messages }, thinking }, gap: false };
    }

    case "delta": {
      const m = s.messages.find((x) => x.id === event.messageId);
      if (!m) return { live, gap: true };
      if (event.offset === m.content.length) {
        const messages = s.messages.map((x) =>
          x.id === m.id ? { ...x, content: x.content + event.text } : x,
        );
        const thinking = { ...live.thinking };
        delete thinking[m.id];
        return { live: { state: { ...s, messages }, thinking }, gap: false };
      }
      // Already have it (a buffered chunk the snapshot included): ignore. Beyond what we have: resync.
      if (event.offset + event.text.length <= m.content.length) return { live, gap: false };
      return { live, gap: true };
    }

    case "thinking":
      return {
        live: { ...live, thinking: { ...live.thinking, [event.messageId]: now } },
        gap: false,
      };
  }
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}
