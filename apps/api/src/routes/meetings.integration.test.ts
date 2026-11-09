// The meeting API end to end over HTTP (Hono's app.request), with Postgres and a scripted llmgw.
import type { MeetingEvent, MeetingState, MeetingSummary, Seat } from "@homestorm/shared";
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
      postedWrapUp: null,
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

  it("exports skipped turns, who a reply went to, and long personas cut with an ellipsis", async () => {
    const { call, engine, llm } = setup();
    llm.on("gpt-6-luna", { chunks: [] }, { chunks: ["Pushing back."] });
    const id = (await call("POST", "/api/meetings", { title: "Export details" })).body.id as string;
    await call("POST", `/api/meetings/${id}/seats`, {
      model: "claude-opus-5-5",
      persona: `Play the skeptic. ${"Push back on extra work. ".repeat(10)}`,
    });
    const gpt = (await call("POST", `/api/meetings/${id}/seats`, { model: "gpt-6-luna" })).body;
    await call("POST", `/api/meetings/${id}/actions`, {
      text: "Q",
      mode: "blind",
      targets: "everyone",
    });
    await engine.waitIdle(id);
    const state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    const failed = state.messages.find((m) => m.seatId === gpt.id)!;
    const claudeAnswer = state.messages.find(
      (m) => m.authorKind === "seat" && m.seatId !== gpt.id,
    )!;
    expect(failed.status).toBe("error");
    expect((await call("POST", `/api/meetings/${id}/messages/${failed.id}/skip`)).status).toBe(200);
    await call("POST", `/api/meetings/${id}/actions`, {
      text: "Push back",
      mode: "blind",
      targets: [gpt.id],
      replyTo: claudeAnswer.id,
    });
    await engine.waitIdle(id);

    const md = (await call("GET", `/api/meetings/${id}/export.md`)).text;
    expect(md).toContain("_GPT-6 Luna skipped this turn_");
    expect(md).toContain("**Chair** · to GPT-6 Luna · replying to Claude Opus 5.5");
    expect(md).toMatch(/persona: Play the skeptic\. Push back on extra work\.[^|]*…/);
  });

  it("keeps llmgw's cost and exports it as spend for DeepSeek only", async () => {
    const { call, engine, llm } = setup();
    // llmgw 0.8.0 prices every reply; for a subscription it's a list-price equivalent, not money paid.
    llm.on("claude-opus-5-5", { chunks: ["Claude."], costUsd: 0.0668 });
    llm.on("deepseek-v4-pro", { chunks: ["DeepSeek."], costUsd: 0.0123 });
    const id = (await call("POST", "/api/meetings", { title: "Cost" })).body.id as string;
    await call("POST", `/api/meetings/${id}/seats`, { model: "claude-opus-5-5" });
    await call("POST", `/api/meetings/${id}/seats`, { model: "deepseek-v4-pro" });
    await call("POST", `/api/meetings/${id}/actions`, {
      text: "Q",
      mode: "blind",
      targets: "everyone",
    });
    await engine.waitIdle(id);

    const state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    const costs = state.messages.filter((m) => m.authorKind === "seat").map((m) => m.costUsd);
    expect(costs.sort()).toEqual([0.0123, 0.0668]); // both kept, as llmgw sent them
    const md = (await call("GET", `/api/meetings/${id}/export.md`)).text;
    expect(md).toContain("$0.0123");
    expect(md).not.toContain("$0.0668");
  });

  it("takes a poll, and exports it as a tally and a table (ADR 0020)", async () => {
    const { call, engine, llm } = setup();
    llm.on("claude-opus-5-5", {
      chunks: ["**Choice:** Yes · **Confidence:** 80% · **Why:** tests pass."],
    });
    llm.on("gpt-6-luna", { chunks: ["I won't pick."] });
    const id = (await call("POST", "/api/meetings", { title: "Poll" })).body.id as string;
    await call("POST", `/api/meetings/${id}/seats`, { model: "claude-opus-5-5" });
    await call("POST", `/api/meetings/${id}/seats`, { model: "gpt-6-luna" });

    expect((await call("POST", `/api/meetings/${id}/poll`, { question: " " })).status).toBe(400);
    expect(
      (await call("POST", `/api/meetings/${id}/poll`, { question: "Q", options: ["A", "a"] }))
        .status,
    ).toBe(400);
    const res = await call("POST", `/api/meetings/${id}/poll`, {
      question: "Ship it?",
      options: ["Yes", "No"],
    });
    expect(res.status).toBe(202);
    expect(res.body.round).toMatchObject({ mode: "poll", poll: { question: "Ship it?" } });
    await engine.waitIdle(id);

    const md = (await call("GET", `/api/meetings/${id}/export.md`)).text;
    expect(md).toContain("### Round 1 · Poll");
    expect(md).toContain("> Ship it?\n>\n> Options: Yes / No");
    expect(md).toContain("**Tally:** Yes 1");
    expect(md).toContain("| Claude Opus 5.5 | Yes | 80% | tests pass. |");
    // An answer that couldn't be read is listed as it came, not lost.
    expect(md).toContain("**GPT-6 Luna**");
    expect(md).toContain("I won't pick.");
    expect(md).not.toContain("**Claude Opus 5.5** ·");
  });

  it("records room-rule changes, and posts a wrap-up only when the chair says so", async () => {
    const { call, engine, llm } = setup();
    llm.on("claude-opus-5-5", { chunks: ["Answer."] }, { chunks: ["DECISION: B"] });
    const id = (await call("POST", "/api/meetings", { title: "Rules" })).body.id as string;
    const claude = (await call("POST", `/api/meetings/${id}/seats`, { model: "claude-opus-5-5" }))
      .body;
    await call("POST", `/api/meetings/${id}/seats`, { model: "gpt-6-luna" });

    await call("PATCH", `/api/meetings/${id}`, { answerLength: "detailed" });
    await call("PATCH", `/api/meetings/${id}`, { answerLength: "detailed" });
    const events = async () =>
      ((await call("GET", `/api/meetings/${id}`)).body as MeetingState).messages
        .filter((m) => m.authorKind === "event")
        .map((m) => m.content);
    expect(await events()).toEqual([
      "You added Claude Opus 5.5",
      "You added GPT-6 Luna",
      "You set answers to Detailed",
    ]);

    await call("POST", `/api/meetings/${id}/actions`, {
      text: "Q",
      mode: "blind",
      targets: [claude.id],
    });
    await engine.waitIdle(id);
    // No "post" field: the wrap-up is held back for the chair to review.
    await call("POST", `/api/meetings/${id}/wrap-up`, { seatId: claude.id, kind: "decision" });
    await engine.waitIdle(id);
    let state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    const decision = state.messages.find((m) => m.wrapKind === "decision")!;
    expect(decision).toMatchObject({ status: "done", hiddenFromSeats: true, visibleSeq: null });
    const listed = async () =>
      ((await call("GET", "/api/meetings")).body as MeetingSummary[]).find((m) => m.id === id);
    // A draft under review isn't "posted" in the meetings list.
    expect((await listed())?.postedWrapUp).toBeNull();

    const posted = await call("POST", `/api/meetings/${id}/messages/${decision.id}/post`);
    expect(posted.status).toBe(200);
    state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    expect(posted.body).toMatchObject({ hiddenFromSeats: false, visibleSeq: state.meeting.clock });
    expect((await events()).at(-1)).toBe("You posted Claude Opus 5.5's decision");
    expect((await listed())?.postedWrapUp).toBe("decision");
    expect((await call("POST", `/api/meetings/${id}/messages/${decision.id}/post`)).status).toBe(
      409,
    );

    await call("POST", `/api/meetings/${id}/actions`, {
      text: "Agreed?",
      mode: "blind",
      targets: "everyone",
    });
    await engine.waitIdle(id);
    const gptView = llm
      .callsFor("gpt-6-luna")
      .at(-1)!
      .messages.map((m) => m.content)
      .join("\n");
    expect(gptView).toContain("[Claude Opus 5.5, decision]: DECISION: B");
  });

  it("lets a seat have its own answer length, and records each change", async () => {
    const { call } = setup();
    const id = (await call("POST", "/api/meetings", { title: "Lengths" })).body.id as string;
    const scribe = (
      await call("POST", `/api/meetings/${id}/seats`, {
        model: "deepseek-v4-pro",
        displayName: "Scribe",
        answerLength: "detailed",
      })
    ).body as Seat;
    const plain = (await call("POST", `/api/meetings/${id}/seats`, { model: "gpt-6-luna" }))
      .body as Seat;
    expect(scribe.answerLength).toBe("detailed");
    expect(plain.answerLength).toBeNull();

    const md = (await call("GET", `/api/meetings/${id}/export.md`)).text;
    expect(md).toContain("| Scribe | `deepseek-v4-pro` | DeepSeek · prepaid | answers: Detailed |");

    await call("PATCH", `/api/meetings/${id}/seats/${plain.id}`, { answerLength: "concise" });
    await call("PATCH", `/api/meetings/${id}/seats/${plain.id}`, { answerLength: "concise" });
    const reset = await call("PATCH", `/api/meetings/${id}/seats/${scribe.id}`, {
      answerLength: null,
    });
    expect(reset.body.answerLength).toBeNull();
    expect(
      (await call("PATCH", `/api/meetings/${id}/seats/${plain.id}`, { answerLength: "long" }))
        .status,
    ).toBe(400);

    const state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    expect(state.messages.filter((m) => m.authorKind === "event").map((m) => m.content)).toEqual([
      "You added Scribe",
      "You added GPT-6 Luna",
      "You set GPT-6 Luna's answers to Concise",
      "You set Scribe's answers back to the room rule",
    ]);
  });

  it("has a web tools room rule that seats follow unless they have their own (ADR 0017)", async () => {
    const { call } = setup();
    const created = (await call("POST", "/api/meetings", { title: "Web" })).body;
    const id = created.id as string;
    expect(created.webAccess).toBe("off");
    const follows = (await call("POST", `/api/meetings/${id}/seats`, { model: "gpt-6-luna" }))
      .body as Seat;
    const own = (
      await call("POST", `/api/meetings/${id}/seats`, {
        model: "deepseek-v4-pro",
        displayName: "Checker",
        webAccess: "must",
      })
    ).body as Seat;
    expect(follows.webAccess).toBeNull();
    expect(own.webAccess).toBe("must");

    await call("PATCH", `/api/meetings/${id}`, { webAccess: "on" });
    await call("PATCH", `/api/meetings/${id}`, { webAccess: "on" });
    expect((await call("PATCH", `/api/meetings/${id}`, { webAccess: "always" })).status).toBe(400);

    const md = (await call("GET", `/api/meetings/${id}/export.md`)).text;
    // The room rule at the top; a seat that follows it has no note of its own.
    expect(md).toContain("## Room rules\n\n- Answer length: Concise\n- Web tools: Can search\n");
    expect(md).toContain("| GPT-6 Luna | `gpt-6-luna` | GPT · ChatGPT |  |");
    expect(md).toContain(
      "| Checker | `deepseek-v4-pro` | DeepSeek · prepaid | web tools: Must search first |",
    );

    await call("PATCH", `/api/meetings/${id}/seats/${follows.id}`, { webAccess: "off" });
    const reset = await call("PATCH", `/api/meetings/${id}/seats/${own.id}`, { webAccess: null });
    expect(reset.body.webAccess).toBeNull();

    const state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    expect(state.meeting.webAccess).toBe("on");
    expect(state.messages.filter((m) => m.authorKind === "event").map((m) => m.content)).toEqual([
      "You added GPT-6 Luna",
      "You added Checker",
      "You set web tools to Can search",
      "You set GPT-6 Luna's web tools to Off",
      "You set Checker's web tools back to the room rule",
    ]);
  });

  it("no longer has the chair's web search (ADR 0017)", async () => {
    const { call } = setup();
    const id = (await call("POST", "/api/meetings", { title: "No search" })).body.id as string;
    expect((await call("POST", `/api/meetings/${id}/search`, { query: "gold" })).status).toBe(404);
  });

  it("lets a seat pick a context budget, records changes, and lists the Standard size", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/models")).body.standardContextBudget).toBe(120_000);
    const id = (await call("POST", "/api/meetings", { title: "Budgets" })).body.id as string;
    const seat = (
      await call("POST", `/api/meetings/${id}/seats`, {
        model: "claude-opus-5-5",
        contextBudget: "large",
      })
    ).body as Seat;
    expect(seat.contextBudget).toBe("large");
    expect((await call("GET", `/api/meetings/${id}/export.md`)).text).toContain("context: large");

    await call("PATCH", `/api/meetings/${id}/seats/${seat.id}`, { contextBudget: "full" });
    await call("PATCH", `/api/meetings/${id}/seats/${seat.id}`, { contextBudget: null });
    // Standard and "not set" are the same budget: no event line for switching between them.
    await call("PATCH", `/api/meetings/${id}/seats/${seat.id}`, { contextBudget: "standard" });
    expect(
      (await call("PATCH", `/api/meetings/${id}/seats/${seat.id}`, { contextBudget: "huge" }))
        .status,
    ).toBe(400);
    const state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    expect(state.messages.filter((m) => m.authorKind === "event").map((m) => m.content)).toEqual([
      "You added Claude Opus 5.5",
      "You set Claude Opus 5.5's context budget to Full",
      "You set Claude Opus 5.5's context budget to Standard",
    ]);
  });

  it("sets the brief at creation and later, refuses an oversized one, and exports it", async () => {
    const { call } = setup();
    const id = (
      await call("POST", "/api/meetings", { title: "Briefed", brief: "One node, no backups." })
    ).body.id as string;
    let state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    const first = state.messages.find((m) => m.authorKind === "brief")!;
    expect(first).toMatchObject({ content: "One node, no backups.", visibleSeq: 1 });
    expect(state.meeting.clock).toBe(1);

    expect(
      (await call("PUT", `/api/meetings/${id}/brief`, { content: "One node, no backups." })).body,
    ).toMatchObject({ changed: false });
    expect(
      (await call("PUT", `/api/meetings/${id}/brief`, { content: "x".repeat(12_001) })).status,
    ).toBe(400);
    const updated = await call("PUT", `/api/meetings/${id}/brief`, { content: "Two nodes now." });
    expect(updated.body).toMatchObject({
      changed: true,
      message: { authorKind: "brief", visibleSeq: 2 },
    });

    const seat = (await call("POST", `/api/meetings/${id}/seats`, { model: "gpt-6-luna" }))
      .body as Seat;
    const reply = await call("POST", `/api/meetings/${id}/actions`, {
      text: "",
      mode: "blind",
      targets: [seat.id],
      replyTo: first.id,
    });
    expect(reply.status).toBe(400);

    const md = (await call("GET", `/api/meetings/${id}/export.md`)).text;
    expect(md).toContain("## Meeting brief\n\nTwo nodes now.");
    expect(md).toContain("_You set the meeting brief:_\n\n> One node, no backups.");
    expect(md).toContain("_You updated the meeting brief:_\n\n> Two nodes now.");
    state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    expect(state.meeting.clock).toBe(2);
  });

  const PNG_1X1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const dotPng = { kind: "image", name: "dot.png", mime: "image/png", data: PNG_1X1 };

  it("takes images and text files on a message, serves them, and shows them to the seats", async () => {
    const { call, engine, llm } = setup();
    const id = (await call("POST", "/api/meetings", { title: "Files" })).body.id as string;
    await call("POST", `/api/meetings/${id}/seats`, { model: "claude-opus-5-5" });
    const sent = await call("POST", `/api/meetings/${id}/actions`, {
      text: "Look",
      mode: "blind",
      targets: "everyone",
      attachments: [
        dotPng,
        { kind: "text", name: "notes.md", text: "# Notes\nCache at the edge." },
      ],
    });
    expect(sent.status).toBe(202);
    await engine.waitIdle(id);

    const state = (await call("GET", `/api/meetings/${id}`)).body as MeetingState;
    const files = state.messages.find((m) => m.authorKind === "chair")!.attachments;
    expect(files.map((f) => [f.kind, f.name, f.mime, f.width, f.textChars])).toEqual([
      ["image", "dot.png", "image/png", 1, null],
      ["text", "notes.md", "text/plain", null, 26],
    ]);

    const img = await setup().app.request(`/api/meetings/${id}/attachments/${files[0]!.id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await img.arrayBuffer()).equals(Buffer.from(PNG_1X1, "base64"))).toBe(true);
    const txt = await call("GET", `/api/meetings/${id}/attachments/${files[1]!.id}`);
    expect(txt.text).toBe("# Notes\nCache at the edge.");

    const seen = JSON.stringify(llm.callsFor("claude-opus-5-5")[0]!.messages);
    expect(seen).toContain("data:image/png;base64,");
    expect(seen).toContain('<file name=\\"notes.md\\">');

    const md = (await call("GET", `/api/meetings/${id}/export.md`)).text;
    expect(md).toContain("- Image: dot.png (1×1)");
    expect(md).toContain(
      "- File: notes.md (26 characters)\n\n```text\n# Notes\nCache at the edge.\n```",
    );
  });

  it("refuses files it can't take", async () => {
    const { call } = setup();
    const id = (await call("POST", "/api/meetings", { title: "Bad files" })).body.id as string;
    await call("POST", `/api/meetings/${id}/seats`, { model: "claude-opus-5-5" });
    const send = (attachments: unknown[]) =>
      call("POST", `/api/meetings/${id}/actions`, {
        text: "Q",
        mode: "blind",
        targets: "everyone",
        attachments,
      });
    const svg = await send([
      { kind: "image", name: "x.svg", mime: "image/svg+xml", data: "PHN2Zy8+" },
    ]);
    expect(svg.status).toBe(400);
    const fake = await send([{ ...dotPng, data: Buffer.from("not an image").toString("base64") }]);
    expect(fake.status).toBe(400);
    expect(fake.body.error).toBe("dot.png isn't a readable image.");
    expect((await send(Array.from({ length: 9 }, () => dotPng))).status).toBe(400);
    expect((await send([{ kind: "text", name: "a.bin", text: "a\u0000b" }])).body.error).toBe(
      "a.bin isn't a text file.",
    );
  });

  it("takes the brief's files at creation, as one version, and leaves no meeting when it refuses them", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/meetings", {
      title: "Briefed with files",
      brief: "Drive inventory and growth chart attached.",
      briefAttachments: [
        dotPng,
        { kind: "text", name: "nas-inventory.csv", text: "bay,model\n1,WD80EFZZ" },
      ],
    });
    expect(created.status).toBe(201);
    const state = (await call("GET", `/api/meetings/${created.body.id}`)).body as MeetingState;
    const briefs = state.messages.filter((m) => m.authorKind === "brief");
    // One version with its files, not "set" and then "updated (2 files)".
    expect(briefs).toHaveLength(1);
    expect(briefs[0]?.attachments.map((f) => f.name)).toEqual(["dot.png", "nas-inventory.csv"]);

    // A file-only brief works too.
    const filesOnly = await call("POST", "/api/meetings", {
      title: "Chart only",
      briefAttachments: [dotPng],
    });
    expect(filesOnly.status).toBe(201);

    const before = ((await call("GET", "/api/meetings")).body as MeetingSummary[]).length;
    const tooMany = await call("POST", "/api/meetings", {
      title: "Too many images",
      briefAttachments: Array.from({ length: 5 }, (_, i) => ({ ...dotPng, name: `dot${i}.png` })),
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatch(/images/);
    expect((await call("GET", "/api/meetings")).body).toHaveLength(before);
  });

  it("keeps the brief's files across edits, puts them in every view, and caps them", async () => {
    const { call, engine, llm } = setup();
    const id = (await call("POST", "/api/meetings", { title: "Brief files" })).body.id as string;
    await call("POST", `/api/meetings/${id}/seats`, { model: "gpt-6-luna" });
    const first = await call("PUT", `/api/meetings/${id}/brief`, {
      content: "Facts",
      attachments: [dotPng, { kind: "text", name: "spec.txt", text: "Spec v1" }],
    });
    expect(first.body.message.attachments).toHaveLength(2);
    // A text-only edit keeps the files, copied onto the new version.
    const second = await call("PUT", `/api/meetings/${id}/brief`, { content: "Facts v2" });
    expect(second.body.message.attachments.map((f: { name: string }) => f.name)).toEqual([
      "dot.png",
      "spec.txt",
    ]);
    expect(second.body.message.attachments[0].id).not.toBe(first.body.message.attachments[0].id);

    await call("POST", `/api/meetings/${id}/actions`, {
      text: "Q",
      mode: "blind",
      targets: "everyone",
    });
    await engine.waitIdle(id);
    const turn = llm.callsFor("gpt-6-luna")[0]!;
    expect(turn.messages[0]?.content).toContain(
      'Facts v2\n\n<file name="spec.txt">\nSpec v1\n</file>',
    );
    expect(JSON.stringify(turn.messages[1]?.content)).toContain(
      "(The image above is from the meeting brief: dot.png.)",
    );

    const removed = await call("PUT", `/api/meetings/${id}/brief`, {
      content: "Facts v2",
      keepAttachmentIds: [],
    });
    expect(removed.body).toMatchObject({ changed: true, message: { attachments: [] } });
    const tooMany = await call("PUT", `/api/meetings/${id}/brief`, {
      content: "Facts v2",
      attachments: Array.from({ length: 5 }, () => dotPng),
    });
    expect(tooMany.status).toBe(400);
  });

  it("deletes a meeting", async () => {
    const { call } = setup();
    const id = (await call("POST", "/api/meetings", { title: "T" })).body.id as string;
    expect((await call("DELETE", `/api/meetings/${id}`)).status).toBe(204);
    expect((await call("GET", `/api/meetings/${id}`)).status).toBe(404);
  });
});
