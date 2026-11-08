// The meeting engine: the control layer (ADR 0006). It decides who speaks and what each seat sees; the models never
// do. Rounds run here, in the API process (ADR 0010): the browser only sends actions and follows the live stream.
//
// - One running round per meeting. A comment (mode "none") can be posted any time.
// - Blind: every seat starts at the same clock value, so none sees another's answer. In turn: one after another,
//   each starting after the previous answer entered the record.
// - Every seat message saves its cutoff (the clock when its turn started), so Retry gets the same view again.
// - Nothing is ever retried on another model, and every failure stays on the message, visible in place.

import { randomUUID } from "node:crypto";
import {
  type AttachmentInput,
  type AttachmentMeta,
  canTakeFloor,
  contextBudgetTokens,
  type Meeting,
  type MeetingEvent,
  type MeetingState,
  type Message,
  maxOutputTokens,
  type Round,
  type Seat,
  type SendAction,
  seatAnswerLength,
  seatWebAccess,
  stripSpeakerTag,
  type ToolActivity,
  type WebAccess,
  type WrapKind,
} from "@homestorm/shared";
import { log } from "../lib/logger.js";
import {
  AttachmentError,
  checkBriefAttachments,
  type PreparedAttachment,
  prepareAttachments,
} from "../services/attachments.js";
import {
  type ChatTurn,
  type LlmClient,
  type ToolCall,
  type ToolDefinition,
  toLlmError,
} from "../services/llmgw.js";
import type { ToolClient } from "../services/mcpgw.js";
import type { AttachmentWithData, MessagePatch, Store } from "../services/store.js";
import type { EventHub } from "./hub.js";
import type { Floor, ReplyTarget } from "./prompts.js";
import { displayTokens } from "./tokens.js";
import {
  allowedUrls,
  canonicalUrl,
  FORCED_SEARCH,
  LIMIT_REACHED,
  MAX_TOOL_CALLS_PER_TURN,
  readToolCall,
  researchNote,
  searchUrls,
  URL_REFUSED,
} from "./tools.js";
import { buildView, textOf, type ViewAttachment } from "./view.js";

/** A refused action, mapped onto an HTTP status by the routes. */
export class EngineError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 502 | 503,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

interface ActiveRound {
  roundId: string;
  controllers: Map<string, AbortController>;
  stopRequested: boolean;
  done: Promise<void>;
}

export interface EngineOptions {
  store: Store;
  llm: LlmClient;
  hub: EventHub;
  /** mcpgw (ADR 0014). Without it the web features are off, and everything else works as usual. */
  tools?: ToolClient | null;
  /** Most tokens one seat's view may use (ADR 0012). */
  viewTokenBudget: number;
  /** How often streamed text is written to Postgres (ms). It's in memory on every chunk. */
  flushIntervalMs?: number;
}

const RUNNING_ROUND = "A round is running. Wait for it to finish, or stop it first.";

/** Attachments kept decoded in memory; about 400 KB each after the browser's resize. */
const FILE_CACHE_MAX = 300;

/** Checked attachments, or a 400 the chair can read. */
function prepareOrRefuse(inputs: AttachmentInput[]): PreparedAttachment[] {
  try {
    return prepareAttachments(inputs);
  } catch (err) {
    if (err instanceof AttachmentError) throw new EngineError(400, err.message);
    throw err;
  }
}

/** How event lines name a wrap-up, e.g. "You posted Scribe's decision". */
const WRAP_NOUN: Record<WrapKind, string> = {
  minutes: "minutes",
  decision: "decision",
  open_questions: "open questions",
};

export class Engine {
  private readonly store: Store;
  private readonly llm: LlmClient;
  private readonly hub: EventHub;
  private readonly tools: ToolClient | null;
  private readonly budget: number;
  private readonly flushIntervalMs: number;
  /** meeting id → its running round. */
  private readonly active = new Map<string, ActiveRound>();
  /** message id → text streamed so far (raw, before the speaker tag is stripped). */
  private readonly live = new Map<string, string>();
  /** Attachments as views use them, by id (ADR 0016). */
  private readonly fileCache = new Map<string, ViewAttachment>();

  constructor(opts: EngineOptions) {
    this.store = opts.store;
    this.llm = opts.llm;
    this.hub = opts.hub;
    this.tools = opts.tools ?? null;
    this.budget = opts.viewTokenBudget;
    this.flushIntervalMs = opts.flushIntervalMs ?? 500;
  }

  isRunning(meetingId: string): boolean {
    return this.active.has(meetingId);
  }

  /** Resolves when the meeting's running round (if any) has finished. For tests and shutdown. */
  async waitIdle(meetingId?: string): Promise<void> {
    const rounds = meetingId ? [this.active.get(meetingId)] : [...this.active.values()];
    await Promise.all(rounds.map((r) => r?.done));
  }

  /** The meeting as saved, with the live text of answers still streaming (the stream's `snapshot`). */
  /** The Standard context budget (`VIEW_TOKEN_BUDGET`), for showing the presets' sizes. */
  get standardContextBudget(): number {
    return this.budget;
  }

  async snapshot(meetingId: string): Promise<MeetingState | null> {
    const state = await this.store.getState(meetingId);
    if (!state) return null;
    for (const m of state.messages) {
      const text = this.live.get(m.id);
      if (m.status === "streaming" && text !== undefined) m.content = text;
    }
    return state;
  }

  // ── Chair actions ─────────────────────────────────────────────────────────

  /** The one action API (ADR 0006): a message, a round, a reply-to, or "Ask now". */
  async send(
    meetingId: string,
    action: Omit<SendAction, "attachments"> & { attachments?: AttachmentInput[] },
  ): Promise<{ message: Message | null; round: Round | null }> {
    const meeting = await this.requireMeeting(meetingId);
    const text = action.text.trim();
    const files = prepareOrRefuse(action.attachments ?? []);

    if (action.mode === "none") {
      const message = await this.postChair(meeting, {
        text,
        sendMode: "none",
        targetSeatIds: null,
        replyToId: action.replyTo,
        files,
      });
      return { message, round: null };
    }
    if (this.isRunning(meetingId)) throw new EngineError(409, RUNNING_ROUND);

    const seats = await this.store.activeSeats(meetingId);
    let targets: Seat[];
    if (action.targets === "everyone") {
      targets = seats.filter((s) => !s.muted);
      if (!targets.length)
        throw new EngineError(400, "No active seats. Add a seat or unmute one first.");
    } else {
      const wanted = new Set(action.targets);
      targets = seats.filter((s) => wanted.has(s.id));
      if (targets.length !== wanted.size)
        throw new EngineError(400, "One of the chosen seats isn't in this meeting.");
    }

    let replyTo: Message | null = null;
    if (action.replyTo) {
      replyTo = await this.store.getMessage(meetingId, action.replyTo);
      if (
        replyTo?.status !== "done" ||
        replyTo.authorKind === "event" ||
        replyTo.authorKind === "brief" ||
        replyTo.authorKind === "sources"
      ) {
        throw new EngineError(400, "That message can't be replied to.");
      }
      if (replyTo.authorKind === "seat" && targets.some((s) => s.id === replyTo?.seatId)) {
        throw new EngineError(400, "A seat can't be asked to reply to its own message.");
      }
    }

    const message =
      text || replyTo || files.length
        ? await this.postChair(meeting, {
            text,
            sendMode: action.targets === "everyone" ? action.mode : "seats",
            targetSeatIds: action.targets === "everyone" ? null : targets.map((s) => s.id),
            replyToId: replyTo?.id ?? null,
            files,
          })
        : null;

    const round = await this.startRound(meeting, {
      mode: targets.length === 1 ? "single" : action.mode,
      seats: targets,
      promptMessageId: message?.id ?? null,
      replyToId: replyTo?.id ?? null,
      wrapKind: null,
      hidden: false,
    });
    return { message, round };
  }

  /** Wrap up: one seat writes the minutes, a decision, or the open questions. */
  async wrapUp(
    meetingId: string,
    input: { seatId: string; kind: WrapKind; post: boolean },
  ): Promise<Round> {
    const meeting = await this.requireMeeting(meetingId);
    if (this.isRunning(meetingId)) throw new EngineError(409, RUNNING_ROUND);
    const seat = await this.store.getSeat(meetingId, input.seatId);
    if (!seat || seat.removedAt) throw new EngineError(400, "That seat isn't in this meeting.");
    return this.startRound(meeting, {
      mode: "wrap_up",
      seats: [seat],
      promptMessageId: null,
      replyToId: null,
      wrapKind: input.kind,
      hidden: !input.post,
    });
  }

  /** Stop one answer, or everything running in the meeting. Stopped text is kept for the chair to keep or retry. */
  async stop(meetingId: string, messageId?: string): Promise<void> {
    const ctx = this.active.get(meetingId);
    if (messageId) {
      const msg = await this.store.getMessage(meetingId, messageId);
      if (!msg) throw new EngineError(404, "Message not found");
      if (msg.status === "queued") {
        await this.patch(msg, { status: "skipped", finishedAt: new Date() });
        return;
      }
      ctx?.controllers.get(messageId)?.abort();
      return;
    }
    if (!ctx) return;
    ctx.stopRequested = true;
    for (const c of ctx.controllers.values()) c.abort();
  }

  /** Stop every running round (shutdown). */
  stopAll(): void {
    for (const ctx of this.active.values()) {
      ctx.stopRequested = true;
      for (const c of ctx.controllers.values()) c.abort();
    }
  }

  /** Rerun the same seat on the same view (its saved cutoff), always with the same model. */
  async retry(meetingId: string, messageId: string): Promise<Round> {
    const meeting = await this.requireMeeting(meetingId);
    if (this.isRunning(meetingId)) throw new EngineError(409, RUNNING_ROUND);
    const msg = await this.store.getMessage(meetingId, messageId);
    if (msg?.authorKind !== "seat" || !msg.roundId || !msg.seatId) {
      throw new EngineError(404, "Seat message not found");
    }
    const seat = await this.store.getSeat(meetingId, msg.seatId);
    if (!seat || seat.removedAt) throw new EngineError(400, "That seat has left the meeting.");
    if (msg.status === "done") {
      // Regenerating is fine only while nothing has entered the record after it: others may have answered it.
      const state = await this.store.getState(meetingId);
      const later = state?.messages.some((m) => (m.visibleSeq ?? 0) > (msg.visibleSeq ?? 0));
      if (later)
        throw new EngineError(409, "Others have spoken since. Ask the seat again instead.");
    }
    let round = await this.store.getRound(msg.roundId);
    if (!round) throw new EngineError(404, "Round not found");

    round = await this.store.updateRound(round.id, { status: "running", finishedAt: null });
    this.emit(meetingId, { type: "round", round });
    const reset = await this.patch(msg, {
      status: "queued",
      content: "",
      error: null,
      visibleSeq: null,
      stoppedEarly: false,
      finishedAt: null,
    });
    const r = round;
    this.track(meetingId, r.id, async (c) => {
      const floor = await this.floorFor(meeting.id, r, reset);
      const cutoff = reset.cutoffSeq ?? (await this.requireMeeting(meeting.id)).clock;
      await this.runTurn(meeting.id, reset.id, cutoff, floor, c);
    });
    return round;
  }

  /** Keep a stopped answer's partial text: it enters the shared record. */
  async keep(meetingId: string, messageId: string): Promise<Message> {
    const msg = await this.store.getMessage(meetingId, messageId);
    if (!msg) throw new EngineError(404, "Message not found");
    if (msg.status !== "stopped" || !msg.content.trim()) {
      throw new EngineError(409, "Only a stopped answer with some text can be kept.");
    }
    const visibleSeq = msg.hiddenFromSeats ? null : await this.store.bumpClock(meetingId);
    const kept = await this.patch(msg, {
      status: "done",
      stoppedEarly: true,
      error: null,
      visibleSeq,
    });
    await this.emitMeeting(meetingId);
    return kept;
  }

  /** Post a wrap-up the chair held back to review (ADR 0007): it enters the shared record now. */
  async post(meetingId: string, messageId: string): Promise<Message> {
    const msg = await this.store.getMessage(meetingId, messageId);
    if (!msg) throw new EngineError(404, "Message not found");
    if (!msg.wrapKind || msg.status !== "done" || !msg.hiddenFromSeats) {
      throw new EngineError(409, "Only a finished wrap-up that isn't posted yet can be posted.");
    }
    const visibleSeq = await this.store.bumpClock(meetingId);
    const posted = await this.patch(msg, { hiddenFromSeats: false, visibleSeq });
    await this.emitMeeting(meetingId);
    const seat = msg.seatId ? await this.store.getSeat(meetingId, msg.seatId) : null;
    await this.addEvent(
      meetingId,
      `You posted ${seat?.displayName ?? "a former seat"}'s ${WRAP_NOUN[msg.wrapKind]}`,
    );
    return posted;
  }

  /** Skip a turn that failed, was stopped, or hasn't started. */
  async skip(meetingId: string, messageId: string): Promise<Message> {
    const msg = await this.store.getMessage(meetingId, messageId);
    if (!msg) throw new EngineError(404, "Message not found");
    if (!["error", "stopped", "queued"].includes(msg.status)) {
      throw new EngineError(409, "Only a failed, stopped or waiting turn can be skipped.");
    }
    return this.patch(msg, {
      status: "skipped",
      finishedAt: msg.finishedAt ? undefined : new Date(),
    });
  }

  /**
   * Set, change or clear the meeting brief (ADR 0015). Each change is a new version on the meeting clock, so a turn
   * gets the version from before it started. No change, no new version.
   */
  async setBrief(
    meetingId: string,
    content: string,
    files: { keepAttachmentIds?: string[]; attachments?: AttachmentInput[] } = {},
  ): Promise<Message | null> {
    await this.requireMeeting(meetingId);
    const text = content.trim();
    const state = await this.store.getState(meetingId);
    const currentMessage = state?.messages
      .filter((m) => m.authorKind === "brief" && m.visibleSeq !== null)
      .sort((a, b) => (a.visibleSeq ?? 0) - (b.visibleSeq ?? 0))
      .at(-1);
    const current = currentMessage?.content.trim() ?? "";
    const currentFiles = currentMessage?.attachments ?? [];
    // Omitted: keep every current file (a text-only edit). Otherwise only the ones named, in that order.
    const keepIds = files.keepAttachmentIds ?? currentFiles.map((f) => f.id);
    const kept = keepIds.map((id) => {
      const f = currentFiles.find((c) => c.id === id);
      if (!f) throw new EngineError(400, "That file isn't in the current brief.");
      return f;
    });
    const added = prepareOrRefuse(files.attachments ?? []);
    try {
      checkBriefAttachments(kept, added);
    } catch (err) {
      if (err instanceof AttachmentError) throw new EngineError(400, err.message);
      throw err;
    }
    const sameFiles =
      !added.length &&
      kept.length === currentFiles.length &&
      kept.every((f, i) => f.id === currentFiles[i]?.id);
    if (text === current && sameFiles) return null;

    const visibleSeq = await this.store.bumpClock(meetingId);
    const now = new Date();
    const inserted = await this.store.insertMessage({
      meetingId,
      authorKind: "brief",
      content: text,
      status: "done",
      visibleSeq,
      startedAt: now,
      finishedAt: now,
    });
    // Every version is whole: the files it keeps are copied to it, so older versions stay as they were.
    const keptRows = await this.store.attachmentsWithData(
      meetingId,
      kept.map((f) => f.id),
    );
    const carried: PreparedAttachment[] = kept.map((f) => {
      const row = keptRows.find((r) => r.id === f.id) as AttachmentWithData;
      return {
        kind: row.kind,
        name: row.name,
        mime: row.mime,
        sizeBytes: row.sizeBytes,
        width: row.width,
        height: row.height,
        textChars: row.textChars,
        data: row.data,
      };
    });
    const message = {
      ...inserted,
      attachments: await this.saveFiles(inserted, [...carried, ...added]),
    };
    this.emit(meetingId, { type: "message", message });
    await this.emitMeeting(meetingId);
    log.info(
      {
        event: "brief.set",
        meeting_id: meetingId,
        chars: text.length,
        files: message.attachments.length,
        visible_seq: visibleSeq,
      },
      text || message.attachments.length ? "meeting brief saved" : "meeting brief cleared",
    );
    return message;
  }

  /** Save a message's attachments, in order (ADR 0016). */
  private async saveFiles(
    message: Message,
    files: PreparedAttachment[],
  ): Promise<AttachmentMeta[]> {
    return this.store.insertAttachments(
      files.map((f, position) => ({
        ...f,
        meetingId: message.meetingId,
        messageId: message.id,
        position,
      })),
    );
  }

  /**
   * What a view needs of every attachment in the record: images as data URLs, text files as text. They never
   * change, so they're cached by id.
   */
  private async viewAttachments(state: MeetingState): Promise<Map<string, ViewAttachment[]>> {
    const wanted = state.messages.flatMap((m) => m.attachments.map((a) => a.id));
    const missing = wanted.filter((id) => !this.fileCache.has(id));
    if (missing.length) {
      for (const row of await this.store.attachmentsWithData(state.meeting.id, missing)) {
        this.fileCache.set(row.id, {
          kind: row.kind,
          name: row.name,
          width: row.width,
          height: row.height,
          ...(row.kind === "image"
            ? { url: `data:${row.mime};base64,${row.data.toString("base64")}` }
            : { text: row.data.toString("utf8") }),
        });
        if (this.fileCache.size > FILE_CACHE_MAX) {
          const oldest = this.fileCache.keys().next().value;
          if (oldest) this.fileCache.delete(oldest);
        }
      }
    }
    const map = new Map<string, ViewAttachment[]>();
    for (const m of state.messages) {
      const files = m.attachments
        .map((a) => this.fileCache.get(a.id))
        .filter((f): f is ViewAttachment => !!f);
      if (files.length) map.set(m.id, files);
    }
    return map;
  }

  /** A transcript line for the chair, e.g. "You muted Claude Sonnet 5.5 for rounds". Seats never see these. */
  async addEvent(meetingId: string, text: string): Promise<Message> {
    const message = await this.store.insertMessage({
      meetingId,
      authorKind: "event",
      content: text,
      status: "done",
      finishedAt: new Date(),
    });
    await this.store.touchMeeting(meetingId);
    this.emit(meetingId, { type: "message", message });
    return message;
  }

  emit(meetingId: string, event: MeetingEvent): void {
    this.hub.publish(meetingId, event);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async requireMeeting(meetingId: string): Promise<Meeting> {
    const meeting = await this.store.getMeeting(meetingId);
    if (!meeting) throw new EngineError(404, "Meeting not found");
    return meeting;
  }

  private async postChair(
    meeting: Meeting,
    p: {
      text: string;
      sendMode: Message["sendMode"];
      targetSeatIds: string[] | null;
      replyToId: string | null;
      files: PreparedAttachment[];
    },
  ): Promise<Message> {
    const visibleSeq = await this.store.bumpClock(meeting.id);
    const now = new Date();
    const inserted = await this.store.insertMessage({
      meetingId: meeting.id,
      authorKind: "chair",
      content: p.text,
      status: "done",
      sendMode: p.sendMode,
      targetSeatIds: p.targetSeatIds,
      replyToId: p.replyToId,
      visibleSeq,
      startedAt: now,
      finishedAt: now,
    });
    const message = { ...inserted, attachments: await this.saveFiles(inserted, p.files) };
    this.emit(meeting.id, { type: "message", message });
    await this.emitMeeting(meeting.id);
    return message;
  }

  private async startRound(
    meeting: Meeting,
    p: {
      mode: Round["mode"];
      seats: Seat[];
      promptMessageId: string | null;
      replyToId: string | null;
      wrapKind: WrapKind | null;
      hidden: boolean;
    },
  ): Promise<Round> {
    const round = await this.store.createRound({
      meetingId: meeting.id,
      mode: p.mode,
      seatIds: p.seats.map((s) => s.id),
      promptMessageId: p.promptMessageId,
      replyToId: p.replyToId,
      wrapKind: p.wrapKind,
    });
    this.emit(meeting.id, { type: "round", round });

    const turns: Message[] = [];
    for (const seat of p.seats) {
      const message = await this.store.insertMessage({
        meetingId: meeting.id,
        authorKind: "seat",
        seatId: seat.id,
        roundId: round.id,
        replyToId: p.replyToId,
        status: "queued",
        wrapKind: p.wrapKind,
        hiddenFromSeats: p.hidden,
        model: seat.model,
        ownedBy: seat.ownedBy,
        reasoningEffort: seat.reasoningEffort,
      });
      turns.push(message);
      this.emit(meeting.id, { type: "message", message });
    }

    this.track(meeting.id, round.id, (ctx) => this.runRound(meeting.id, round, turns, ctx));
    return round;
  }

  /** Register a running round and settle it (status, event) when its work ends, however it ends. */
  private track(
    meetingId: string,
    roundId: string,
    work: (ctx: ActiveRound) => Promise<void>,
  ): ActiveRound {
    const ctx: ActiveRound = {
      roundId,
      controllers: new Map(),
      stopRequested: false,
      done: Promise.resolve(),
    };
    this.active.set(meetingId, ctx);
    ctx.done = (async () => {
      try {
        await work(ctx);
      } catch (err) {
        log.error(
          { event: "round.failed", meeting_id: meetingId, round_id: roundId, err },
          "round failed",
        );
      } finally {
        try {
          const round = await this.store.updateRound(roundId, {
            status: ctx.stopRequested ? "stopped" : "done",
            finishedAt: new Date(),
          });
          await this.store.touchMeeting(meetingId);
          this.emit(meetingId, { type: "round", round });
        } catch (err) {
          log.error(
            { event: "round.settle_failed", meeting_id: meetingId, round_id: roundId, err },
            "round settle failed",
          );
        }
        this.active.delete(meetingId);
      }
    })();
    return ctx;
  }

  private async runRound(
    meetingId: string,
    round: Round,
    turns: Message[],
    ctx: ActiveRound,
  ): Promise<void> {
    if (round.mode === "blind") {
      const cutoff = (await this.requireMeeting(meetingId)).clock;
      await Promise.all(
        turns.map(async (m) =>
          this.runTurn(meetingId, m.id, cutoff, await this.floorFor(meetingId, round, m), ctx),
        ),
      );
      return;
    }
    for (const m of turns) {
      if (ctx.stopRequested) {
        const current = await this.store.getMessage(meetingId, m.id);
        if (current?.status === "queued")
          await this.patch(current, { status: "skipped", finishedAt: new Date() });
        continue;
      }
      const cutoff = (await this.requireMeeting(meetingId)).clock;
      await this.runTurn(meetingId, m.id, cutoff, await this.floorFor(meetingId, round, m), ctx);
    }
  }

  /** What the seat is told it's doing now, derived from its round (so a retry gets the same note). */
  /** The tools to offer this seat this turn, or null. mcpgw being down isn't a reason to fail the turn. */
  private async toolsFor(
    seat: Seat,
    web: WebAccess,
    floor: Floor,
  ): Promise<ToolDefinition[] | null> {
    if (!this.tools || web === "off" || floor.kind === "wrap_up") return null;
    try {
      return await this.tools.list();
    } catch (err) {
      log.warn({ event: "tools.unavailable", seat_id: seat.id, err }, "answering without tools");
      return null;
    }
  }

  /** Runs one tool call. Whatever goes wrong becomes text the model can read, and the turn carries on. */
  private async runToolCall(
    call: ToolCall,
    allowed: Set<string>,
    opts: { requestId: string; signal: AbortSignal },
  ): Promise<{ text: string; activity: ToolActivity }> {
    const parsed = readToolCall(call);
    if (!parsed.ok) {
      return {
        text: parsed.message,
        activity: {
          tool: parsed.tool,
          input: parsed.input,
          status: "failed",
          detail: parsed.message,
        },
      };
    }
    const { tool, input, args } = parsed;
    if (tool === "web_fetch" && !allowed.has(canonicalUrl(input) ?? "")) {
      return {
        text: URL_REFUSED,
        activity: { tool, input, status: "refused", detail: "Not from the Chair or a search" },
      };
    }
    try {
      const out = await this.tools!.call(tool, args, opts);
      if (out.isError) {
        return { text: out.text, activity: { tool, input, status: "failed", detail: out.text } };
      }
      if (tool === "web_search") {
        const urls = searchUrls(out.meta);
        for (const url of urls) allowed.add(canonicalUrl(url) ?? url);
        return { text: out.text, activity: { tool, input, status: "ok", urls } };
      }
      const title = typeof out.meta?.title === "string" ? out.meta.title : undefined;
      return {
        text: out.text,
        activity: { tool, input, status: "ok", ...(title ? { title } : {}) },
      };
    } catch (err) {
      if (opts.signal.aborted) throw err;
      log.warn({ event: "tool.call_failed", tool, err }, "tool call failed");
      const text = "The web tools aren't answering right now. Answer without them, and say so.";
      return { text, activity: { tool, input, status: "failed", detail: "mcpgw didn't answer" } };
    }
  }

  private async floorFor(meetingId: string, round: Round, m: Message): Promise<Floor> {
    let replyTo: ReplyTarget | undefined;
    if (round.replyToId) {
      const state = await this.store.getState(meetingId);
      const target = state?.messages.find((x) => x.id === round.replyToId);
      if (target) {
        const author =
          target.authorKind === "chair"
            ? "Chair"
            : (state?.seats.find((s) => s.id === target.seatId)?.displayName ??
              "A former participant");
        replyTo = { author, content: target.content };
      }
    }
    const count = round.seatIds.length;
    const index = round.seatIds.indexOf(m.seatId ?? "") + 1;
    switch (round.mode) {
      case "wrap_up":
        return { kind: "wrap_up", wrapKind: (round.wrapKind ?? "minutes") as WrapKind };
      case "blind":
        return { kind: "blind", count, replyTo };
      case "in_turn":
        return { kind: "in_turn", index: Math.max(index, 1), count, replyTo };
      default:
        return { kind: "direct", replyTo };
    }
  }

  /** One seat's turn: allowance check, build its view, stream from llmgw, save the outcome. */
  private async runTurn(
    meetingId: string,
    messageId: string,
    cutoffSeq: number,
    floor: Floor,
    ctx: ActiveRound,
  ): Promise<void> {
    const state = await this.store.getState(meetingId);
    const msg = state?.messages.find((m) => m.id === messageId);
    if (!state || !msg || msg.status !== "queued") return; // skipped meanwhile
    const seat = state.seats.find((s) => s.id === msg.seatId);
    if (!seat || seat.removedAt) {
      await this.patch(msg, { status: "skipped", finishedAt: new Date() });
      return;
    }
    const fields = {
      meeting_id: meetingId,
      message_id: messageId,
      seat_id: seat.id,
      model: seat.model,
      owned_by: seat.ownedBy,
    };

    // A model that isn't on the plan can't take the floor (ADR 0002). An exhausted allowance isn't refused here: the
    // provider decides, and a real rejection comes back as a 429 shown as "Out of allowance".
    const limits = await this.llm.limits(seat.model);
    if (!canTakeFloor(limits)) {
      const reason = limits?.available.kind === "unavailable" ? limits.available.reason : undefined;
      await this.patch(msg, {
        status: "error",
        cutoffSeq,
        finishedAt: new Date(),
        error: {
          code: "unavailable",
          message: reason ?? "This model isn't available on the current plan.",
        },
      });
      log.warn(
        { event: "turn.refused", ...fields, limit_status: limits?.status },
        "seat can't take the floor",
      );
      return;
    }

    const models = await this.llm.listModels().catch(() => []);
    const info = models.find((m) => m.id === seat.model);
    const outputCap = maxOutputTokens(
      seatAnswerLength(seat, state.meeting),
      seat.reasoningEffort,
      info?.maxTokens ?? null,
    );
    // The seat's own web setting, or the room rule (ADR 0017), as of when the turn starts.
    const web = seatWebAccess(seat, state.meeting);
    const tools = await this.toolsFor(seat, web, floor);
    const view = buildView({
      webTools: !!tools,
      meeting: state.meeting,
      seats: state.seats,
      messages: state.messages,
      seat,
      cutoffSeq,
      floor,
      budget: contextBudgetTokens(
        seat.contextBudget ?? "standard",
        info?.contextWindow ?? null,
        outputCap,
        this.budget,
      ),
      attachments: await this.viewAttachments(state),
    });

    const requestId = `homestorm-${randomUUID()}`;
    const startedAt = new Date();
    await this.patch(msg, {
      status: "streaming",
      content: "",
      error: null,
      cutoffSeq,
      startedAt,
      finishedAt: null,
      requestId,
      trimmedCount: view.trimmedCount,
      viewTokens: view.estimatedTokens,
      model: seat.model,
      ownedBy: seat.ownedBy,
      reasoningEffort: seat.reasoningEffort,
      usage: null,
      costUsd: null,
      llmgwReqId: null,
      stoppedEarly: false,
      toolCalls: [],
    });
    log.info(
      {
        event: "turn.start",
        ...fields,
        request_id: requestId,
        cutoff_seq: cutoffSeq,
        view_tokens_est: view.estimatedTokens,
        trimmed_count: view.trimmedCount,
      },
      "seat turn started",
    );

    const ac = new AbortController();
    ctx.controllers.set(messageId, ac);
    // Stop all can arrive while this turn was still setting up, before it had a controller to abort.
    if (ctx.stopRequested) ac.abort();
    let text = "";
    this.live.set(messageId, "");
    let lastFlush = Date.now();
    let lastThinking = 0;
    let result: MessagePatch;
    const activity: ToolActivity[] = [];
    try {
      let done: {
        usage: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          cacheReadTokens?: number;
        } | null;
        costUsd: number | null;
        llmgwReqId: string | null;
      } = {
        usage: null,
        costUsd: null,
        llmgwReqId: null,
      };

      // The tool loop (ADR 0014). Without tools, this runs once, exactly as it did before them.
      const allowed = tools ? allowedUrls(state.messages) : new Set<string>();
      const messages: ChatTurn["messages"] = [...view.messages];
      const research: string[] = [];
      let callsLeft = MAX_TOOL_CALLS_PER_TURN;
      let completionTokens = 0;
      let costUsd: number | null = null;
      for (let step = 0; ; step++) {
        const offer = tools && callsLeft > 0;
        const stepMessages: ChatTurn["messages"] =
          offer || !research.length
            ? messages
            : // The forced final answer, once the calls are used up: the research as plain text, and no tools. With
              // `tool_choice: "none"`, DeepSeek wrote its raw tool markup into the answer and Claude Opus returned no
              // text. Nothing here is tool state, so no provider has anything to mishandle.
              [...view.messages, { role: "user", content: researchNote(research) }];
        let toolCalls: ToolCall[] = [];
        for await (const ev of this.llm.stream({
          model: seat.model,
          messages: stepMessages,
          maxTokens: outputCap,
          reasoningEffort: seat.reasoningEffort,
          requestId,
          signal: ac.signal,
          ...(offer
            ? {
                tools: tools ?? [],
                toolChoice: step === 0 && web === "must" ? FORCED_SEARCH : ("auto" as const),
              }
            : {}),
        })) {
          if (ev.type === "text") {
            this.emit(meetingId, { type: "delta", messageId, offset: text.length, text: ev.text });
            text += ev.text;
            this.live.set(messageId, text);
            if (Date.now() - lastFlush >= this.flushIntervalMs) {
              lastFlush = Date.now();
              await this.store.updateMessage(messageId, { content: text });
            }
          } else if (ev.type === "thinking") {
            if (Date.now() - lastThinking >= 1_000) {
              lastThinking = Date.now();
              this.emit(meetingId, { type: "thinking", messageId });
            }
          } else {
            toolCalls = ev.toolCalls;
            if (ev.usage) completionTokens += ev.usage.completionTokens;
            if (ev.costUsd !== null) costUsd = (costUsd ?? 0) + ev.costUsd;
            done = {
              // One step reports what llmgw said, unchanged. Over several, the prompt is the last step's, since it
              // holds the others, and the output is all of them.
              usage:
                ev.usage && step > 0
                  ? {
                      ...ev.usage,
                      completionTokens,
                      totalTokens: ev.usage.promptTokens + completionTokens,
                    }
                  : ev.usage,
              costUsd,
              llmgwReqId: ev.llmgwReqId,
            };
          }
        }
        if (ac.signal.aborted) break;
        if (!offer || !toolCalls.length) break;

        // Text before a tool call is only leading up to it ("I'll check…"). The answer is what comes after.
        messages.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolCalls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: c.arguments },
          })),
        });
        text = "";
        this.live.set(messageId, "");
        this.emit(meetingId, { type: "text_reset", messageId });

        for (const call of toolCalls) {
          // Every call needs a result, or the provider refuses the next request.
          if (callsLeft <= 0) {
            messages.push({ role: "tool", tool_call_id: call.id, content: LIMIT_REACHED });
            continue;
          }
          callsLeft--;
          const read = readToolCall(call);
          activity.push({ tool: read.tool, input: read.input, status: "running" });
          await this.patch(msg, { content: "", toolCalls: [...activity] });

          const started = Date.now();
          const ran = await this.runToolCall(call, allowed, { requestId, signal: ac.signal });
          activity[activity.length - 1] = ran.activity;
          messages.push({ role: "tool", tool_call_id: call.id, content: ran.text });
          research.push(`${ran.activity.tool}: ${ran.activity.input}\n\n${ran.text}`);
          await this.patch(msg, { toolCalls: [...activity] });
          log.info(
            {
              event: "turn.tool",
              ...fields,
              request_id: requestId,
              tool: ran.activity.tool,
              status: ran.activity.status,
              duration_ms: Date.now() - started,
              calls_left: callsLeft,
            },
            "seat used a tool",
          );
        }
      }
      // A stream that ended because we aborted it is a stop, however the client reported it.
      if (ac.signal.aborted) throw new DOMException("The answer was stopped", "AbortError");
      const content = stripSpeakerTag(text).trim();
      if (!content) {
        result = {
          status: "error",
          content: "",
          finishedAt: new Date(),
          error: {
            code: "empty_answer",
            message: `The model returned no text. It may have spent its output limit (${outputCap.toLocaleString("en-US")} tokens) on thinking.`,
          },
        };
      } else {
        const visibleSeq = msg.hiddenFromSeats ? null : await this.store.bumpClock(meetingId);
        const promptText = view.messages.map(textOf).join("\n");
        const promptTokens = displayTokens(promptText) + view.imageTokens;
        result = {
          status: "done",
          content,
          finishedAt: new Date(),
          visibleSeq,
          usage: done.usage
            ? { ...done.usage, estimated: false }
            : {
                promptTokens,
                completionTokens: displayTokens(content),
                totalTokens: promptTokens + displayTokens(content),
                estimated: true,
              },
          costUsd: done.costUsd,
          llmgwReqId: done.llmgwReqId,
        };
      }
    } catch (err) {
      if (ac.signal.aborted) {
        result = { status: "stopped", content: text, finishedAt: new Date() };
      } else {
        const e = toLlmError(err);
        const code =
          "code" in e ? (e.code as NonNullable<Message["error"]>["code"]) : "gateway_error";
        const status = "status" in e ? (e.status as number | undefined) : undefined;
        result = {
          status: "error",
          content: text,
          finishedAt: new Date(),
          error: { code, message: e.message, ...(status ? { status } : {}) },
        };
      }
    } finally {
      ctx.controllers.delete(messageId);
      this.live.delete(messageId);
    }

    // A stop or an error can land while a call runs. It's not running any more.
    const toolCalls = activity.map(
      (c): ToolActivity =>
        c.status === "running" ? { ...c, status: "failed", detail: "Stopped" } : c,
    );
    const final = await this.patch(msg, { ...result, toolCalls });
    if (final.visibleSeq !== null) await this.emitMeeting(meetingId);
    const level = final.status === "error" ? "warn" : "info";
    log[level](
      {
        event: "turn.done",
        ...fields,
        request_id: requestId,
        status: final.status,
        ...(final.error ? { error_code: final.error.code, error_status: final.error.status } : {}),
        duration_ms: Date.now() - startedAt.getTime(),
        chars: final.content.length,
        tool_calls: toolCalls.length,
        usage_estimated: final.usage?.estimated,
        llmgw_req_id: final.llmgwReqId ?? undefined,
      },
      "seat turn finished",
    );
  }

  private async patch(msg: Message, patch: MessagePatch): Promise<Message> {
    const updated = await this.store.updateMessage(msg.id, patch);
    this.emit(msg.meetingId, { type: "message", message: updated });
    return updated;
  }

  private async emitMeeting(meetingId: string): Promise<void> {
    const meeting = await this.store.getMeeting(meetingId);
    if (meeting) this.emit(meetingId, { type: "meeting", meeting });
  }
}
