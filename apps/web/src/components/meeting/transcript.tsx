"use client";

import {
  distinctToolCalls,
  type Message,
  type Round,
  spendUsd,
  stripSpeakerTag,
  type ToolActivity,
} from "@homestorm/shared";
import {
  AlertTriangle,
  Check,
  Copy,
  CornerUpLeft,
  FileText,
  Globe,
  Loader2,
  RotateCcw,
  Square,
  SquareTerminal,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { clockTime, compactNumber, plainText, roundProgress, sentToLine } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AttachmentStrip, shownSaved } from "./attachments";
import { useCurrentBrief } from "./brief";
import { Markdown } from "./markdown";
import { PollResults } from "./poll-results";
import { useRoom } from "./room-context";
import { SeatAvatar, SourceTag } from "./source";

type Item =
  | { kind: "message"; message: Message }
  | { kind: "round"; round: Round; messages: Message[] };

/** Group the transcript: seat answers of a multi-seat round go into one box, everything else in creation order. */
export function transcriptItems(messages: Message[], rounds: Round[]): Item[] {
  const roundById = new Map(rounds.map((r) => [r.id, r]));
  const items: Item[] = [];
  const boxed = new Set<string>();
  for (const m of messages) {
    const round = m.roundId ? roundById.get(m.roundId) : undefined;
    if (
      m.authorKind === "seat" &&
      round &&
      (((round.mode === "blind" || round.mode === "in_turn") && round.seatIds.length > 1) ||
        // A poll is a table even with one seat (ADR 0020).
        round.mode === "poll")
    ) {
      if (boxed.has(round.id)) continue;
      boxed.add(round.id);
      items.push({
        kind: "round",
        round,
        messages: messages.filter((x) => x.roundId === round.id && x.authorKind === "seat"),
      });
      continue;
    }
    items.push({ kind: "message", message: m });
  }
  return items;
}

export function Transcript() {
  const { state } = useRoom();
  const items = transcriptItems(state.messages, state.rounds);
  // Brief versions show as a line where they changed; an empty transcript still gets the welcome.
  if (!items.some((it) => it.kind === "round" || it.message.authorKind !== "brief")) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mx-auto max-w-md py-16 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">The floor is yours.</p>
          <p className="mt-1">
            Add seats on the right, then ask your question. By default everyone answers blind: each
            seat answers without seeing the others.
          </p>
          <p className="mt-2">
            Background every seat should always have goes in the meeting brief, at the top.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <ol className="flex flex-col gap-4" aria-label="Transcript">
        {items.map((it) =>
          it.kind === "round" ? (
            <li key={it.round.id}>
              <RoundBox round={it.round} messages={it.messages} />
            </li>
          ) : (
            <li key={it.message.id}>
              <MessageItem message={it.message} />
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

const ROUND_NOTE: Record<"blind" | "in_turn", string> = {
  blind: "each seat answered without seeing the others",
  in_turn: "each seat saw the answers before it",
};

function RoundBox({ round, messages }: { round: Round; messages: Message[] }) {
  if (round.mode === "poll") {
    return (
      <PollResults
        round={round}
        messages={messages}
        renderMessage={(m) => <MessageItem message={m} inRound />}
      />
    );
  }
  const mode = round.mode === "in_turn" ? "in_turn" : "blind";
  return (
    <section
      className="rounded-xl border bg-card/50"
      aria-label={`Round ${round.number}, ${mode === "blind" ? "blind" : "in turn"}`}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Round {round.number}</span>
        <span aria-hidden>·</span>
        <span className="font-medium text-foreground">
          {mode === "blind" ? "Blind" : "In turn"}
        </span>
        <span aria-hidden>·</span>
        <span>{ROUND_NOTE[mode]}</span>
        <span className="ml-auto">
          {round.status === "running" && <Loader2 className="mr-1 inline size-3 animate-spin" />}
          {roundProgress(round, messages)}
          {round.status === "stopped" && " · stopped"}
        </span>
      </header>
      <div className="flex flex-col gap-4 p-4">
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} inRound />
        ))}
      </div>
    </section>
  );
}

function MessageItem({ message, inRound = false }: { message: Message; inRound?: boolean }) {
  if (message.authorKind === "event") {
    return <p className="text-center text-xs text-muted-foreground">{message.content}</p>;
  }
  if (message.authorKind === "brief") return <BriefLine message={message} />;
  if (message.authorKind === "sources") return <SourcesMessage message={message} />;
  if (message.authorKind === "chair") return <ChairMessage message={message} />;
  return <SeatMessage message={message} inRound={inRound} />;
}

function ReplyQuote({ targetId }: { targetId: string }) {
  const { state, seatName } = useRoom();
  const target = state.messages.find((m) => m.id === targetId);
  if (!target) return null;
  const author = target.authorKind === "chair" ? "You" : seatName(target.seatId);
  return (
    <div className="mb-1.5 rounded-md border-l-2 border-current/40 bg-current/5 px-2 py-1 text-xs opacity-90">
      <span className="font-medium">{author}</span>
      <span className="line-clamp-2">{plainText(stripSpeakerTag(target.content))}</span>
    </div>
  );
}

function ChairMessage({ message }: { message: Message }) {
  const { id, state, seatName } = useRoom();
  const target = message.replyToId
    ? state.messages.find((m) => m.id === message.replyToId)
    : undefined;
  const replyAuthor = target
    ? target.authorKind === "chair"
      ? "your message"
      : seatName(target.seatId)
    : undefined;
  return (
    <div className="group flex flex-col items-end">
      <div className="relative max-w-[85%]">
        <HoverBar message={message} />
        <div className="rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-sm text-brand-foreground">
          {message.replyToId && <ReplyQuote targetId={message.replyToId} />}
          {message.content ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            !message.attachments.length && <p className="italic opacity-80">(no note)</p>
          )}
        </div>
        {message.attachments.length > 0 && (
          <AttachmentStrip
            files={shownSaved(id, message.attachments)}
            className="mt-1.5 justify-end"
          />
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {sentToLine(message, (id) => seatName(id), replyAuthor)} · {clockTime(message.createdAt)}
      </p>
    </div>
  );
}

const WRAP_LABEL = {
  minutes: "Minutes",
  decision: "Decision and reasons",
  open_questions: "Open questions",
} as const;

function SeatMessage({ message, inRound }: { message: Message; inRound: boolean }) {
  const { seatById, seatName, thinking, state } = useRoom();
  const seat = message.seatId ? seatById.get(message.seatId) : undefined;
  const name = seatName(message.seatId);
  const source = seat?.ownedBy ?? message.ownedBy ?? "anthropic";
  const streaming = message.status === "streaming";
  const isThinking =
    streaming && !message.content && Date.now() - (thinking[message.id] ?? 0) < 4_000;
  const target = message.replyToId
    ? state.messages.find((m) => m.id === message.replyToId)
    : undefined;

  if (message.status === "skipped") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <SeatAvatar name={name} source={source} size="sm" dashed /> {name} · skipped this turn
      </p>
    );
  }

  const toolRunning = message.toolCalls.find((c) => c.status === "running");
  const status =
    message.status === "queued"
      ? "Next"
      : streaming
        ? toolRunning
          ? toolRunning.tool === "web_search"
            ? "Searching…"
            : "Reading…"
          : isThinking
            ? "Thinking…"
            : "Answering…"
        : null;

  return (
    <article className={cn("group flex gap-3", !inRound && "pr-8")} aria-label={`${name} says`}>
      <SeatAvatar name={name} source={source} />
      <div className="relative min-w-0 flex-1">
        {message.status !== "queued" && !streaming && <HoverBar message={message} />}
        <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold">{name}</span>
          <SourceTag source={source} />
          {message.wrapKind && (
            <span className="rounded bg-secondary px-1.5 py-px text-[0.6875rem] font-medium">
              {WRAP_LABEL[message.wrapKind]}
              {message.hiddenFromSeats ? " · not posted" : " · posted"}
            </span>
          )}
          {target && (
            <span className="text-xs text-muted-foreground">
              replying to {target.authorKind === "chair" ? "you" : seatName(target.seatId)}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {clockTime(message.startedAt ?? message.createdAt)}
          </span>
          {status && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-brand">
              {streaming && <Loader2 className="size-3 animate-spin" />}
              {status}
            </span>
          )}
          {streaming && <StopButton message={message} />}
        </header>

        {message.status === "queued" ? (
          <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-muted">
            <span className="sr-only">Waiting for its turn</span>
          </div>
        ) : message.content ? (
          <div
            className={cn(
              "mt-1",
              (message.status === "stopped" || message.status === "error") && "opacity-70",
            )}
          >
            <Markdown
              text={streaming ? stripSpeakerTag(message.content) : message.content}
              streaming={streaming}
            />
          </div>
        ) : streaming ? (
          <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-muted" />
        ) : null}

        <ToolCalls calls={message.toolCalls} />
        <Problem message={message} />
        <PostWrapUp message={message} />

        {(message.status === "done" || message.status === "stopped") && (
          <MetaLine message={message} />
        )}
      </div>
    </article>
  );
}

/** Plain text, not a link, unless the fetch really happened: a refused address may be what a page tried to send. */
/**
 * A code run (ADR 0021): "Ran Python", opening to the code and what it printed, so the chair can check how a number
 * was reached. A Python error shows in amber with its last line; the seat read the whole error and could fix it.
 */
function CodeRun({ call }: { call: ToolActivity }) {
  const lines = call.input.trimEnd().split("\n").length;
  if (call.status === "running") return <>Running Python ({plural(lines, "line")})…</>;
  const failed = call.status !== "ok";
  return (
    <details className="group/code">
      <summary
        className={cn(
          "cursor-pointer list-none hover:text-foreground [&::-webkit-details-marker]:hidden",
          failed && "text-warn",
        )}
      >
        {failed ? "Python stopped" : "Ran Python"} ({plural(lines, "line")})
        {failed && call.detail ? `: ${call.detail}` : ""}
        <span className="ml-1 opacity-70 group-open/code:hidden">· show</span>
      </summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded-md border bg-muted/60 p-2 font-mono text-[0.6875rem] whitespace-pre-wrap text-foreground">
        {call.input.trimEnd()}
      </pre>
      {call.output && (
        <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-dashed p-2 font-mono text-[0.6875rem] whitespace-pre-wrap">
          {call.output}
        </pre>
      )}
    </details>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function ToolCall({ call }: { call: ToolActivity }) {
  if (call.tool === "code_run") return <CodeRun call={call} />;
  const searching = call.tool === "web_search";
  if (call.status === "running") {
    return <>{searching ? `Searching: "${call.input}"…` : `Reading: ${call.input}…`}</>;
  }
  if (call.status === "refused") {
    return <span className="text-warn">Refused: {call.input} · not from you or a search</span>;
  }
  if (call.status === "failed") {
    return (
      <span className="text-warn">
        {searching ? `Search failed: "${call.input}"` : `Couldn't read: ${call.input}`}
      </span>
    );
  }
  if (searching) return <>Searched: "{call.input}"</>;
  const web = /^https?:\/\//i.test(call.input);
  return (
    <>
      Read:{" "}
      {web ? (
        <a
          href={call.input}
          target="_blank"
          rel="noreferrer noopener nofollow"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {call.title || call.input}
        </a>
      ) : (
        call.input
      )}
    </>
  );
}

/** What a seat looked up (ADR 0014). Some models repeat a weak source as fact, so the chair always sees them. */
function ToolCalls({ calls }: { calls: ToolActivity[] }) {
  if (!calls.length) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground" aria-label="Tools used">
      {distinctToolCalls(calls).map((call, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a turn's calls only ever grow at the end
        <li key={i} className="flex min-w-0 items-start gap-1.5">
          {call.tool === "code_run" ? (
            <SquareTerminal className="mt-0.5 size-3 shrink-0" />
          ) : (
            <Globe className="mt-0.5 size-3 shrink-0" />
          )}
          <span className="min-w-0 break-words">
            <ToolCall call={call} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The chair's web search (ADR 0014): one message every seat reads. */
function SourcesMessage({ message }: { message: Message }) {
  return (
    <article aria-label="Web search results" className="rounded-lg border bg-muted/40 px-3 py-2">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Globe className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">Web search</span>
        <span className="text-xs text-muted-foreground">
          every seat reads this · {clockTime(message.createdAt)}
        </span>
      </header>
      <div className="mt-1">
        <Markdown text={message.content} />
      </div>
    </article>
  );
}

function StopButton({ message }: { message: Message }) {
  const { id, act } = useRoom();
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 gap-1 px-2 text-xs"
      onClick={() => act(() => api.stop(id, message.id))}
    >
      <Square className="size-3" />
      Stop
    </Button>
  );
}

/** model · tokens · seconds · $cost, in mono (ADR 0007). */
function MetaLine({ message }: { message: Message }) {
  const parts = [message.model ?? ""];
  if (message.usage)
    parts.push(
      `${message.usage.estimated ? "≈" : ""}${compactNumber(message.usage.totalTokens)} tokens`,
    );
  if (message.startedAt && message.finishedAt) {
    const s =
      (new Date(message.finishedAt).getTime() - new Date(message.startedAt).getTime()) / 1000;
    parts.push(`${s < 10 ? s.toFixed(1) : Math.round(s)}s`);
  }
  // Only money actually paid: llmgw's figure for a subscription is a list-price equivalent.
  const spend = spendUsd(message);
  if (spend !== null) parts.push(`$${spend.toFixed(4)}`);
  if (message.reasoningEffort === "off") parts.push("thinking off");
  else if (message.reasoningEffort && message.reasoningEffort !== "low")
    parts.push(`effort ${message.reasoningEffort}`);
  return (
    <p className="mt-1.5 font-mono text-[0.6875rem] text-muted-foreground">
      {parts.filter(Boolean).join(" · ")}
      {message.trimmedCount > 0 && ` · older turns trimmed (${message.trimmedCount})`}
      {message.stoppedEarly && " · stopped early, kept"}
    </p>
  );
}

/** A wrap-up waits for the chair's review before the seats see it (ADR 0007). */
function PostWrapUp({ message }: { message: Message }) {
  const { id, act, openBrief, seatName } = useRoom();
  const current = useCurrentBrief();
  const [busy, setBusy] = useState(false);
  if (!message.wrapKind || message.status !== "done") return null;
  if (!message.hiddenFromSeats) {
    // A posted wrap-up can go into the brief, so it's never trimmed (ADR 0015). The chair edits it before saving.
    const heading = `## ${WRAP_LABEL[message.wrapKind]} from ${seatName(message.seatId)}`;
    return (
      <Button
        size="sm"
        variant="ghost"
        className="mt-1 h-7 gap-1 px-2 text-xs text-muted-foreground"
        onClick={() =>
          openBrief(`${current}${current ? "\n\n" : ""}${heading}\n\n${message.content.trim()}`)
        }
      >
        <FileText className="size-3.5" />
        Copy into the brief
      </Button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">
        Only you can see this. Check it, then post it.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await act(() => api.post(id, message.id));
          setBusy(false);
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Check />}
        Post to the meeting
      </Button>
    </div>
  );
}

/** "You updated the meeting brief", with that version one click away (ADR 0015). */
function BriefLine({ message }: { message: Message }) {
  const { id, state } = useRoom();
  const [open, setOpen] = useState(false);
  const firstBrief = state.messages.find((m) => m.authorKind === "brief")?.id === message.id;
  const empty = !message.content && !message.attachments.length;
  const text = empty
    ? "You cleared the meeting brief"
    : firstBrief
      ? "You set the meeting brief"
      : "You updated the meeting brief";
  const files = message.attachments.length;
  return (
    <div className="text-center text-xs text-muted-foreground">
      <p>
        {text}
        {files > 0 && ` (${files} file${files === 1 ? "" : "s"})`}
        {!empty && (
          <>
            {" · "}
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "hide this version" : "show this version"}
            </button>
          </>
        )}
      </p>
      {open && (
        <div className="mx-auto mt-1.5 max-w-xl rounded-md border bg-muted/40 px-3 py-2 text-left">
          {message.content && (
            <p className="whitespace-pre-wrap text-foreground">{message.content}</p>
          )}
          <AttachmentStrip
            files={shownSaved(id, message.attachments)}
            size="sm"
            className={message.content ? "mt-2" : undefined}
          />
        </div>
      )}
    </div>
  );
}

/** Problems stay visible in place, never a quiet switch to another model (ADR 0002). */
function Problem({ message }: { message: Message }) {
  const { id, act, running, seatById } = useRoom();
  if (message.status !== "stopped" && message.status !== "error") return null;
  const code = message.error?.code;
  const seat = message.seatId ? seatById.get(message.seatId) : undefined;
  const retry = (
    <Button
      size="sm"
      variant="outline"
      disabled={running}
      onClick={() => act(() => api.retry(id, message.id))}
    >
      <RotateCcw />
      Retry
    </Button>
  );
  const skip = (
    <Button size="sm" variant="ghost" onClick={() => act(() => api.skip(id, message.id))}>
      Skip this turn
    </Button>
  );

  let title: string;
  let detail = message.error?.message ?? "";
  let actions: React.ReactNode;
  if (message.status === "stopped") {
    title = code === "interrupted" ? "Stopped: the server restarted" : "Stopped by you";
    detail = message.content
      ? "The partial answer is hidden from the other seats unless you keep it."
      : "";
    actions = (
      <>
        {message.content && (
          <Button size="sm" variant="outline" onClick={() => act(() => api.keep(id, message.id))}>
            <Check />
            Keep partial
          </Button>
        )}
        {retry}
        {skip}
      </>
    );
  } else if (code === "rate_limited") {
    title = `Rate limited${message.error?.status ? ` (${message.error.status})` : ""}`;
    actions = (
      <>
        {retry}
        {skip}
      </>
    );
  } else if (code === "out_of_allowance" || code === "unavailable") {
    title = code === "out_of_allowance" ? "Out of allowance" : "Not available on your plan";
    actions = (
      <>
        {seat && !seat.muted && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => act(() => api.updateSeat(id, seat.id, { muted: true }))}
          >
            Mute until reset
          </Button>
        )}
        {retry}
        {skip}
      </>
    );
  } else {
    title =
      code === "empty_answer"
        ? "No answer"
        : code === "context_too_long"
          ? "The meeting is too long for this model"
          : code === "model_not_found"
            ? "llmgw doesn't know this model"
            : "llmgw returned an error";
    actions = (
      <>
        {retry}
        {skip}
      </>
    );
  }
  return (
    <div
      role="status"
      className={cn(
        "mt-2 rounded-lg border px-3 py-2 text-sm",
        message.status === "error"
          ? "border-destructive/30 bg-destructive/5"
          : "border-warn/30 bg-warn/5",
      )}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle
          className={cn("size-4", message.status === "error" ? "text-destructive" : "text-warn")}
        />
        {title}
      </p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

/** Reply to… / Retry / Copy, on hover (ADR 0007). */
function HoverBar({ message }: { message: Message }) {
  const { id, act, running, openReply, state } = useRoom();
  const [copied, setCopied] = useState(false);
  const canReply = message.status === "done" && !!message.content;
  const latestVisible = Math.max(0, ...state.messages.map((m) => m.visibleSeq ?? 0));
  const canRetry =
    message.authorKind === "seat" &&
    !running &&
    (message.status !== "done" || message.visibleSeq === latestVisible);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      // Plain HTTP on the LAN has no clipboard API: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = message.content;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div
      className={cn(
        "absolute -top-3 z-10 flex gap-0.5 rounded-md border bg-popover p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        message.authorKind === "chair" ? "left-0 -translate-x-1/2" : "right-0",
      )}
    >
      {canReply && (
        <IconButton label="Reply to…" onClick={() => openReply(message)}>
          <CornerUpLeft />
        </IconButton>
      )}
      {canRetry && (
        <IconButton
          label="Retry on the same model"
          onClick={() => act(() => api.retry(id, message.id))}
        >
          <RotateCcw />
        </IconButton>
      )}
      {message.content && (
        <IconButton label={copied ? "Copied" : "Copy"} onClick={copy}>
          {copied ? <Check /> : <Copy />}
        </IconButton>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
