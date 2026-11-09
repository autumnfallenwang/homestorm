// Reads and writes for meetings, seats, rounds and messages, returning the shared DTOs (ISO date strings).
// The engine and the routes go through here; nothing else writes these tables.

import type {
  AnswerLength,
  AttachmentMeta,
  AuthorKind,
  ContextBudget,
  Meeting,
  MeetingState,
  MeetingSummary,
  Message,
  MessageStatus,
  Poll,
  ReasoningEffort,
  Round,
  RoundMode,
  RoundStatus,
  Seat,
  SendMode,
  Source,
  WebAccess,
  WrapKind,
} from "@homestorm/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { attachments, meetings, messages, rounds, seats } from "../db/schema.js";

type MeetingRow = typeof meetings.$inferSelect;
type SeatRow = typeof seats.$inferSelect;
type RoundRow = typeof rounds.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type AttachmentRow = typeof attachments.$inferSelect;
export type AttachmentInsert = Omit<typeof attachments.$inferInsert, "id" | "createdAt">;
/** An attachment with its bytes, for building views and serving the file. */
export type AttachmentWithData = AttachmentMeta & { messageId: string; data: Buffer };

export function toAttachmentMeta(r: Omit<AttachmentRow, "data">): AttachmentMeta {
  return {
    id: r.id,
    kind: r.kind as AttachmentMeta["kind"],
    name: r.name,
    mime: r.mime,
    sizeBytes: r.sizeBytes,
    width: r.width,
    height: r.height,
    textChars: r.textChars,
  };
}

/** Every column but the bytes. */
const attachmentMetaColumns = {
  id: attachments.id,
  meetingId: attachments.meetingId,
  messageId: attachments.messageId,
  position: attachments.position,
  kind: attachments.kind,
  name: attachments.name,
  mime: attachments.mime,
  sizeBytes: attachments.sizeBytes,
  width: attachments.width,
  height: attachments.height,
  textChars: attachments.textChars,
  createdAt: attachments.createdAt,
};
export type MessageInsert = Omit<typeof messages.$inferInsert, "id" | "seq">;
export type MessagePatch = Partial<Omit<typeof messages.$inferInsert, "id" | "seq" | "meetingId">>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toMeeting(r: MeetingRow): Meeting {
  return {
    id: r.id,
    title: r.title,
    answerLength: r.answerLength as AnswerLength,
    webAccess: r.webAccess as WebAccess,
    clock: r.clock,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toSeat(r: SeatRow): Seat {
  return {
    id: r.id,
    meetingId: r.meetingId,
    model: r.model,
    ownedBy: r.ownedBy as Source,
    displayName: r.displayName,
    persona: r.persona,
    position: r.position,
    muted: r.muted,
    reasoningEffort: r.reasoningEffort as ReasoningEffort,
    answerLength: r.answerLength as AnswerLength | null,
    contextBudget: r.contextBudget as ContextBudget | null,
    webAccess: r.webAccess as WebAccess | null,
    removedAt: iso(r.removedAt),
    createdAt: r.createdAt.toISOString(),
  };
}

export function toRound(r: RoundRow): Round {
  return {
    id: r.id,
    meetingId: r.meetingId,
    number: r.number,
    mode: r.mode as RoundMode,
    seatIds: r.seatIds,
    promptMessageId: r.promptMessageId,
    replyToId: r.replyToId,
    wrapKind: r.wrapKind as WrapKind | null,
    poll: r.poll ?? null,
    status: r.status as RoundStatus,
    createdAt: r.createdAt.toISOString(),
    finishedAt: iso(r.finishedAt),
  };
}

export function toMessage(r: MessageRow, files: AttachmentMeta[] = []): Message {
  return {
    attachments: files,
    id: r.id,
    meetingId: r.meetingId,
    seq: r.seq,
    authorKind: r.authorKind as AuthorKind,
    seatId: r.seatId,
    roundId: r.roundId,
    replyToId: r.replyToId,
    content: r.content,
    status: r.status as MessageStatus,
    error: r.error ?? null,
    sendMode: r.sendMode as SendMode | "seats" | null,
    targetSeatIds: r.targetSeatIds ?? null,
    wrapKind: r.wrapKind as WrapKind | null,
    hiddenFromSeats: r.hiddenFromSeats,
    visibleSeq: r.visibleSeq,
    cutoffSeq: r.cutoffSeq,
    model: r.model,
    ownedBy: r.ownedBy as Source | null,
    reasoningEffort: r.reasoningEffort as ReasoningEffort | null,
    usage: r.usage ?? null,
    costUsd: r.costUsd,
    llmgwReqId: r.llmgwReqId,
    requestId: r.requestId,
    trimmedCount: r.trimmedCount,
    viewTokens: r.viewTokens,
    stoppedEarly: r.stoppedEarly,
    toolCalls: r.toolCalls,
    createdAt: r.createdAt.toISOString(),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
  };
}

export function createStore(db: Database) {
  return {
    // ── Meetings ──────────────────────────────────────────────────────────
    async listMeetings(): Promise<MeetingSummary[]> {
      // ⚠️ The subqueries name "meetings"."id" literally: drizzle renders ${meetings.id} unqualified inside
      // sql``, which then binds to the subquery's own table (seats.id) and every count came back 0.
      const rows = await db
        .select({
          id: meetings.id,
          title: meetings.title,
          createdAt: meetings.createdAt,
          updatedAt: meetings.updatedAt,
          seatCount: sql<number>`(SELECT count(*)::int FROM seats s WHERE s.meeting_id = "meetings"."id" AND s.removed_at IS NULL)`,
          live: sql<boolean>`EXISTS (SELECT 1 FROM rounds r WHERE r.meeting_id = "meetings"."id" AND r.status = 'running')`,
          postedWrapUp: sql<WrapKind | null>`(SELECT m.wrap_kind FROM messages m WHERE m.meeting_id = "meetings"."id" AND m.wrap_kind IS NOT NULL AND m.status = 'done' AND NOT m.hidden_from_seats ORDER BY m.seq DESC LIMIT 1)`,
        })
        .from(meetings)
        .orderBy(desc(meetings.updatedAt));
      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    },

    async createMeeting(title: string): Promise<Meeting> {
      const [row] = await db.insert(meetings).values({ title }).returning();
      return toMeeting(row as MeetingRow);
    },

    async getMeeting(id: string): Promise<Meeting | null> {
      const [row] = await db.select().from(meetings).where(eq(meetings.id, id));
      return row ? toMeeting(row) : null;
    },

    async updateMeeting(
      id: string,
      patch: Partial<Pick<MeetingRow, "title" | "answerLength" | "webAccess">>,
    ): Promise<Meeting | null> {
      const [row] = await db
        .update(meetings)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(meetings.id, id))
        .returning();
      return row ? toMeeting(row) : null;
    },

    async touchMeeting(id: string): Promise<void> {
      await db.update(meetings).set({ updatedAt: new Date() }).where(eq(meetings.id, id));
    },

    async deleteMeeting(id: string): Promise<boolean> {
      const rows = await db
        .delete(meetings)
        .where(eq(meetings.id, id))
        .returning({ id: meetings.id });
      return rows.length > 0;
    },

    /** +1 on the meeting clock; the new value marks a message entering the shared record. */
    async bumpClock(meetingId: string): Promise<number> {
      const [row] = await db
        .update(meetings)
        .set({ clock: sql`${meetings.clock} + 1`, updatedAt: new Date() })
        .where(eq(meetings.id, meetingId))
        .returning({ clock: meetings.clock });
      if (!row) throw new Error(`meeting ${meetingId} not found`);
      return row.clock;
    },

    async getState(meetingId: string): Promise<MeetingState | null> {
      const meeting = await this.getMeeting(meetingId);
      if (!meeting) return null;
      const [seatRows, roundRows, messageRows, fileRows] = await Promise.all([
        db.select().from(seats).where(eq(seats.meetingId, meetingId)).orderBy(asc(seats.position)),
        db.select().from(rounds).where(eq(rounds.meetingId, meetingId)).orderBy(asc(rounds.number)),
        db
          .select()
          .from(messages)
          .where(eq(messages.meetingId, meetingId))
          .orderBy(asc(messages.seq)),
        db
          .select(attachmentMetaColumns)
          .from(attachments)
          .where(eq(attachments.meetingId, meetingId))
          .orderBy(asc(attachments.position)),
      ]);
      const filesByMessage = new Map<string, AttachmentMeta[]>();
      for (const f of fileRows) {
        const list = filesByMessage.get(f.messageId) ?? [];
        list.push(toAttachmentMeta(f));
        filesByMessage.set(f.messageId, list);
      }
      return {
        meeting,
        seats: seatRows.map(toSeat),
        rounds: roundRows.map(toRound),
        messages: messageRows.map((m) => toMessage(m, filesByMessage.get(m.id) ?? [])),
      };
    },

    // ── Seats ─────────────────────────────────────────────────────────────
    async addSeat(input: {
      meetingId: string;
      model: string;
      ownedBy: Source;
      displayName: string;
      persona: string | null;
      reasoningEffort: ReasoningEffort;
      answerLength?: AnswerLength | null;
      contextBudget?: ContextBudget | null;
      webAccess?: WebAccess | null;
    }): Promise<Seat> {
      const [max] = await db
        .select({ value: sql<number>`coalesce(max(${seats.position}), -1)::int` })
        .from(seats)
        .where(eq(seats.meetingId, input.meetingId));
      const [row] = await db
        .insert(seats)
        .values({ ...input, position: (max?.value ?? -1) + 1 })
        .returning();
      return toSeat(row as SeatRow);
    },

    async getSeat(meetingId: string, seatId: string): Promise<Seat | null> {
      const [row] = await db
        .select()
        .from(seats)
        .where(and(eq(seats.id, seatId), eq(seats.meetingId, meetingId)));
      return row ? toSeat(row) : null;
    },

    /** Every seat the meeting ever had, removed ones included (seat names stay unique across them). */
    async allSeats(meetingId: string): Promise<Seat[]> {
      const rows = await db
        .select()
        .from(seats)
        .where(eq(seats.meetingId, meetingId))
        .orderBy(asc(seats.position));
      return rows.map(toSeat);
    },

    async activeSeats(meetingId: string): Promise<Seat[]> {
      const rows = await db
        .select()
        .from(seats)
        .where(and(eq(seats.meetingId, meetingId), isNull(seats.removedAt)))
        .orderBy(asc(seats.position));
      return rows.map(toSeat);
    },

    async updateSeat(
      seatId: string,
      patch: Partial<
        Pick<
          SeatRow,
          | "displayName"
          | "persona"
          | "muted"
          | "reasoningEffort"
          | "answerLength"
          | "contextBudget"
          | "webAccess"
          | "position"
          | "removedAt"
        >
      >,
    ): Promise<Seat> {
      const [row] = await db.update(seats).set(patch).where(eq(seats.id, seatId)).returning();
      return toSeat(row as SeatRow);
    },

    // ── Rounds ────────────────────────────────────────────────────────────
    async createRound(input: {
      meetingId: string;
      mode: RoundMode;
      seatIds: string[];
      promptMessageId: string | null;
      replyToId: string | null;
      wrapKind: WrapKind | null;
      poll?: Poll | null;
    }): Promise<Round> {
      const [max] = await db
        .select({ value: sql<number>`coalesce(max(${rounds.number}), 0)::int` })
        .from(rounds)
        .where(eq(rounds.meetingId, input.meetingId));
      const [row] = await db
        .insert(rounds)
        .values({ ...input, number: (max?.value ?? 0) + 1, status: "running" })
        .returning();
      return toRound(row as RoundRow);
    },

    async updateRound(
      roundId: string,
      patch: Partial<Pick<RoundRow, "status" | "finishedAt">>,
    ): Promise<Round> {
      const [row] = await db.update(rounds).set(patch).where(eq(rounds.id, roundId)).returning();
      return toRound(row as RoundRow);
    },

    async getRound(roundId: string): Promise<Round | null> {
      const [row] = await db.select().from(rounds).where(eq(rounds.id, roundId));
      return row ? toRound(row) : null;
    },

    // ── Messages ──────────────────────────────────────────────────────────
    // ── Attachments (ADR 0016) ────────────────────────────────────────────
    async insertAttachments(rows: AttachmentInsert[]): Promise<AttachmentMeta[]> {
      if (!rows.length) return [];
      const inserted = await db.insert(attachments).values(rows).returning(attachmentMetaColumns);
      return inserted.sort((a, b) => a.position - b.position).map(toAttachmentMeta);
    },

    /** With the bytes: for building views (the engine caches them; they never change). */
    async attachmentsWithData(meetingId: string, ids: string[]): Promise<AttachmentWithData[]> {
      if (!ids.length) return [];
      const rows = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.meetingId, meetingId), inArray(attachments.id, ids)));
      return rows.map((r) => ({ ...toAttachmentMeta(r), messageId: r.messageId, data: r.data }));
    },

    async getAttachment(meetingId: string, id: string): Promise<AttachmentWithData | null> {
      const [row] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.meetingId, meetingId), eq(attachments.id, id)));
      return row ? { ...toAttachmentMeta(row), messageId: row.messageId, data: row.data } : null;
    },

    async insertMessage(values: MessageInsert): Promise<Message> {
      const [row] = await db.insert(messages).values(values).returning();
      return toMessage(row as MessageRow);
    },

    async updateMessage(messageId: string, patch: MessagePatch): Promise<Message> {
      const [row] = await db
        .update(messages)
        .set(patch)
        .where(eq(messages.id, messageId))
        .returning();
      return toMessage(row as MessageRow);
    },

    async getMessage(meetingId: string, messageId: string): Promise<Message | null> {
      const [row] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.meetingId, meetingId)));
      return row ? toMessage(row) : null;
    },

    async roundMessages(roundId: string): Promise<Message[]> {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.roundId, roundId))
        .orderBy(asc(messages.seq));
      return rows.map((r) => toMessage(r));
    },

    /**
     * After a restart nothing is running (ADR 0010): answers still marked streaming become `stopped` with their
     * partial text, queued turns are skipped, and running rounds are stopped.
     */
    async recoverInterrupted(): Promise<{ stopped: number; skipped: number; rounds: number }> {
      const now = new Date();
      const stopped = await db
        .update(messages)
        .set({
          status: "stopped",
          finishedAt: now,
          error: {
            code: "interrupted",
            message: "The server restarted while this seat was answering.",
          },
        })
        .where(eq(messages.status, "streaming"))
        .returning({ id: messages.id });
      const skipped = await db
        .update(messages)
        .set({ status: "skipped", finishedAt: now })
        .where(eq(messages.status, "queued"))
        .returning({ id: messages.id });
      const stoppedRounds = await db
        .update(rounds)
        .set({ status: "stopped", finishedAt: now })
        .where(eq(rounds.status, "running"))
        .returning({ id: rounds.id });
      return { stopped: stopped.length, skipped: skipped.length, rounds: stoppedRounds.length };
    },

    async messagesByIds(ids: string[]): Promise<Message[]> {
      if (!ids.length) return [];
      const rows = await db.select().from(messages).where(inArray(messages.id, ids));
      return rows.map((r) => toMessage(r));
    },
  };
}

export type Store = ReturnType<typeof createStore>;
