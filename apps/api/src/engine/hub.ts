// In-process fan-out of live events, one channel per meeting (ADR 0010: one API instance, no Redis).

import type { MeetingEvent } from "@homestorm/shared";

type Listener = (event: MeetingEvent) => void;

export class EventHub {
  private readonly channels = new Map<string, Set<Listener>>();

  subscribe(meetingId: string, listener: Listener): () => void {
    let set = this.channels.get(meetingId);
    if (!set) {
      set = new Set();
      this.channels.set(meetingId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.channels.delete(meetingId);
    };
  }

  publish(meetingId: string, event: MeetingEvent): void {
    for (const listener of this.channels.get(meetingId) ?? []) {
      try {
        listener(event);
      } catch {
        // One broken subscriber must not stop the others.
      }
    }
  }

  subscriberCount(meetingId: string): number {
    return this.channels.get(meetingId)?.size ?? 0;
  }
}
