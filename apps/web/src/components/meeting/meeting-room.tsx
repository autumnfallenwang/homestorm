"use client";

import { briefAt, type Message, type Poll, type Seat } from "@homestorm/shared";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMeetings } from "@/components/shell/meetings-context";
import { Button } from "@/components/ui/button";
import { useLimits, useMeeting, useModels } from "@/hooks/use-meeting";
import { useStoredFlag } from "@/lib/stored-flag";
import { BriefDialog, BriefPanel } from "./brief";
import { Composer } from "./composer";
import { EditSeatDialog } from "./edit-seat-dialog";
import { MeetingHeader } from "./meeting-header";
import { PollDialog } from "./poll-dialog";
import { ReplyDialog } from "./reply-dialog";
import { type Room, RoomContext } from "./room-context";
import { SeatsPanel, SeatsRail } from "./seats-panel";
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
  const [pollDraft, setPollDraft] = useState<Poll | null>(null);
  const [editSeat, setEditSeat] = useState<Seat | null>(null);
  const [briefDraft, setBriefDraft] = useState<string | null>(null);
  const [seatsOpen, setSeatsOpen] = useState(false);
  // Wide screens can fold the seats into a narrow rail; this browser remembers it across meetings.
  const [seatsFolded, setSeatsFolded] = useStoredFlag("homestorm.seats-folded");
  const [briefShown, setBriefShown] = useState(false);

  const running = !!state?.rounds.some((r) => r.status === "running");
  const roundKey = state ? state.rounds.map((r) => `${r.id}:${r.status}`).join(",") : "";
  const seatKey = state ? state.seats.map((s) => s.id).join(",") : "";
  const limits = useLimits(id, `${roundKey}|${seatKey}`);
  const modelList = useModels();

  // A brief that was just added opens under the header, so the chair sees where it lives now.
  const hasBrief = !!state && !!briefAt(state.messages, state.meeting.clock);
  const hadBrief = useRef<boolean | null>(null);
  useEffect(() => {
    if (!state) return;
    if (hadBrief.current === false && hasBrief) setBriefShown(true);
    hadBrief.current = hasBrief;
  }, [state, hasBrief]);

  // Keep the meetings list in step: Live while a round runs, the seat count, and the latest posted wrap-up. Seats
  // used to change without it, so the list said "2 seats" with four at the table.
  const listKey = state
    ? [
        roundKey,
        state.seats.filter((s) => !s.removedAt).map((s) => s.id),
        state.messages.filter((m) => m.wrapKind && !m.hiddenFromSeats).map((m) => m.id),
      ].join("|")
    : "";
  useEffect(() => {
    if (listKey) void refresh();
  }, [listKey, refresh]);

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
      models: new Map((modelList?.models ?? []).map((m) => [m.id, m])),
      standardContextBudget: modelList?.standardContextBudget ?? null,
      webTools: modelList?.webTools ?? false,
      thinking: live.thinking,
      running,
      seatById,
      seatName: (sid) => (sid ? (seatById.get(sid)?.displayName ?? "A former seat") : "Chair"),
      act,
      openReply: setReplyTarget,
      openWrapUp: () => setWrapOpen(true),
      openPoll: (start?: Poll) => setPollDraft(start ?? { question: "", options: [] }),
      openBrief: (draft?: string) =>
        setBriefDraft(draft ?? briefAt(state.messages, state.meeting.clock)),
      openEditSeat: setEditSeat,
    };
  }, [id, state, limits, modelList, live.thinking, running, act]);

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
        <MeetingHeader
          connection={connection}
          onToggleSeats={() => setSeatsOpen((o) => !o)}
          briefShown={briefShown}
          onToggleBrief={() => setBriefShown((o) => !o)}
        />
        {briefShown && <BriefPanel onClose={() => setBriefShown(false)} />}
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
        {seatsFolded ? (
          <SeatsRail onExpand={() => setSeatsFolded(false)} />
        ) : (
          <SeatsPanel onFold={() => setSeatsFolded(true)} />
        )}
      </div>
      {seatsOpen && (
        <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
          <button
            type="button"
            aria-label="Close seats"
            className="flex-1 bg-black/30"
            onClick={() => setSeatsOpen(false)}
          />
          <SeatsPanel onFold={() => setSeatsOpen(false)} />
        </div>
      )}
      <ReplyDialog target={replyTarget} onClose={() => setReplyTarget(null)} />
      <WrapUpDialog open={wrapOpen} onClose={() => setWrapOpen(false)} />
      <PollDialog draft={pollDraft} onClose={() => setPollDraft(null)} />
      <EditSeatDialog seat={editSeat} onClose={() => setEditSeat(null)} />
      <BriefDialog draft={briefDraft} onClose={() => setBriefDraft(null)} />
    </RoomContext.Provider>
  );
}
