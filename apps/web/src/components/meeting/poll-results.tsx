"use client";

import {
  type Message,
  type Poll,
  type PollAnswer,
  parsePollAnswer,
  pollShift,
  pollTally,
  type Round,
  samePoll,
} from "@homestorm/shared";
import { ChartBarBig, Loader2, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { roundProgress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRoom } from "./room-context";
import { SeatAvatar } from "./source";

/**
 * A poll's answers (ADR 0020): the tally, then one row per seat, with how it moved since the same poll was last
 * taken. An answer that failed or couldn't be read shows as its message below, where Retry is.
 */
export function PollResults({
  round,
  messages,
  renderMessage,
}: {
  round: Round;
  messages: Message[];
  renderMessage: (m: Message) => ReactNode;
}) {
  const { id, state, seatById, seatName, running, act, openPoll } = useRoom();
  const poll: Poll = round.poll ?? { question: "", options: [] };
  const rows = messages.map((m) => ({
    m,
    a: m.status === "done" ? parsePollAnswer(m.content, poll.options) : null,
  }));
  const before = previousAnswers(state.rounds, state.messages, round, poll);
  const answered = rows.filter((r) => r.a).map((r) => r.a as PollAnswer);
  const tally = poll.options.length ? pollTally(answered, poll.options) : [];
  const leftOut = rows.filter((r) => !r.a && r.m.status !== "queued" && r.m.status !== "streaming");

  return (
    <section className="rounded-xl border bg-card/50" aria-label={`Round ${round.number}, poll`}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Round {round.number}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <ChartBarBig className="size-3" />
          Poll
        </span>
        <span aria-hidden>·</span>
        <span>each seat answered privately, in one line</span>
        <span className="ml-auto">
          {round.status === "running" && <Loader2 className="mr-1 inline size-3 animate-spin" />}
          {roundProgress(round, messages)}
          {round.status === "stopped" && " · stopped"}
        </span>
      </header>

      <div className="space-y-3 p-4">
        {tally.length > 0 && answered.length > 0 && (
          <ul className="space-y-1" aria-label="Tally">
            {tally.map((t) => (
              <li
                key={t.label}
                className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-xs"
              >
                <span className="truncate font-medium">{t.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-brand"
                    style={{ width: `${(t.count / answered.length) * 100}%` }}
                  />
                </span>
                <span className="w-4 text-right tabular-nums text-muted-foreground">{t.count}</span>
              </li>
            ))}
          </ul>
        )}

        <ul className="divide-y rounded-lg border bg-card" aria-label="Answers">
          {rows.map(({ m, a }) => {
            const seat = m.seatId ? seatById.get(m.seatId) : undefined;
            const name = seatName(m.seatId);
            const shift = a ? pollShift(a, before.get(m.seatId ?? "")) : null;
            return (
              <li key={m.id} className="flex items-start gap-2.5 px-3 py-2.5">
                <SeatAvatar
                  name={name}
                  source={seat?.ownedBy ?? m.ownedBy ?? "anthropic"}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium">{name}</span>
                    {a ? (
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-sm font-semibold",
                          a.option !== null ? "bg-brand-soft text-brand" : "bg-muted",
                        )}
                      >
                        {a.choice}
                      </span>
                    ) : m.status === "queued" || m.status === "streaming" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" /> answering…
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        no answer to tally (below)
                      </span>
                    )}
                    {a?.confidence !== null && a?.confidence !== undefined && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className="h-1.5 w-12 overflow-hidden rounded-full bg-muted"
                          aria-hidden
                        >
                          <span
                            className="block h-full rounded-full bg-foreground/60"
                            style={{ width: `${a.confidence}%` }}
                          />
                        </span>
                        <span className="tabular-nums">{a.confidence}% sure</span>
                      </span>
                    )}
                    {shift && (
                      <span
                        className="text-xs text-muted-foreground"
                        title="Since the same poll last time"
                      >
                        ({shift})
                      </span>
                    )}
                  </div>
                  {a?.why && <p className="mt-0.5 text-sm text-muted-foreground">{a.why}</p>}
                </div>
              </li>
            );
          })}
        </ul>

        {leftOut.map(({ m }) => (
          <div key={m.id}>{renderMessage(m)}</div>
        ))}

        {round.status !== "running" && round.poll && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={running}
              onClick={() => void act(() => api.poll(id, poll))}
              title="Ask the same question again, to see how views moved"
            >
              <RotateCcw className="size-3.5" />
              Poll again
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={running}
              onClick={() => openPoll(poll)}
            >
              Change and poll again…
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Each seat's answer the last time the same poll was taken, before this one. */
function previousAnswers(
  rounds: Round[],
  messages: Message[],
  round: Round,
  poll: Poll,
): Map<string, PollAnswer | null> {
  const earlier = rounds
    .filter((r) => r.mode === "poll" && r.number < round.number && r.poll && samePoll(r.poll, poll))
    .at(-1);
  if (!earlier) return new Map();
  return new Map(
    messages
      .filter((m) => m.roundId === earlier.id && m.status === "done" && m.seatId)
      .map((m) => [m.seatId as string, parsePollAnswer(m.content, poll.options)]),
  );
}
