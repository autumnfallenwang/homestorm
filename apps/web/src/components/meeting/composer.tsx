"use client";

import { canTakeFloor, type Seat } from "@homestorm/shared";
import { AtSign, Check, ChevronDown, Loader2, SendHorizontal, Square, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { allowanceLine, listWords } from "@/lib/format";
import { seatContext } from "@/lib/seat-context";
import { cn } from "@/lib/utils";
import { useRoom } from "./room-context";
import { SeatAvatar } from "./source";

type Mode = "blind" | "in_turn" | "none";

const MODE_LABEL: Record<Mode, string> = {
  blind: "Everyone · blind",
  in_turn: "Everyone · in turn",
  none: "No reply",
};

/**
 * The message box (ADR 0007). Every control here produces the same structured action (ADR 0006): picked
 * @mentions become targets; the text itself is never scanned for commands.
 */
export function Composer() {
  const { id, state, limits, running, act, models, standardContextBudget } = useRoom();
  const [text, setText] = useState("");
  // Blind first: first answers stay independent. The pick stays after sending, and the selector always shows it.
  const [mode, setMode] = useState<Mode>("blind");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionMode, setMentionMode] = useState<"blind" | "in_turn">("blind");
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const seats = state.seats.filter((s) => !s.removedAt);
  // ADR 0015: nudge the chair toward a summary before seats lose older turns.
  const contextFull =
    standardContextBudget !== null &&
    seats.some((s) => seatContext(s, state, models, standardContextBudget).tone !== "ok");
  const active = seats.filter((s) => !s.muted);
  const chosen = mentions
    .map((sid) => seats.find((s) => s.id === sid))
    .filter((s): s is Seat => !!s);
  const candidates = useMemo(
    () =>
      query === null
        ? []
        : seats.filter(
            (s) =>
              !mentions.includes(s.id) && s.displayName.toLowerCase().includes(query.toLowerCase()),
          ),
    [query, seats, mentions],
  );

  const runningRound = state.rounds.filter((r) => r.status === "running").at(-1);
  const answering = state.messages
    .filter((m) => m.status === "streaming" && m.seatId)
    .map((m) => seats.find((s) => s.id === m.seatId)?.displayName ?? "A seat");

  const comment = mode === "none" && chosen.length === 0;
  const canSend =
    !sending &&
    (comment
      ? !!text.trim()
      : !running && (chosen.length > 0 || (!!text.trim() && active.length > 0)));

  function onChange(value: string, caret: number) {
    setText(value);
    const before = value.slice(0, caret);
    const match = /(^|\s)@([^\s@]*)$/.exec(before);
    setQuery(match ? (match[2] ?? "") : null);
    setPick(0);
  }

  function choose(seat: Seat) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/(^|\s)@[^\s@]*$/, "$1");
    setText(before + text.slice(caret));
    setMentions((m) => [...m, seat.id]);
    if (mode === "none") setMode("blind");
    setQuery(null);
    requestAnimationFrame(() => el?.focus());
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    const action = comment
      ? { text, mode: "none" as const, targets: "everyone" as const }
      : chosen.length
        ? { text, mode: mentionMode, targets: chosen.map((s) => s.id) }
        : { text, mode: mode === "none" ? "blind" : mode, targets: "everyone" as const };
    const ok = await act(() => api.send(id, action));
    setSending(false);
    if (ok) {
      setText("");
      setMentions([]);
      setQuery(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (query !== null && candidates.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPick((p) => (p + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPick((p) => (p - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const seat = candidates[pick];
        if (seat) choose(seat);
        return;
      }
    }
    if (e.key === "Escape" && query !== null) {
      e.preventDefault();
      setQuery(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  let hint: React.ReactNode;
  if (chosen.length) {
    hint = (
      <span className="flex flex-wrap items-center gap-2">
        Asking {listWords(chosen.map((s) => s.displayName))}
        {chosen.length > 1 && (
          <span className="inline-flex overflow-hidden rounded-md border text-xs">
            {(["blind", "in_turn"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mentionMode === m}
                onClick={() => setMentionMode(m)}
                className={cn(
                  "px-2 py-0.5",
                  mentionMode === m ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {m === "blind" ? "Blind" : "In turn"}
              </button>
            ))}
          </span>
        )}
      </span>
    );
  } else if (mode === "none") {
    hint = "Nobody answers. It's a note for the record.";
  } else if (!active.length) {
    hint = seats.length
      ? "Every seat is muted. Unmute one, or type @ to ask a seat directly."
      : "No seats yet. Add one on the right.";
  } else {
    hint = `${active.length} active seat${active.length === 1 ? "" : "s"} will answer${
      mode === "in_turn" ? " in seat order" : " independently"
    } · type @ to pick seats instead`;
  }

  return (
    <div className="border-t bg-background px-4 pt-3 pb-2">
      <div className="mx-auto max-w-3xl">
        {running && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin text-brand" />
            <span>
              {runningRound?.mode === "wrap_up"
                ? "Writing the wrap-up"
                : `Round ${runningRound?.number ?? ""} in progress`}
              {answering.length > 0 && ` · ${listWords(answering)} answering…`}
              {" · new questions wait until it's done"}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7"
              onClick={() => act(() => api.stop(id))}
            >
              <Square className="size-3" />
              Stop all
            </Button>
          </div>
        )}

        <div className="relative rounded-xl border bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring/40">
          {query !== null && candidates.length > 0 && (
            <div
              id="mention-list"
              role="listbox"
              aria-label="Seats"
              className="absolute bottom-full left-2 z-20 mb-1 w-80 overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
            >
              {candidates.map((s, i) => (
                <button
                  key={s.id}
                  id={`mention-${s.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === pick}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(s)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                    i === pick && "bg-accent",
                  )}
                >
                  <SeatAvatar name={s.displayName} source={s.ownedBy} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {s.displayName}
                      {s.muted && (
                        <span className="font-normal text-muted-foreground"> · muted</span>
                      )}
                    </span>
                    <span className="block truncate font-mono text-[0.6875rem] text-muted-foreground">
                      {s.model} · {allowanceLine(limits[s.id]).text}
                    </span>
                  </span>
                  {!canTakeFloor(limits[s.id]) && (
                    <span className="text-xs text-destructive">can't answer</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {chosen.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 pt-2">
              {chosen.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand"
                >
                  @{s.displayName}
                  <button
                    type="button"
                    aria-label={`Don't ask ${s.displayName}`}
                    onClick={() => setMentions((m) => m.filter((x) => x !== s.id))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <Textarea
            ref={ref}
            value={text}
            aria-label="Message"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={query !== null && candidates.length > 0}
            aria-controls="mention-list"
            aria-activedescendant={
              query !== null && candidates[pick] ? `mention-${candidates[pick]?.id}` : undefined
            }
            placeholder={
              mode === "none" ? "Write a note for the record…" : "Ask the room… (@ to pick seats)"
            }
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setQuery(null), 150)}
            rows={2}
            className="max-h-48 min-h-[3.25rem] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />

          <div className="flex items-center gap-2 px-2 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={chosen.length > 0}
                >
                  {chosen.length ? "Chosen seats" : MODE_LABEL[mode]}
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {(["blind", "in_turn"] as const).map((m) => (
                  <DropdownMenuItem key={m} onSelect={() => setMode(m)}>
                    <Check className={cn(mode === m ? "opacity-100" : "opacity-0")} />
                    <span className="flex flex-col">
                      <span>{MODE_LABEL[m]}</span>
                      <span className="text-xs text-muted-foreground">
                        {m === "blind"
                          ? "Each seat answers without seeing the others"
                          : "One after another, in seat order"}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onSelect={() => {
                    const el = ref.current;
                    const next = `${text}${text && !text.endsWith(" ") ? " " : ""}@`;
                    setText(next);
                    setQuery("");
                    requestAnimationFrame(() => {
                      el?.focus();
                      el?.setSelectionRange(next.length, next.length);
                    });
                  }}
                >
                  <AtSign />
                  Choose seats…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setMode("none")}>
                  <Check className={cn(mode === "none" ? "opacity-100" : "opacity-0")} />
                  <span className="flex flex-col">
                    <span>No reply</span>
                    <span className="text-xs text-muted-foreground">
                      Just a note; nobody answers
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{hint}</p>
            <Button size="sm" className="h-8" onClick={send} disabled={!canSend} aria-label="Send">
              {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
              Send
            </Button>
          </div>
        </div>
        {contextFull && (
          <p className="mt-1.5 text-center text-[0.6875rem] text-warn">
            A seat's context is nearly full: have a seat write minutes and post them, or copy them
            into the brief.
          </p>
        )}
      </div>
    </div>
  );
}
