"use client";

import type { Message, Seat } from "@homestorm/shared";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMeetings } from "@/components/shell/meetings-context";
import { Button } from "@/components/ui/button";
import { useLimits, useMeeting } from "@/hooks/use-meeting";
import { Composer } from "./composer";
import { EditSeatDialog } from "./edit-seat-dialog";
import { MeetingHeader } from "./meeting-header";
import { ReplyDialog } from "./reply-dialog";
import { type Room, RoomContext } from "./room-context";
import { SeatsPanel } from "./seats-panel";
import { Transcript } from "./transcript";
import { WrapUpDialog } from "./wrap-up-dialog";

/** One meeting: header, transcript and message box in the middle, seats on the right (ADR 0007). */
export function MeetingRoom({ id }: { id: string }) {
  const { live, connection } = useMeeting(id);
  const state = live.state;
  const { refresh } = useMeetings();
  const [notice, setNotice] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [wrapOpen, setWrapOpen] = useState(false);
  const [editSeat, setEditSeat] = useState<Seat | null>(null);
  const [seatsOpen, setSeatsOpen] = useState(false);

  const running = !!state?.rounds.some((r) => r.status === "running");
  const roundKey = state ? state.rounds.map((r) => `${r.id}:${r.status}`).join(",") : "";
  const seatKey = state ? state.seats.map((s) => s.id).join(",") : "";
  const limits = useLimits(id, `${roundKey}|${seatKey}`);

  // Keep the sidebar's live / minutes badges in step with rounds starting and ending.
  // biome-ignore lint/correctness/useExhaustiveDependencies: roundKey is the trigger
  useEffect(() => {
    if (roundKey) void refresh();
  }, [roundKey, refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6_000);
    return () => clearTimeout(t);
  }, [notice]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    }
  }, []);

  const room: Room | null = useMemo(() => {
    if (!state) return null;
    const seatById = new Map(state.seats.map((s) => [s.id, s]));
    return {
      id,
      state,
      limits,
      thinking: live.thinking,
      running,
      seatById,
      seatName: (sid) => (sid ? (seatById.get(sid)?.displayName ?? "A former seat") : "Chair"),
      act,
      openReply: setReplyTarget,
      openWrapUp: () => setWrapOpen(true),
      openEditSeat: setEditSeat,
    };
  }, [id, state, limits, live.thinking, running, act]);

  // Stay pinned to the newest message while the chair is at the bottom; don't yank them back if they scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const contentKey = state
    ? `${state.messages.length}:${state.messages.reduce((n, m) => n + m.content.length, 0)}`
    : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey is the trigger
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [contentKey]);

  if (connection === "not-found") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>This meeting doesn't exist any more.</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to meetings</Link>
        </Button>
      </main>
    );
  }
  if (!room) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2
          className="size-5 animate-spin text-muted-foreground"
          aria-label="Loading meeting"
        />
      </main>
    );
  }

  return (
    <RoomContext.Provider value={room}>
      <main className="flex min-w-0 flex-1 flex-col">
        <MeetingHeader connection={connection} onToggleSeats={() => setSeatsOpen((o) => !o)} />
        <div
          ref={scroller}
          className="flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <Transcript />
        </div>
        {notice && (
          <div className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 px-4" role="alert">
            <p className="flex-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {notice}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
            >
              <X />
            </Button>
          </div>
        )}
        <Composer key={id} />
      </main>
      <div className="hidden lg:flex">
        <SeatsPanel />
      </div>
      {seatsOpen && (
        <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
          <button
            type="button"
            aria-label="Close seats"
            className="flex-1 bg-black/30"
            onClick={() => setSeatsOpen(false)}
          />
          <SeatsPanel />
        </div>
      )}
      <ReplyDialog target={replyTarget} onClose={() => setReplyTarget(null)} />
      <WrapUpDialog open={wrapOpen} onClose={() => setWrapOpen(false)} />
      <EditSeatDialog seat={editSeat} onClose={() => setEditSeat(null)} />
    </RoomContext.Provider>
  );
}
