import type { MeetingState, Message } from "@homestorm/shared";
import { describe, expect, it } from "vitest";
import {
  allowanceLine,
  compactNumber,
  compareModels,
  dayGroup,
  initials,
  meetingTotals,
  plainText,
  seatStatus,
  sentToLine,
} from "./format";
import { applyEvent, emptyLive, type LiveState } from "./meeting-state";
import { percentLabel, seatContext } from "./seat-context";

const msg = (extra: Partial<Message>): Message => ({
  id: "m1",
  meetingId: "x",
  seq: 1,
  authorKind: "seat",
  seatId: "s1",
  roundId: "r1",
  replyToId: null,
  content: "",
  status: "streaming",
  error: null,
  sendMode: null,
  targetSeatIds: null,
  wrapKind: null,
  hiddenFromSeats: false,
  visibleSeq: null,
  cutoffSeq: 1,
  model: "claude-opus-5-5",
  ownedBy: "anthropic",
  reasoningEffort: "low",
  usage: null,
  costUsd: null,
  llmgwReqId: null,
  requestId: null,
  trimmedCount: 0,
  viewTokens: null,
  attachments: [],
  stoppedEarly: false,
  createdAt: "2026-11-02T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  ...extra,
});

const state = (messages: Message[]): MeetingState => ({
  meeting: {
    id: "x",
    title: "T",
    answerLength: "concise",
    clock: 0,
    createdAt: "",
    updatedAt: "",
  },
  seats: [
    {
      id: "s1",
      meetingId: "x",
      model: "claude-opus-5-5",
      ownedBy: "anthropic",
      displayName: "Claude Opus 5.5",
      persona: null,
      position: 0,
      muted: false,
      reasoningEffort: "low",
      answerLength: null,
      contextBudget: null,
      removedAt: null,
      createdAt: "",
    },
  ],
  rounds: [],
  messages,
});

const live = (messages: Message[]): LiveState => ({ state: state(messages), thinking: {} });
const text = (l: LiveState) => l.state?.messages[0]?.content;

describe("applyEvent", () => {
  it("replaces everything on a snapshot", () => {
    const r = applyEvent(emptyLive, { type: "snapshot", state: state([msg({ content: "hi" })]) });
    expect(text(r.live)).toBe("hi");
  });

  it("appends a delta at the right offset", () => {
    const r = applyEvent(live([msg({ content: "Hel" })]), {
      type: "delta",
      messageId: "m1",
      offset: 3,
      text: "lo",
    });
    expect(text(r.live)).toBe("Hello");
    expect(r.gap).toBe(false);
  });

  it("ignores a chunk it already has", () => {
    const r = applyEvent(live([msg({ content: "Hello" })]), {
      type: "delta",
      messageId: "m1",
      offset: 0,
      text: "Hel",
    });
    expect(text(r.live)).toBe("Hello");
    expect(r.gap).toBe(false);
  });

  it("reports a gap when a chunk is beyond what it has", () => {
    const r = applyEvent(live([msg({ content: "He" })]), {
      type: "delta",
      messageId: "m1",
      offset: 5,
      text: "x",
    });
    expect(text(r.live)).toBe("He");
    expect(r.gap).toBe(true);
  });

  it("doesn't let a stale 'started streaming' event wipe streamed text", () => {
    const r = applyEvent(live([msg({ content: "Hello" })]), {
      type: "message",
      message: msg({ content: "" }),
    });
    expect(text(r.live)).toBe("Hello");
  });

  it("takes the final message as saved", () => {
    const r = applyEvent(live([msg({ content: "[Claude]: Hello" })]), {
      type: "message",
      message: msg({ content: "Hello", status: "done" }),
    });
    expect(text(r.live)).toBe("Hello");
  });

  it("keeps messages in creation order", () => {
    const r = applyEvent(live([msg({ id: "a", seq: 2 })]), {
      type: "message",
      message: msg({ id: "b", seq: 1 }),
    });
    expect(r.live.state?.messages.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("format", () => {
  const now = new Date("2026-11-02T12:00:00Z");

  it("writes allowance as the mockup does", () => {
    expect(
      allowanceLine(
        {
          status: "ok",
          available: {
            kind: "percent",
            percentLeft: 32,
            resetsAt: "2026-11-06T10:00:00Z",
            binding: "weekly · all models",
          },
        },
        now,
      ),
    ).toEqual({ text: "32% left this week · resets Nov 6", percent: 32, tone: "ok" });
    expect(
      allowanceLine(
        {
          status: "ok",
          available: {
            kind: "percent",
            percentLeft: 99,
            resetsAt: "2026-12-02T15:55:29Z",
            binding: "monthly · all models",
          },
        },
        now,
      ).text,
    ).toBe("99% left this month · resets Dec 2");
    expect(
      allowanceLine({ status: "ok", available: { kind: "balance", amount: 4.5, currency: "USD" } })
        .text,
    ).toBe("$4.50 left");
    expect(
      allowanceLine({ status: "unavailable", available: { kind: "unavailable", reason: "x" } })
        .text,
    ).toBe("Not on your plan");
    expect(allowanceLine(null).text).toBe("Allowance unknown");
    expect(
      allowanceLine({
        status: "warning",
        available: { kind: "percent", percentLeft: 8, resetsAt: null, binding: "weekly" },
      }).tone,
    ).toBe("warn");
  });

  it("names seat states in words", () => {
    const s = state([msg({ status: "streaming" })]);
    const seat = s.seats[0]!;
    expect(seatStatus(seat, s, null)).toBe("Answering");
    expect(seatStatus(seat, state([msg({ status: "queued" })]), null)).toBe("Next");
    expect(
      seatStatus(
        seat,
        state([msg({ status: "error", error: { code: "rate_limited", message: "x" } })]),
        null,
      ),
    ).toBe("Rate limited");
    expect(
      seatStatus(seat, state([]), { status: "exhausted", available: { kind: "unknown" } }),
    ).toBe("Out of allowance");
    expect(seatStatus({ ...seat, muted: true }, state([msg({ status: "done" })]), null)).toBe(
      "Muted",
    );
    expect(seatStatus(seat, state([msg({ status: "done" })]), null)).toBe("Idle");
  });

  it("totals tokens and DeepSeek spend", () => {
    const t = meetingTotals([
      msg({ usage: { promptTokens: 1, completionTokens: 1, totalTokens: 1000, estimated: true } }),
      msg({
        ownedBy: "deepseek",
        costUsd: 0.002,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 500, estimated: false },
      }),
    ]);
    expect(t).toEqual({ tokens: 1500, estimated: true, deepseekUsd: 0.002 });
    expect(meetingTotals([msg({})]).deepseekUsd).toBeNull();
  });

  it("says where a chair message went", () => {
    const name = (id: string) => ({ a: "Claude Opus 5.5", b: "GPT-6 Luna" })[id] ?? "?";
    expect(sentToLine(msg({ authorKind: "chair", sendMode: "blind" }), name)).toBe(
      "Sent to everyone · blind",
    );
    expect(sentToLine(msg({ authorKind: "chair", sendMode: "none" }), name)).toBe(
      "Comment · no reply",
    );
    expect(
      sentToLine(msg({ authorKind: "chair", sendMode: "seats", targetSeatIds: ["a", "b"] }), name),
    ).toBe("Asked Claude Opus 5.5 and GPT-6 Luna");
    expect(
      sentToLine(
        msg({ authorKind: "chair", sendMode: "seats", targetSeatIds: ["b"] }),
        name,
        "Claude Opus 5.5",
      ),
    ).toBe("Asked GPT-6 Luna to respond to Claude Opus 5.5");
  });

  it("formats small things", () => {
    expect(compactNumber(999)).toBe("999");
    expect(compactNumber(1234)).toBe("1.2k");
    expect(compactNumber(45_600)).toBe("46k");
    expect(initials("Claude Opus 5.5")).toBe("CO");
    expect(initials("GPT-6 Luna")).toBe("GL");
    expect(initials("DeepSeek V4 Pro")).toBe("DV");
    expect(dayGroup("2026-11-02T08:00:00", new Date("2026-11-02T20:00:00"))).toBe("Today");
    expect(dayGroup("2026-11-01T08:00:00", new Date("2026-11-02T20:00:00"))).toBe("Yesterday");
    expect(dayGroup("2026-10-20T08:00:00", new Date("2026-11-02T20:00:00"))).toBe("Older");
  });

  it("quotes Markdown as plain text", () => {
    expect(plainText("Default to **blind rounds**. See `x` and [docs](http://a).")).toBe(
      "Default to blind rounds. See x and docs.",
    );
    expect(plainText("## Minutes\n- one\n- _two_")).toBe("Minutes one two");
  });

  it("sorts models strongest family first, newest first", () => {
    const ids = [
      "claude-sonnet-4-5",
      "claude-haiku-5-5",
      "claude-opus-4-8",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-fable-5-1",
    ];
    expect([...ids].sort(compareModels)).toEqual([
      "claude-fable-5-1",
      "claude-opus-5-5",
      "claude-opus-4-8",
      "claude-sonnet-5-5",
      "claude-sonnet-4-5",
      "claude-haiku-5-5",
    ]);
    expect(["gpt-5.6-luna", "gpt-6-luna", "gpt-6.1-sol"].sort(compareModels)).toEqual([
      "gpt-6.1-sol",
      "gpt-6-luna",
      "gpt-5.6-luna",
    ]);
  });
});

describe("seatContext", () => {
  const models = new Map([
    [
      "claude-opus-5-5",
      {
        id: "claude-opus-5-5",
        ownedBy: "anthropic" as const,
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        input: ["text", "image"] as ("text" | "image")[],
        available: true,
        statusDetail: null,
      },
    ],
  ]);
  const turn = (viewTokens: number, trimmedCount = 0) =>
    msg({ seatId: "s1", authorKind: "seat", viewTokens, trimmedCount });

  it("measures the last view against the seat's budget, amber from 80%, then trimming", () => {
    const seat = state([]).seats[0]!;
    expect(seatContext(seat, state([]), models, 120_000)).toMatchObject({
      budget: 120_000,
      last: null,
      tone: "ok",
    });
    expect(seatContext(seat, state([turn(60_000)]), models, 120_000)).toMatchObject({
      percent: 50,
      window: 1_000_000,
      tone: "ok",
    });
    expect(percentLabel(50)).toBe("50%");
    expect(percentLabel(0.4)).toBe("<1%");
    expect(seatContext(seat, state([turn(100_000)]), models, 120_000).tone).toBe("warn");
    expect(seatContext(seat, state([turn(100_000, 3)]), models, 120_000).tone).toBe("trimming");
    const small = { ...seat, contextBudget: "small" as const };
    expect(seatContext(small, state([turn(27_000)]), models, 120_000)).toMatchObject({
      budget: 32_000,
      tone: "warn",
    });
    // llmgw's count is shown when it gave one; the tone still follows the estimate.
    const counted = msg({
      seatId: "s1",
      authorKind: "seat",
      viewTokens: 100_000,
      usage: { promptTokens: 73_000, completionTokens: 10, totalTokens: 73_010, estimated: false },
    });
    expect(seatContext(seat, state([counted]), models, 120_000)).toMatchObject({
      real: 73_000,
      last: 100_000,
      tone: "warn",
    });
  });
});
