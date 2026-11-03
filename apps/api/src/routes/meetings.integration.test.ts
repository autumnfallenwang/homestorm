// The meeting API end to end over HTTP (Hono's app.request), with Postgres and a scripted llmgw.
import type { MeetingEvent, MeetingState, Seat } from "@homestorm/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { closeDb, db } from "../db/index.js";
import { Engine } from "../engine/engine.js";
import { EventHub } from "../engine/hub.js";
import { createStore } from "../services/store.js";
import { hasTestDb, truncateAll } from "../test/db.js";
import { FakeLlm } from "../test/fake-llm.js";
import { asAdmin, asNobody } from "../test/sessions.js";
import { meetingRoutes } from "./meetings.js";

function setup(resolveSession = asAdmin) {
  const store = createStore(db);
  const llm = new FakeLlm();
  const hub = new EventHub();
  const engine = new Engine({ store, llm, hub, viewTokenBudget: 120_000, flushIntervalMs: 0 });
  const app = createApp({
    resolveSession,
    rateLimit: false,
    mount: (a) => a.route("/api", meetingRoutes({ engine, store, llm, hub, heartbeatMs: 50 })),
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = res.headers.get("content-type")?.includes("json");
    return { status: res.status, body: json && text ? JSON.parse(text) : null, text };
  };
  return { app, call, engine, llm };
}

/** Read SSE events until `stop` says enough. */
async function readEvents(
  res: Response,
  stop: (events: MeetingEvent[]) => boolean,
): Promise<MeetingEvent[]> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const events: MeetingEvent[] = [];
  let buffer = "";
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i = buffer.indexOf("\n\n");
    while (i >= 0) {
      const frame = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (data) events.push(JSON.parse(data) as MeetingEvent);
      i = buffer.indexOf("\n\n");
    }
    if (stop(events)) break;
  }
  await reader.cancel();
  return events;
}

describe.skipIf(!hasTestDb)("meeting API (integration)", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  it("refuses everything without a session", async () => {
    const { call } = setup(asNobody);
    expect((await call("GET", "/api/meetings")).status).toBe(401);
    expect((await call("GET", "/api/models")).status).toBe(401);
  });

  it("creates a meeting, adds seats from llmgw's models and runs a blind round", async () => {
    const { call, engine } = setup();
    const created = await call("POST", "/api/meetings", { title: "Caching" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const models = await call("GET", "/api/models");
    expect(models.body.models.map((m: { id: string }) => m.id)).toContain("gpt-6-luna");
    expect(models.body.families.anthropic.status).toBe("ok");

    const a = await call("POST", `/api/meetings/${id}/seats`, { model: "claude-opus-5-5" });
    const b = await call("POST", `/api/meetings/${id}/seats`, {
      model: "gpt-6-luna",
      persona: "Skeptic",
    });
    const dup = await call("POST", `/api/meetings/${id}/seats`, { model: "gpt-6-luna" });
    expect(a.body.displayName).toBe("Claude Opus 5.5");
    expect(b.body.persona).toBe("Skeptic");
    expect(dup.body.displayName).toBe("GPT-6 Luna (2)");

    expect((await call("POST", `/api/meetings/${id}/seats`, { model: "gpt-6-sol" })).status).toBe(
      400,
    );
    expect((await call("POST", `/api/meetings/${id}/seats`, { model: "nope-1" })).status).toBe(400);

    const sent = await call("POST", `/api/meetings/${id}/actions`, {
      text: "Edge or API?",
      mode: "blind",
      targets: "everyone",
    });
    expect(sent.status).toBe(202);
    expect(sent.body.round.mode).toBe("blind");
    await engine.waitIdle(id);

    const state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    const answers = state.messages.filter((m) => m.authorKind === "seat");
    expect(answers.map((m) => m.status)).toEqual(["done", "done", "done"]);
    expect(state.messages.filter((m) => m.authorKind === "event").map((m) => m.content)).toEqual([
      "You added Claude Opus 5.5",
      "You added GPT-6 Luna",
      "You added GPT-6 Luna (2)",
    ]);

    const list = await call("GET", "/api/meetings");
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      title: "Caching",
      seatCount: 3,
      live: false,
      hasMinutes: false,
    });
  });

  it("validates actions and maps engine refusals onto 400/404/409", async () => {
    const { call } = setup();
    const id = (await call("POST", "/api/meetings", { title: "T" })).body.id as string;
    expect(
      (
        await call("POST", `/api/meetings/${id}/actions`, {
          text: "",
          mode: "none",
          targets: "everyone",
        })
      ).status,
    ).toBe(400);
    // No seats yet.
    const none = await call("POST", `/api/meetings/${id}/actions`, {
      text: "Q",
      mode: "blind",
      targets: "everyone",
    });
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/No active seats/);
    expect(
      (
        await call("POST", "/api/meetings/00000000-0000-4000-8000-000000000999/actions", {
          text: "Q",
          mode: "blind",
          targets: "everyone",
        })
      ).status,
    ).toBe(404);
    expect((await call("POST", "/api/meetings", { title: "" })).status).toBe(400);
  });

  it("mutes, moves and removes seats, with event lines", async () => {
    const { call } = setup();
    const id = (await call("POST", "/api/meetings", { title: "T" })).body.id as string;
    const a = (await call("POST", `/api/meetings/${id}/seats`, { model: "claude-opus-5-5" }))
      .body as Seat;
    const b = (await call("POST", `/api/meetings/${id}/seats`, { model: "gpt-6-luna" }))
      .body as Seat;

    expect(
      (await call("PATCH", `/api/meetings/${id}/seats/${b.id}`, { muted: true })).body.muted,
    ).toBe(true);
    const moved = (
      await call("POST", `/api/meetings/${id}/seats/${b.id}/move`, { direction: "up" })
    ).body as Seat[];
    expect(moved.map((s) => s.id)).toEqual([b.id, a.id]);
    expect((await call("DELETE", `/api/meetings/${id}/seats/${a.id}`)).status).toBe(204);

    const state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    expect(state.seats.find((s) => s.id === a.id)?.removedAt).not.toBeNull();
    const lines = state.messages.filter((m) => m.authorKind === "event").map((m) => m.content);
    expect(lines).toContain("You muted GPT-6 Luna for rounds");
    expect(lines).toContain("You removed Claude Opus 5.5 from the meeting");
  });

  it("keeps seat names unique: two seats on one model get different names", async () => {
    const { call } = setup();
    const id = (await call("POST", "/api/meetings", { title: "T" })).body.id as string;
    const seats = `/api/meetings/${id}/seats`;
    const a = (await call("POST", seats, { model: "claude-opus-5-5" })).body as Seat;
    const b = (await call("POST", seats, { model: "claude-opus-5-5" })).body as Seat;
    expect([a.displayName, b.displayName]).toEqual(["Claude Opus 5.5", "Claude Opus 5.5 (2)"]);

    // A name another seat has is refused, whatever its case, when adding or renaming.
    const taken = await call("POST", seats, {
      model: "claude-opus-5-5",
      displayName: "claude opus 5.5",
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe(
      'Another seat is already called "Claude Opus 5.5". Pick another name.',
    );
    expect(
      (await call("PATCH", `${seats}/${b.id}`, { displayName: "Claude Opus 5.5" })).status,
    ).toBe(409);

    // A seat may keep its own name (or change its case), and a free name is fine.
    expect(
      (await call("PATCH", `${seats}/${a.id}`, { displayName: "Claude opus 5.5" })).status,
    ).toBe(200);
    const skeptic = await call("PATCH", `${seats}/${b.id}`, { displayName: "The Skeptic" });
    expect(skeptic.body.displayName).toBe("The Skeptic");

    // A removed seat's messages keep its name, so the name stays taken.
    expect((await call("DELETE", `${seats}/${a.id}`)).status).toBe(204);
    const again = (await call("POST", seats, { model: "claude-opus-5-5" })).body as Seat;
    expect(again.displayName).toBe("Claude Opus 5.5 (2)");
    const reuse = await call("POST", seats, {
      model: "gpt-6-luna",
      displayName: "Claude opus 5.5",
    });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error).toMatch(/^A seat you removed was called "Claude opus 5.5"/);

    const state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    expect(state.seats.map((s) => s.displayName)).toEqual([
      "Claude opus 5.5",
      "The Skeptic",
      "Claude Opus 5.5 (2)",
    ]);
  });

  it("live stream: snapshot first, then deltas and the finished answer", async () => {
    const { app, call, llm } = setup();
    llm.on("claude-opus-5-5", { chunks: ["Hello ", "chair"], delayMs: 20 });
    const id = (await call("POST", "/api/meetings", { title: "T" })).body.id as string;
    await call("POST", `/api/meetings/${id}/seats`, { model: "claude-opus-5-5" });

    const res = await app.request(`/api/meetings/${id}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reading = readEvents(res, (evs) =>
      evs.some((e) => e.type === "round" && e.round.status === "done"),
    );
    await new Promise((r) => setTimeout(r, 30));
    await call("POST", `/api/meetings/${id}/actions`, {
      text: "Hi",
      mode: "blind",
      targets: "everyone",
    });
    const events = await reading;

    expect(events[0]?.type).toBe("snapshot");
    const text = events
      .filter((e): e is Extract<MeetingEvent, { type: "delta" }> => e.type === "delta")
      .map((e) => e.text)
      .join("");
    expect(text).toBe("Hello chair");
    const final = events.filter((e) => e.type === "message").at(-1);
    expect(final).toMatchObject({ message: { status: "done", content: "Hello chair" } });
  });

  it("exports the meeting as Markdown", async () => {
    const { call, engine } = setup();
    const id = (await call("POST", "/api/meetings", { title: "Edge vs API" })).body.id as string;
    await call("POST", `/api/meetings/${id}/seats`, { model: "claude-opus-5-5" });
    await call("POST", `/api/meetings/${id}/actions`, {
      text: "Where to cache?",
      mode: "blind",
      targets: "everyone",
    });
    await engine.waitIdle(id);
    const res = await call("GET", `/api/meetings/${id}/export.md`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("# Edge vs API");
    expect(res.text).toContain("| Claude Opus 5.5 | `claude-opus-5-5` | Claude · subscription |");
    expect(res.text).toContain("### Round 1 · One seat");
    expect(res.text).toContain("> Where to cache?");
    expect(res.text).toContain("answer from claude-opus-5-5");
  });

  it("deletes a meeting", async () => {
    const { call } = setup();
    const id = (await call("POST", "/api/meetings", { title: "T" })).body.id as string;
    expect((await call("DELETE", `/api/meetings/${id}`)).status).toBe(204);
    expect((await call("GET", `/api/meetings/${id}`)).status).toBe(404);
  });
});
