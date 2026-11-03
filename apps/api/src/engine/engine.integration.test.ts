// The meeting engine against Postgres, with a scripted llmgw. Covers the ruleset (ADR 0005), the control layer
// (ADR 0006) and the server-run rounds (ADR 0010).
import type { Meeting, MeetingEvent, Seat } from "@homestorm/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../db/index.js";
import { createStore } from "../services/store.js";
import { hasTestDb, truncateAll } from "../test/db.js";
import { FakeLlm, LlmError } from "../test/fake-llm.js";
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
}

async function world(): Promise<World> {
  const llm = new FakeLlm();
  const hub = new EventHub();
  const engine = new Engine({ store, llm, hub, viewTokenBudget: 120_000, flushIntervalMs: 0 });
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
  return { engine, llm, hub, meeting, claude, gpt, ds, events };
}

const userText = (turn: { messages: { role: string; content: string }[] }) =>
  turn.messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
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

  it("a seat out of allowance can't take the floor, and llmgw isn't called", async () => {
    const w = await world();
    w.llm.limitsByModel.set("deepseek-v4-pro", {
      status: "exhausted",
      available: { kind: "balance", amount: 0, currency: "USD" },
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
    expect(w.llm.callsFor("deepseek-v4-pro")).toHaveLength(0);
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
});
