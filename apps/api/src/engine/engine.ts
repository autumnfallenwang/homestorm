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
  briefAt,
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
  stripSpeakerTag,
  type WrapKind,
} from "@homestorm/shared";
import { log } from "../lib/logger.js";
import { type LlmClient, toLlmError } from "../services/llmgw.js";
import type { MessagePatch, Store } from "../services/store.js";
import type { EventHub } from "./hub.js";
import type { Floor, ReplyTarget } from "./prompts.js";
import { displayTokens } from "./tokens.js";
import { buildView } from "./view.js";

/** A refused action, mapped onto an HTTP status by the routes. */
export class EngineError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
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
  /** Most tokens one seat's view may use (ADR 0012). */
  viewTokenBudget: number;
  /** How often streamed text is written to Postgres (ms). It's in memory on every chunk. */
  flushIntervalMs?: number;
}

const RUNNING_ROUND = "A round is running. Wait for it to finish, or stop it first.";

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
  private readonly budget: number;
  private readonly flushIntervalMs: number;
  /** meeting id → its running round. */
  private readonly active = new Map<string, ActiveRound>();
  /** message id → text streamed so far (raw, before the speaker tag is stripped). */
  private readonly live = new Map<string, string>();

  constructor(opts: EngineOptions) {
    this.store = opts.store;
    this.llm = opts.llm;
    this.hub = opts.hub;
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
    action: SendAction,
  ): Promise<{ message: Message | null; round: Round | null }> {
    const meeting = await this.requireMeeting(meetingId);
    const text = action.text.trim();

    if (action.mode === "none") {
      const message = await this.postChair(meeting, {
        text,
        sendMode: "none",
        targetSeatIds: null,
        replyToId: action.replyTo,
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
        replyTo.authorKind === "brief"
      ) {
        throw new EngineError(400, "That message can't be replied to.");
      }
      if (replyTo.authorKind === "seat" && targets.some((s) => s.id === replyTo?.seatId)) {
        throw new EngineError(400, "A seat can't be asked to reply to its own message.");
      }
    }

    const message =
      text || replyTo
        ? await this.postChair(meeting, {
            text,
            sendMode: action.targets === "everyone" ? action.mode : "seats",
            targetSeatIds: action.targets === "everyone" ? null : targets.map((s) => s.id),
            replyToId: replyTo?.id ?? null,
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
  async setBrief(meetingId: string, content: string): Promise<Message | null> {
    await this.requireMeeting(meetingId);
    const text = content.trim();
    const state = await this.store.getState(meetingId);
    const current = state ? briefAt(state.messages, state.meeting.clock) : "";
    if (text === current) return null;
    const visibleSeq = await this.store.bumpClock(meetingId);
    const now = new Date();
    const message = await this.store.insertMessage({
      meetingId,
      authorKind: "brief",
      content: text,
      status: "done",
      visibleSeq,
      startedAt: now,
      finishedAt: now,
    });
    this.emit(meetingId, { type: "message", message });
    await this.emitMeeting(meetingId);
    log.info(
      { event: "brief.set", meeting_id: meetingId, chars: text.length, visible_seq: visibleSeq },
      text ? "meeting brief saved" : "meeting brief cleared",
    );
    return message;
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
    },
  ): Promise<Message> {
    const visibleSeq = await this.store.bumpClock(meeting.id);
    const now = new Date();
    const message = await this.store.insertMessage({
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

    // A seat that's out of allowance, or whose model isn't on the plan, can't take the floor (ADR 0002).
    const limits = await this.llm.limits(seat.model);
    if (!canTakeFloor(limits)) {
      const out = limits?.status === "exhausted";
      const reason = limits?.available.kind === "unavailable" ? limits.available.reason : undefined;
      await this.patch(msg, {
        status: "error",
        cutoffSeq,
        finishedAt: new Date(),
        error: {
          code: out ? "out_of_allowance" : "unavailable",
          message: out
            ? "Out of allowance until it resets."
            : (reason ?? "This model isn't available on the current plan."),
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
    const view = buildView({
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
    let text = "";
    this.live.set(messageId, "");
    let lastFlush = Date.now();
    let lastThinking = 0;
    let result: MessagePatch;
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
      for await (const ev of this.llm.stream({
        model: seat.model,
        messages: view.messages,
        maxTokens: outputCap,
        reasoningEffort: seat.reasoningEffort,
        requestId,
        signal: ac.signal,
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
          done = ev;
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
        const promptText = view.messages.map((m) => m.content).join("\n");
        result = {
          status: "done",
          content,
          finishedAt: new Date(),
          visibleSeq,
          usage: done.usage
            ? { ...done.usage, estimated: false }
            : {
                promptTokens: displayTokens(promptText),
                completionTokens: displayTokens(content),
                totalTokens: displayTokens(promptText) + displayTokens(content),
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

    const final = await this.patch(msg, result);
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
