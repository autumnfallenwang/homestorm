// The meeting API. Every route here sits behind the admin session (middleware/auth.ts).
//
//   GET    /api/models                                 llmgw's chat models for the three sources, with each family's allowance
//   GET    /api/meetings                               meetings list
//   POST   /api/meetings                               create { title, brief? }
//   GET    /api/meetings/:id                           the whole meeting (MeetingState)
//   PATCH  /api/meetings/:id                           rename, answer length (a change adds an event line)
//   DELETE /api/meetings/:id
//   PUT    /api/meetings/:id/brief                     set, change or clear the meeting brief { content }
//   GET    /api/meetings/:id/events                    live stream (SSE): snapshot, then changes (ADR 0010)
//   GET    /api/meetings/:id/limits                    allowance per seat, from llmgw /v1/limits
//   POST   /api/meetings/:id/seats                     add a seat { model, displayName?, persona?, reasoningEffort? }
//   PATCH  /api/meetings/:id/seats/:seatId             rename, persona, mute, effort
//                                                      (a name another seat has, or had, is 409)
//   POST   /api/meetings/:id/seats/:seatId/move        { direction: up | down }
//   DELETE /api/meetings/:id/seats/:seatId             remove from the meeting
//   POST   /api/meetings/:id/actions                   the one action API { text, mode, targets, replyTo } (ADR 0006)
//   POST   /api/meetings/:id/wrap-up                   { seatId, kind, post }
//   POST   /api/meetings/:id/stop                      { messageId? }
//   POST   /api/meetings/:id/messages/:mid/retry|keep|skip|post

import {
  AddSeatInput,
  type AnswerLength,
  type ContextBudget,
  CreateMeetingInput,
  type Limits,
  type MeetingEvent,
  MoveSeatInput,
  prettyModelName,
  SendActionInput,
  SetBriefInput,
  type Source,
  StopInput,
  seatNameClash,
  seatNameClashMessage,
  UpdateMeetingInput,
  UpdateSeatInput,
  uniqueSeatName,
  WrapUpInput,
} from "@homestorm/shared";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import { type Engine, EngineError } from "../engine/engine.js";
import type { EventHub } from "../engine/hub.js";
import { log } from "../lib/logger.js";
import type { AuthVariables } from "../middleware/auth.js";
import { exportMarkdown } from "../services/export.js";
import type { LlmClient } from "../services/llmgw.js";
import type { Store } from "../services/store.js";

export interface MeetingDeps {
  engine: Engine;
  store: Store;
  llm: LlmClient;
  hub: EventHub;
  /** SSE keep-alive interval (ms). */
  heartbeatMs?: number;
}

type Ctx = Context<{ Variables: AuthVariables }>;

async function parse<T extends z.ZodTypeAny>(c: Ctx, schema: T): Promise<z.output<T> | Response> {
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success)
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  return parsed.data;
}

function fail(c: Ctx, err: unknown): Response {
  if (err instanceof EngineError) return c.json({ error: err.message }, err.status);
  throw err;
}

const LENGTH_LABEL: Record<AnswerLength, string> = { concise: "Concise", detailed: "Detailed" };
const BUDGET_LABEL: Record<ContextBudget, string> = {
  small: "Small",
  standard: "Standard",
  large: "Large",
  full: "Full",
};

export function meetingRoutes(deps: MeetingDeps) {
  const { engine, store, llm, hub } = deps;
  const app = new Hono<{ Variables: AuthVariables }>();

  // ── Models (for the add-seat dialog) ──────────────────────────────────────
  app.get("/models", async (c) => {
    try {
      const models = await llm.listModels();
      const families: Partial<Record<Source, Limits | null>> = {};
      for (const source of ["anthropic", "openai-codex", "deepseek"] as const) {
        const sample = models.find((m) => m.ownedBy === source && m.available);
        families[source] = sample ? await llm.limits(sample.id) : null;
      }
      return c.json({ models, families, standardContextBudget: engine.standardContextBudget });
    } catch (err) {
      log.warn({ event: "llmgw.models_failed", err }, "could not list models");
      return c.json({ error: "Couldn't reach llmgw to list models." }, 502);
    }
  });

  // ── Meetings ──────────────────────────────────────────────────────────────
  app.get("/meetings", async (c) => c.json(await store.listMeetings()));

  app.post("/meetings", async (c) => {
    const input = await parse(c, CreateMeetingInput);
    if (input instanceof Response) return input;
    const meeting = await store.createMeeting(input.title);
    if (input.brief?.trim()) await engine.setBrief(meeting.id, input.brief);
    return c.json((await store.getMeeting(meeting.id)) ?? meeting, 201);
  });

  // The meeting brief (ADR 0015): standing context every seat always sees. Empty clears it.
  app.put("/meetings/:id/brief", async (c) => {
    const input = await parse(c, SetBriefInput);
    if (input instanceof Response) return input;
    try {
      const message = await engine.setBrief(c.req.param("id"), input.content);
      return c.json({ changed: !!message, message });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/meetings/:id", async (c) => {
    const state = await engine.snapshot(c.req.param("id"));
    return state ? c.json(state) : c.json({ error: "Not found" }, 404);
  });

  app.patch("/meetings/:id", async (c) => {
    const input = await parse(c, UpdateMeetingInput);
    if (input instanceof Response) return input;
    const before = await store.getMeeting(c.req.param("id"));
    if (!before) return c.json({ error: "Not found" }, 404);
    const meeting = await store.updateMeeting(before.id, input);
    if (!meeting) return c.json({ error: "Not found" }, 404);
    engine.emit(meeting.id, { type: "meeting", meeting });
    // The room rule shapes every later turn, so the transcript and the export record when it changed.
    if (meeting.answerLength !== before.answerLength) {
      await engine.addEvent(meeting.id, `You set answers to ${LENGTH_LABEL[meeting.answerLength]}`);
    }
    return c.json(meeting);
  });

  app.delete("/meetings/:id", async (c) => {
    const id = c.req.param("id");
    await engine.stop(id);
    await engine.waitIdle(id);
    return (await store.deleteMeeting(id))
      ? c.body(null, 204)
      : c.json({ error: "Not found" }, 404);
  });

  app.get("/meetings/:id/export.md", async (c) => {
    const state = await engine.snapshot(c.req.param("id"));
    if (!state) return c.json({ error: "Not found" }, 404);
    const filename = `${
      state.meeting.title
        .replace(/[^\w\- ]+/g, "")
        .trim()
        .replace(/\s+/g, "-") || "meeting"
    }.md`;
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.body(exportMarkdown(state));
  });

  // ── Live stream (ADR 0010) ────────────────────────────────────────────────
  app.get("/meetings/:id/events", async (c) => {
    const id = c.req.param("id");
    if (!(await store.getMeeting(id))) return c.json({ error: "Not found" }, 404);
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      // Subscribe before the snapshot so nothing falls in between; buffered events that the snapshot already
      // contains are harmless (deltas apply only at their offset, other events replace).
      const queue: MeetingEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = hub.subscribe(id, (event) => {
        queue.push(event);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      try {
        const state = await engine.snapshot(id);
        if (!state) return;
        await stream.writeSSE({
          event: "message",
          data: JSON.stringify({ type: "snapshot", state } satisfies MeetingEvent),
        });
        const heartbeatMs = deps.heartbeatMs ?? 15_000;
        while (!stream.aborted) {
          while (queue.length) {
            const event = queue.shift() as MeetingEvent;
            await stream.writeSSE({ event: "message", data: JSON.stringify(event) });
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, heartbeatMs);
          });
          wake = null;
          if (!queue.length && !stream.aborted) await stream.write(": ping\n\n");
        }
      } finally {
        unsubscribe();
      }
    });
  });

  // ── Allowance per seat ────────────────────────────────────────────────────
  app.get("/meetings/:id/limits", async (c) => {
    const seats = await store.activeSeats(c.req.param("id"));
    const entries = await Promise.all(
      seats.map(async (s) => [s.id, await llm.limits(s.model)] as const),
    );
    return c.json(Object.fromEntries(entries));
  });

  // ── Seats ─────────────────────────────────────────────────────────────────
  app.post("/meetings/:id/seats", async (c) => {
    const id = c.req.param("id");
    const input = await parse(c, AddSeatInput);
    if (input instanceof Response) return input;
    if (!(await store.getMeeting(id))) return c.json({ error: "Not found" }, 404);
    let models: Awaited<ReturnType<LlmClient["listModels"]>>;
    try {
      models = await llm.listModels();
    } catch {
      return c.json({ error: "Couldn't reach llmgw to check the model." }, 502);
    }
    const model = models.find((m) => m.id === input.model);
    if (!model) return c.json({ error: `llmgw has no model "${input.model}".` }, 400);
    if (!model.available)
      return c.json({ error: `${input.model} isn't on the current plan.` }, 400);
    const existing = await store.allSeats(id);
    const clash = input.displayName && seatNameClash(input.displayName, existing);
    if (clash) return c.json({ error: seatNameClashMessage(clash) }, 409);
    const seat = await store.addSeat({
      meetingId: id,
      model: model.id,
      ownedBy: model.ownedBy,
      displayName:
        input.displayName ??
        uniqueSeatName(
          prettyModelName(model.id),
          existing.map((s) => s.displayName),
        ),
      persona: input.persona?.trim() || null,
      reasoningEffort: input.reasoningEffort ?? "low",
      answerLength: input.answerLength ?? null,
      contextBudget: input.contextBudget ?? null,
    });
    engine.emit(id, { type: "seat", seat });
    await engine.addEvent(id, `You added ${seat.displayName}`);
    return c.json(seat, 201);
  });

  app.patch("/meetings/:id/seats/:seatId", async (c) => {
    const id = c.req.param("id");
    const input = await parse(c, UpdateSeatInput);
    if (input instanceof Response) return input;
    const before = await store.getSeat(id, c.req.param("seatId"));
    if (!before || before.removedAt) return c.json({ error: "Not found" }, 404);
    if (input.displayName) {
      const clash = seatNameClash(input.displayName, await store.allSeats(id), before.id);
      if (clash) return c.json({ error: seatNameClashMessage(clash) }, 409);
    }
    const seat = await store.updateSeat(before.id, input);
    engine.emit(id, { type: "seat", seat });
    if (input.muted !== undefined && input.muted !== before.muted) {
      await engine.addEvent(
        id,
        `You ${seat.muted ? "muted" : "unmuted"} ${seat.displayName} for rounds`,
      );
    }
    if (input.displayName && input.displayName !== before.displayName) {
      await engine.addEvent(id, `You renamed ${before.displayName} to ${seat.displayName}`);
    }
    // Like the room rule, a seat's answer length and context budget shape its later turns, so the transcript
    // records each change.
    if (input.answerLength !== undefined && input.answerLength !== before.answerLength) {
      await engine.addEvent(
        id,
        seat.answerLength
          ? `You set ${seat.displayName}'s answers to ${LENGTH_LABEL[seat.answerLength]}`
          : `You set ${seat.displayName}'s answers back to the room rule`,
      );
    }
    if (
      input.contextBudget !== undefined &&
      (input.contextBudget ?? "standard") !== (before.contextBudget ?? "standard")
    ) {
      await engine.addEvent(
        id,
        `You set ${seat.displayName}'s context budget to ${BUDGET_LABEL[seat.contextBudget ?? "standard"]}`,
      );
    }
    return c.json(seat);
  });

  app.post("/meetings/:id/seats/:seatId/move", async (c) => {
    const id = c.req.param("id");
    const input = await parse(c, MoveSeatInput);
    if (input instanceof Response) return input;
    const seats = await store.activeSeats(id);
    const i = seats.findIndex((s) => s.id === c.req.param("seatId"));
    if (i < 0) return c.json({ error: "Not found" }, 404);
    const j = input.direction === "up" ? i - 1 : i + 1;
    const a = seats[i];
    const b = seats[j];
    if (a && b) {
      const [na, nb] = await Promise.all([
        store.updateSeat(a.id, { position: b.position }),
        store.updateSeat(b.id, { position: a.position }),
      ]);
      engine.emit(id, { type: "seat", seat: na });
      engine.emit(id, { type: "seat", seat: nb });
    }
    return c.json(await store.activeSeats(id));
  });

  app.delete("/meetings/:id/seats/:seatId", async (c) => {
    const id = c.req.param("id");
    const seat = await store.getSeat(id, c.req.param("seatId"));
    if (!seat || seat.removedAt) return c.json({ error: "Not found" }, 404);
    const state = await engine.snapshot(id);
    if (
      state?.messages.some(
        (m) => m.seatId === seat.id && (m.status === "streaming" || m.status === "queued"),
      )
    ) {
      return c.json({ error: "This seat is answering or waiting to answer. Stop it first." }, 409);
    }
    const removed = await store.updateSeat(seat.id, { removedAt: new Date() });
    engine.emit(id, { type: "seat", seat: removed });
    await engine.addEvent(id, `You removed ${seat.displayName} from the meeting`);
    return c.body(null, 204);
  });

  // ── The one action API (ADR 0006) ─────────────────────────────────────────
  app.post("/meetings/:id/actions", async (c) => {
    const input = await parse(c, SendActionInput);
    if (input instanceof Response) return input;
    try {
      return c.json(await engine.send(c.req.param("id"), input), 202);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/meetings/:id/wrap-up", async (c) => {
    const input = await parse(c, WrapUpInput);
    if (input instanceof Response) return input;
    try {
      return c.json(await engine.wrapUp(c.req.param("id"), input), 202);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/meetings/:id/stop", async (c) => {
    const input = await parse(c, StopInput);
    if (input instanceof Response) return input;
    try {
      await engine.stop(c.req.param("id"), input.messageId);
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  for (const action of ["retry", "keep", "skip", "post"] as const) {
    app.post(`/meetings/:id/messages/:mid/${action}`, async (c) => {
      try {
        const result = await engine[action](c.req.param("id"), c.req.param("mid"));
        return c.json(result, action === "retry" ? 202 : 200);
      } catch (err) {
        return fail(c, err);
      }
    });
  }

  return app;
}
