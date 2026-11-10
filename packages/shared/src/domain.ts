// The meeting's vocabulary, shared by the API and the web app.
// Design: docs/meeting-control-design.md; data model: docs/data-model.md.

import { z } from "zod";
import { ATTACHMENT_LIMITS, AttachmentInput, type AttachmentMeta } from "./attachments.js";
import type { Poll } from "./poll.js";

/** llmgw's `owned_by` values homestorm seats can use (ADR 0002). Ollama is left out on purpose. */
export const SOURCES = ["anthropic", "openai-codex", "deepseek"] as const;
export type Source = (typeof SOURCES)[number];

/** How a chair message is sent: to everyone at once, everyone one after another, or nobody. */
export const SEND_MODES = ["blind", "in_turn", "none"] as const;
export type SendMode = (typeof SEND_MODES)[number];

/** A round records which seats answer and how. `single` is one seat; `wrap_up` writes minutes. */
/** `poll`: every seat answers one question privately, in one line (ADR 0020). */
export const ROUND_MODES = ["blind", "in_turn", "single", "wrap_up", "poll"] as const;
export type RoundMode = (typeof ROUND_MODES)[number];

export const ROUND_STATUSES = ["running", "done", "stopped"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

/**
 * A message's life:
 * - `queued`: waiting for its turn in an in-turn round ("Next");
 * - `streaming`: the seat is answering;
 * - `done`: finished, and part of the shared record;
 * - `stopped`: stopped by the chair (or an API restart); the partial text is kept but hidden from seats until
 *   the chair keeps it;
 * - `error`: llmgw failed, or the seat couldn't take the floor;
 * - `skipped`: the chair skipped the turn.
 */
export const MESSAGE_STATUSES = [
  "queued",
  "streaming",
  "done",
  "stopped",
  "error",
  "skipped",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Who wrote a message. `event` is a transcript line such as "You muted Claude Sonnet 5.5". */
/** `brief`: a version of the meeting brief (ADR 0015). It enters the record on the clock but isn't a message seats read. */
/**
 * `sources`: web search results the chair posted (ADR 0014). Every seat reads them. The chair's search was removed on
 * 2026-11-08 (ADR 0017); older meetings still hold these messages.
 */
export const AUTHOR_KINDS = ["chair", "seat", "event", "brief", "sources"] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];

export const ANSWER_LENGTHS = ["concise", "detailed"] as const;
export type AnswerLength = (typeof ANSWER_LENGTHS)[number];

/**
 * Per-seat thinking effort (ADR 0012). `off` (2026-11-09) sends llmgw "none": DeepSeek and Claude stop thinking, and a
 * model that always thinks gets its lowest level. DeepSeek V4 Pro thought for a median 56 s at Low on the cluster.
 */
export const REASONING_EFFORTS = ["off", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** How much of the meeting a seat's view may hold (ADR 0012); see contextBudgetTokens in budget.ts. */
export const CONTEXT_BUDGETS = ["small", "standard", "large", "full"] as const;
export type ContextBudget = (typeof CONTEXT_BUDGETS)[number];

/**
 * What a seat may do on the web (ADR 0014). `must` makes it search before answering, for when the chair wants an answer
 * checked against current sources. A room rule, which a seat follows unless it has its own (ADR 0017).
 */
export const WEB_ACCESS = ["off", "on", "must"] as const;
export type WebAccess = (typeof WEB_ACCESS)[number];

/**
 * Whether a seat may run Python through mcpgw's `code_run` (ADR 0021): sums, totals and comparisons done exactly, not in
 * its head. A room rule like web tools, on by default, which a seat follows unless it has its own.
 */
export const CODE_ACCESS = ["off", "on"] as const;
export type CodeAccess = (typeof CODE_ACCESS)[number];

export const WRAP_KINDS = ["minutes", "decision", "open_questions"] as const;
export type WrapKind = (typeof WRAP_KINDS)[number];

/** Why a seat message failed, kept so the problem stays visible in place. */
export const ERROR_CODES = [
  "rate_limited",
  "out_of_allowance",
  "unavailable",
  "context_too_long",
  "model_not_found",
  "gateway_error",
  "interrupted",
  "empty_answer",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface MessageError {
  code: ErrorCode;
  message: string;
  /** HTTP status from llmgw, when there was one. */
  status?: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  /** True when llmgw returned no usage and homestorm estimated it (ADR 0009). */
  estimated: boolean;
}

/** mcpgw's tools a seat may be offered: the web tools (ADR 0014) and Python (ADR 0021). */
export const TOOL_NAMES = ["web_search", "web_fetch", "code_run"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const WEB_TOOL_NAMES: readonly ToolName[] = ["web_search", "web_fetch"];

/** One tool call a seat made during its turn. It enters the record with the answer, so sources stay visible (ADR 0014). */
export interface ToolActivity {
  tool: ToolName;
  /** The query, the URL, or the Python code. */
  input: string;
  /** `refused`: homestorm's own URL rule stopped it (ADR 0014). `failed`: mcpgw or the site did. */
  status: "running" | "ok" | "failed" | "refused";
  /** web_search: the links it returned. These may be fetched later in the meeting. */
  urls?: string[];
  /** web_fetch: the page's title. */
  title?: string;
  /** Why it failed or was refused; for code_run, Python's error. */
  detail?: string;
  /** code_run: what the code printed and the value of its last line, cut short for the record. */
  output?: string;
}

/**
 * A turn's tool calls with each search or page that worked listed once. Since 2026-11-08 the engine doesn't run a
 * repeat, but turns from before can hold one.
 */
export function distinctToolCalls(calls: readonly ToolActivity[]): ToolActivity[] {
  const seen = new Set<string>();
  return calls.filter((c) => {
    if (c.status !== "ok") return true;
    const key = `${c.tool} ${c.input}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "Searched: "gold price" · Read: https://… · Ran Python twice", or null if nothing worked. */
export function toolSummary(calls: readonly ToolActivity[]): string | null {
  const worked = distinctToolCalls(calls).filter((c) => c.status === "ok");
  const searched = worked.filter((c) => c.tool === "web_search").map((c) => `"${c.input}"`);
  const read = worked.filter((c) => c.tool === "web_fetch").map((c) => c.input);
  const runs = worked.filter((c) => c.tool === "code_run").length;
  const parts = [
    searched.length ? `Searched: ${searched.join(", ")}` : "",
    read.length ? `Read: ${read.join(", ")}` : "",
    runs ? `Ran Python${runs === 1 ? "" : runs === 2 ? " twice" : ` ${runs} times`}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export interface Meeting {
  id: string;
  title: string;
  answerLength: AnswerLength;
  /** Room rule: what seats may do on the web, unless a seat has its own (ADR 0017). */
  webAccess: WebAccess;
  /** Room rule: whether seats may run Python, unless a seat has its own (ADR 0021). */
  codeAccess: CodeAccess;
  /** Logical clock: bumped each time a message enters the shared record. See docs/data-model.md. */
  clock: number;
  createdAt: string;
  updatedAt: string;
}

export interface Seat {
  id: string;
  meetingId: string;
  /** The exact model ID as llmgw lists it. Never swapped for another (ADR 0002). */
  model: string;
  ownedBy: Source;
  displayName: string;
  persona: string | null;
  /** Seat order; in-turn rounds go in this order. */
  position: number;
  muted: boolean;
  reasoningEffort: ReasoningEffort;
  /** This seat's own answer length; null follows the room rule (ADR 0012). */
  answerLength: AnswerLength | null;
  /** How much of the meeting its view may hold; null is Standard (ADR 0012). */
  contextBudget: ContextBudget | null;
  /** What it may do on the web; null follows the room rule (ADR 0017). */
  webAccess: WebAccess | null;
  /** Whether it may run Python; null follows the room rule (ADR 0021). */
  codeAccess: CodeAccess | null;
  /** Removed seats stay so their old messages keep a name. */
  removedAt: string | null;
  createdAt: string;
}

export interface Round {
  id: string;
  meetingId: string;
  /** Round 1, 2, … within the meeting. */
  number: number;
  mode: RoundMode;
  /** The seats called, in answering order. */
  seatIds: string[];
  /** The chair message that started the round, if any ("Ask now" has none). */
  promptMessageId: string | null;
  replyToId: string | null;
  wrapKind: WrapKind | null;
  /** A poll round's question and options (ADR 0020); null for every other round. */
  poll: Poll | null;
  status: RoundStatus;
  createdAt: string;
  finishedAt: string | null;
}

export interface Message {
  id: string;
  meetingId: string;
  /** Creation order; the transcript is shown in this order. */
  seq: number;
  authorKind: AuthorKind;
  seatId: string | null;
  roundId: string | null;
  replyToId: string | null;
  content: string;
  status: MessageStatus;
  error: MessageError | null;
  /** Chair messages: where it was sent. `seats` means picked seats (@mentions or reply-to). */
  sendMode: SendMode | "seats" | null;
  targetSeatIds: string[] | null;
  /** Wrap-up output: minutes, decision or open questions. */
  wrapKind: WrapKind | null;
  /** Unposted minutes: shown to the chair, never to seats. */
  hiddenFromSeats: boolean;
  /** The meeting clock when this entered the shared record; null until then. */
  visibleSeq: number | null;
  /** Seat messages: the meeting clock when the turn started. The seat saw everything up to it. */
  cutoffSeq: number | null;
  model: string | null;
  ownedBy: Source | null;
  reasoningEffort: ReasoningEffort | null;
  usage: Usage | null;
  costUsd: number | null;
  /** llmgw's own request id, when llmgw returns it (ADR 0009). */
  llmgwReqId: string | null;
  /** homestorm's request id, sent to llmgw as X-Request-Id. */
  requestId: string | null;
  /** How many older messages were trimmed from this seat's view (ADR 0012). */
  trimmedCount: number;
  /** The view's size by the budget estimate when the turn started, for the seat card's context bar. */
  viewTokens: number | null;
  /** Images and text files on a chair message or a brief version (ADR 0016). */
  attachments: AttachmentMeta[];
  /** A stopped answer whose partial text the chair kept. */
  stoppedEarly: boolean;
  /** Tool calls during this turn, or the search behind a `sources` message (ADR 0014). */
  toolCalls: ToolActivity[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Everything the meeting page needs; also the live stream's `snapshot` event. */
export interface MeetingState {
  meeting: Meeting;
  seats: Seat[];
  rounds: Round[];
  messages: Message[];
}

export interface MeetingSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  seatCount: number;
  /** A round is running now. */
  live: boolean;
  /** The kind of the latest wrap-up the chair posted, or null. A draft still being reviewed doesn't count. */
  postedWrapUp: WrapKind | null;
}

// ── Requests ────────────────────────────────────────────────────────────────

/** The meeting brief's size cap (ADR 0015): about 4,000 tokens, so it fits even a Small context budget. */
export const BRIEF_MAX_CHARS = 12_000;

export const CreateMeetingInput = z.object({
  title: z.string().trim().min(1).max(200),
  /** Optional standing context every seat always sees. */
  brief: z.string().max(BRIEF_MAX_CHARS).optional(),
  /** Images and text files for the brief (ADR 0016), saved with its text as one version. */
  briefAttachments: z.array(AttachmentInput).max(ATTACHMENT_LIMITS.perMessage).default([]),
});
export type CreateMeetingInput = z.input<typeof CreateMeetingInput>;

export const UpdateMeetingInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    answerLength: z.enum(ANSWER_LENGTHS),
    webAccess: z.enum(WEB_ACCESS),
    codeAccess: z.enum(CODE_ACCESS),
  })
  .partial();
export type UpdateMeetingInput = z.infer<typeof UpdateMeetingInput>;

/** Set, change or clear (empty) the meeting brief, with its images and text files (ADR 0016). */
export const SetBriefInput = z.object({
  content: z.string().max(BRIEF_MAX_CHARS),
  /** The current brief's attachments to carry over. Omitted: keep them all (a text-only edit). */
  keepAttachmentIds: z.array(z.string().uuid()).max(ATTACHMENT_LIMITS.perMessage).optional(),
  /** New ones to add. */
  attachments: z.array(AttachmentInput).max(ATTACHMENT_LIMITS.perMessage).default([]),
});
export type SetBriefInput = z.input<typeof SetBriefInput>;

/** The brief seats get at a clock value: the latest version at or before it ("" when none or cleared). */
export function briefAt(
  messages: Pick<Message, "authorKind" | "visibleSeq" | "content">[],
  cutoffSeq: number,
): string {
  let brief = "";
  let at = -1;
  for (const m of messages) {
    if (m.authorKind !== "brief" || m.visibleSeq === null || m.visibleSeq > cutoffSeq) continue;
    if (m.visibleSeq > at) {
      at = m.visibleSeq;
      brief = m.content.trim();
    }
  }
  return brief;
}

export const AddSeatInput = z.object({
  model: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(60).optional(),
  persona: z.string().trim().max(2000).optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  /** Omitted or null: follow the room rule. */
  answerLength: z.enum(ANSWER_LENGTHS).nullable().optional(),
  /** Omitted or null: Standard. */
  contextBudget: z.enum(CONTEXT_BUDGETS).nullable().optional(),
  /** Omitted or null: follow the room rule. */
  webAccess: z.enum(WEB_ACCESS).nullable().optional(),
  /** Omitted or null: follow the room rule. */
  codeAccess: z.enum(CODE_ACCESS).nullable().optional(),
});
export type AddSeatInput = z.infer<typeof AddSeatInput>;

export const UpdateSeatInput = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    persona: z.string().trim().max(2000).nullable(),
    muted: z.boolean(),
    reasoningEffort: z.enum(REASONING_EFFORTS),
    /** null: back to the room rule. */
    answerLength: z.enum(ANSWER_LENGTHS).nullable(),
    /** null: back to Standard. */
    contextBudget: z.enum(CONTEXT_BUDGETS).nullable(),
    /** null: back to the room rule. */
    webAccess: z.enum(WEB_ACCESS).nullable(),
    /** null: back to the room rule. */
    codeAccess: z.enum(CODE_ACCESS).nullable(),
  })
  .partial();
export type UpdateSeatInput = z.infer<typeof UpdateSeatInput>;

/**
 * The answer length a seat works to (ADR 0012): its own setting, or else the room rule. The chair's message can still
 * ask for more or less on one turn; that's in the prompt, not here.
 */
export function seatAnswerLength(
  seat: Pick<Seat, "answerLength">,
  meeting: Pick<Meeting, "answerLength">,
): AnswerLength {
  return seat.answerLength ?? meeting.answerLength;
}

/** What a seat may do on the web (ADR 0017): its own setting, or else the room rule. */
export function seatWebAccess(
  seat: Pick<Seat, "webAccess">,
  meeting: Pick<Meeting, "webAccess">,
): WebAccess {
  return seat.webAccess ?? meeting.webAccess;
}

/** Whether a seat may run Python (ADR 0021): its own setting, or else the room rule. */
export function seatCodeAccess(
  seat: Pick<Seat, "codeAccess">,
  meeting: Pick<Meeting, "codeAccess">,
): CodeAccess {
  return seat.codeAccess ?? meeting.codeAccess;
}

export const MoveSeatInput = z.object({ direction: z.enum(["up", "down"]) });
export type MoveSeatInput = z.infer<typeof MoveSeatInput>;

/**
 * The one action API (ADR 0006): every send control produces this.
 * - `mode: "none"`: a comment; nobody answers. `text` is required.
 * - `targets: "everyone"`: every active (unmuted) seat, blind or in turn.
 * - `targets: [ids]`: those seats, in seat order (muted seats can be called directly).
 * - `replyTo`: the seats respond to that message; `text` is an optional note.
 */
export const SendActionInput = z
  .object({
    text: z.string().max(50_000).default(""),
    mode: z.enum(SEND_MODES),
    targets: z.union([z.literal("everyone"), z.array(z.string().uuid()).min(1).max(20)]),
    replyTo: z.string().uuid().nullable().default(null),
    /** Images and text files (ADR 0016). They count as content, so a message may be files alone. */
    attachments: z.array(AttachmentInput).max(ATTACHMENT_LIMITS.perMessage).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.attachments.length) return;
    if (v.mode === "none" && v.text.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["text"], message: "A comment needs text" });
    }
    if (
      v.mode !== "none" &&
      v.text.trim() === "" &&
      v.replyTo === null &&
      v.targets === "everyone"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "A question to everyone needs text",
      });
    }
  });
export type SendActionInput = z.input<typeof SendActionInput>;
export type SendAction = z.output<typeof SendActionInput>;

export const WrapUpInput = z.object({
  seatId: z.string().uuid(),
  kind: z.enum(WRAP_KINDS),
  /** Post it in the meeting so every seat sees it. Off by default: the chair reviews it first, then posts it. */
  post: z.boolean().default(false),
});
export type WrapUpInput = z.input<typeof WrapUpInput>;

export const StopInput = z.object({
  /** Stop one answer; omitted, stop everything running in the meeting. */
  messageId: z.string().uuid().optional(),
});
export type StopInput = z.infer<typeof StopInput>;

// ── Live stream events (ADR 0010) ───────────────────────────────────────────

export type MeetingEvent =
  | { type: "snapshot"; state: MeetingState }
  | { type: "meeting"; meeting: Meeting }
  | { type: "seat"; seat: Seat }
  | { type: "round"; round: Round }
  /** A message was created or changed (status, usage, final content). */
  | { type: "message"; message: Message }
  /** A seat's text so far was only leading up to a tool call, and the answer starts over (ADR 0014). */
  | { type: "text_reset"; messageId: string }
  /** Text streamed into a message. Apply only when `offset` equals the text you have. */
  | { type: "delta"; messageId: string; offset: number; text: string }
  /** The model is thinking (reasoning deltas are not shown, only that it's happening). */
  | { type: "thinking"; messageId: string };

// ── Models and allowance (from llmgw) ───────────────────────────────────────

export interface ModelInfo {
  id: string;
  ownedBy: Source;
  contextWindow: number | null;
  maxTokens: number | null;
  /** What the model reads, from llmgw 0.6.0's /v1/models; null from an older llmgw (ADR 0016). */
  input: ("text" | "image")[] | null;
  /** False when llmgw's validation failed, e.g. "not supported" on the current plan. */
  available: boolean;
  statusDetail: string | null;
}

/** llmgw `/v1/limits` `available`, as homestorm shows it. */
export type Allowance =
  | { kind: "percent"; percentLeft: number; resetsAt: string | null; binding: string }
  | { kind: "balance"; amount: number; currency: string }
  | { kind: "unlimited" }
  | { kind: "unavailable"; reason: string }
  | { kind: "unknown" };

export const LIMIT_STATUSES = ["ok", "warning", "exhausted", "unknown", "unavailable"] as const;
export type LimitStatus = (typeof LIMIT_STATUSES)[number];

export interface Limits {
  status: LimitStatus;
  available: Allowance;
}

/**
 * Whether homestorm lets a seat take the floor. Only a model that isn't on the plan is refused before the call: it
 * always fails. An "exhausted" allowance is shown but not enforced (2026-11-04): llmgw can say "exhausted" while the
 * provider still answers (Claude at 90% of its week), and a real rejection comes back as a visible problem anyway.
 */
export function canTakeFloor(limits: Limits | null | undefined): boolean {
  return !limits || limits.status !== "unavailable";
}
