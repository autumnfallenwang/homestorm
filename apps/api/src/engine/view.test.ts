import type { Message, Seat } from "@homestorm/shared";
import { describe, expect, it } from "vitest";
import { MEETING_STARTED, REPLY_EXCERPT_CHARS, renderFloorNote, renderIntro } from "./prompts.js";
import { buildView, stripSpeakerTag, type ViewInput, visibleMessages } from "./view.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const MEETING_ID = "00000000-0000-4000-8000-000000000000";

function seat(
  id: string,
  displayName: string,
  model: string,
  position: number,
  extra: Partial<Seat> = {},
): Seat {
  return {
    id,
    meetingId: MEETING_ID,
    model,
    ownedBy: model.startsWith("gpt")
      ? "openai-codex"
      : model.startsWith("deepseek")
        ? "deepseek"
        : "anthropic",
    displayName,
    persona: null,
    position,
    muted: false,
    reasoningEffort: "low",
    removedAt: null,
    createdAt: "2026-11-02T00:00:00.000Z",
    ...extra,
  };
}

const claude = seat("c", "Claude Opus 5.5", "claude-opus-5-5", 0);
const gpt = seat("g", "GPT-6 Luna", "gpt-6-luna", 1);
const ds = seat("d", "DeepSeek V4 Pro", "deepseek-v4-pro", 2);
const seats = [claude, gpt, ds];

let seq = 0;
function msg(extra: Partial<Message> & Pick<Message, "authorKind">): Message {
  seq++;
  return {
    id: `m${seq}`,
    meetingId: MEETING_ID,
    seq,
    seatId: null,
    roundId: null,
    replyToId: null,
    content: "",
    status: "done",
    error: null,
    sendMode: null,
    targetSeatIds: null,
    wrapKind: null,
    hiddenFromSeats: false,
    visibleSeq: seq,
    cutoffSeq: null,
    model: null,
    ownedBy: null,
    reasoningEffort: null,
    usage: null,
    costUsd: null,
    llmgwReqId: null,
    requestId: null,
    trimmedCount: 0,
    stoppedEarly: false,
    createdAt: "2026-11-02T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    ...extra,
  };
}
const chair = (content: string, extra: Partial<Message> = {}) =>
  msg({ authorKind: "chair", content, sendMode: "blind", ...extra });
const said = (s: Seat, content: string, extra: Partial<Message> = {}) =>
  msg({ authorKind: "seat", seatId: s.id, content, ...extra });

function view(messages: Message[], speaker: Seat, overrides: Partial<ViewInput> = {}) {
  return buildView({
    meeting: { title: "Caching", answerLength: "concise" },
    seats,
    messages,
    seat: speaker,
    cutoffSeq: Math.max(0, ...messages.map((m) => m.visibleSeq ?? 0)),
    floor: { kind: "blind", count: 3 },
    budget: 120_000,
    ...overrides,
  });
}

// ── Role mapping, tags, merging ─────────────────────────────────────────────

describe("buildView: roles and tags", () => {
  it("keeps the seat's own messages as assistant and tags everyone else as user", () => {
    seq = 0;
    const transcript = [
      chair("Should we cache at the edge or in the API?"),
      said(claude, "At the edge."),
      said(gpt, "In the API."),
      said(ds, "Both."),
      chair("Claude, respond to GPT's point.", { sendMode: "seats", targetSeatIds: ["c"] }),
    ];
    const v = view(transcript, claude, { floor: { kind: "direct" } });

    expect(v.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(v.messages[1]?.content).toBe("[Chair]: Should we cache at the edge or in the API?");
    expect(v.messages[2]?.content).toBe("At the edge.");
    // GPT, DeepSeek and the chair's follow-up are merged into one user turn, floor note last.
    expect(v.messages[3]?.content).toBe(
      [
        "[GPT-6 Luna]: In the API.",
        "[DeepSeek V4 Pro]: Both.",
        "[Chair → you]: Claude, respond to GPT's point.",
        "[Floor] The Chair asks you to speak now.",
      ].join("\n\n"),
    );
  });

  it("names the targets of a chair message to the other seats", () => {
    seq = 0;
    const transcript = [
      chair("GPT, what do you think?", { sendMode: "seats", targetSeatIds: ["g"] }),
    ];
    const v = view(transcript, claude);
    expect(v.messages[1]?.content).toMatch(/^\[Chair → GPT-6 Luna\]: GPT, what do you think\?/);
  });

  it("tags replies with who they reply to", () => {
    seq = 0;
    const q = chair("Edge or API?");
    const a = said(claude, "Edge.");
    const r = said(gpt, "Claude ignores invalidation.", { replyToId: a.id });
    const v = view([q, a, r], ds);
    expect(v.messages[1]?.content).toContain(
      "[GPT-6 Luna, replying to Claude Opus 5.5]: Claude ignores invalidation.",
    );
    // The seat being replied to sees "you".
    const vc = view([q, a, r], claude);
    expect(vc.messages[3]?.content).toContain("[GPT-6 Luna, replying to you]:");
  });

  it("labels posted minutes", () => {
    seq = 0;
    const v = view([chair("Q"), said(claude, "## Minutes", { wrapKind: "minutes" })], gpt);
    expect(v.messages[1]?.content).toContain("[Claude Opus 5.5, meeting minutes]: ## Minutes");
  });

  it("keeps a removed seat's name on its old messages but drops it from the roster", () => {
    seq = 0;
    const gone = { ...ds, removedAt: "2026-11-02T01:00:00.000Z" };
    const v = buildView({
      meeting: { title: "Caching", answerLength: "concise" },
      seats: [claude, gpt, gone],
      messages: [chair("Q"), said(gone, "Both.")],
      seat: claude,
      cutoffSeq: 2,
      floor: { kind: "direct" },
      budget: 120_000,
    });
    expect(v.messages[1]?.content).toContain("[DeepSeek V4 Pro]: Both.");
    expect(v.messages[0]?.content).not.toContain("DeepSeek V4 Pro (deepseek-v4-pro)");
  });

  it("starts with a user turn even when a seat spoke first", () => {
    seq = 0;
    const v = view([said(claude, "Opening thoughts.")], claude, { floor: { kind: "direct" } });
    expect(v.messages[1]).toEqual({ role: "user", content: MEETING_STARTED });
    expect(v.messages[2]).toEqual({ role: "assistant", content: "Opening thoughts." });
    expect(v.messages[3]?.role).toBe("user");
  });

  it("puts the floor note in its own user turn after the seat's own last message", () => {
    seq = 0;
    const v = view([chair("Q"), said(claude, "A.")], claude, { floor: { kind: "direct" } });
    expect(v.messages.at(-1)).toEqual({
      role: "user",
      content: "[Floor] The Chair asks you to speak now.",
    });
    expect(v.messages.at(-2)?.role).toBe("assistant");
  });

  it("merges two of the seat's own answers in a row", () => {
    seq = 0;
    const v = view([chair("Q"), said(claude, "A1."), said(claude, "A2.")], claude, {
      floor: { kind: "direct" },
    });
    expect(v.messages[2]).toEqual({ role: "assistant", content: "A1.\n\nA2." });
  });
});

// ── Visibility (ADR 0005) ───────────────────────────────────────────────────

describe("buildView: visibility", () => {
  it("blind round: a seat doesn't see answers that finished after its turn started", () => {
    seq = 0;
    const q = chair("Edge or API?"); // visible at 1; all seats start with cutoff 1
    const a = said(claude, "Edge.", { visibleSeq: 2 });
    const v = view([q, a], gpt, { cutoffSeq: 1 });
    expect(v.messages).toHaveLength(2);
    expect(v.messages[1]?.content).not.toContain("Edge.");
  });

  it("in turn: the 2nd seat sees the 1st seat's answer", () => {
    seq = 0;
    const q = chair("Edge or API?", { sendMode: "in_turn" });
    const a = said(claude, "Edge.");
    const v = view([q, a], gpt, { cutoffSeq: 2, floor: { kind: "in_turn", index: 2, count: 2 } });
    expect(v.messages[1]?.content).toContain("[Claude Opus 5.5]: Edge.");
    expect(v.messages[1]?.content).toContain("You answer 2nd of 2, in turn.");
  });

  it("leaves out comments, unfinished answers, failures and unposted minutes", () => {
    seq = 0;
    const transcript = [
      chair("Q"),
      msg({ authorKind: "event", content: "You muted DeepSeek V4 Pro for rounds" }),
      said(claude, "partial", { status: "streaming", visibleSeq: null }),
      said(claude, "stopped partial", { status: "stopped", visibleSeq: null }),
      said(ds, "", { status: "error", visibleSeq: null }),
      said(ds, "queued", { status: "queued", visibleSeq: null }),
      said(claude, "secret minutes", { wrapKind: "minutes", hiddenFromSeats: true }),
      chair("", { sendMode: "seats", targetSeatIds: ["g"], replyToId: "m1" }),
    ];
    const v = view(transcript, gpt);
    const text = v.messages.map((m) => m.content).join("\n");
    expect(text).toContain("[Chair]: Q");
    for (const hidden of ["muted", "partial", "queued", "secret minutes", "[Chair, replying"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("orders by when messages entered the record, so later views only add at the end", () => {
    seq = 0;
    const q = chair("Q"); // 1
    // Blind round: Claude was created first but finished last.
    const a = said(claude, "Claude's slow answer.", { visibleSeq: 3 });
    const b = said(gpt, "GPT's quick answer.", { visibleSeq: 2 });
    const all = [q, a, b];
    expect(visibleMessages(all, 3).map((m) => m.id)).toEqual([q.id, b.id, a.id]);

    // DeepSeek's view after GPT finished, then after Claude finished: the first is a prefix of the second.
    const early = view(all, ds, { cutoffSeq: 2, floor: { kind: "direct" } });
    const late = view(all, ds, { cutoffSeq: 3, floor: { kind: "direct" } });
    const floor = "\n\n[Floor] The Chair asks you to speak now.";
    const earlyBody = early.messages
      .map((m) => m.content)
      .join("\n\n")
      .replace(floor, "");
    const lateBody = late.messages.map((m) => m.content).join("\n\n");
    expect(lateBody.startsWith(earlyBody)).toBe(true);
  });
});

// ── Long meetings (ADR 0012) ────────────────────────────────────────────────

describe("buildView: trimming", () => {
  it("keeps the intro, the first chair message and the newest messages", () => {
    seq = 0;
    const filler = "x".repeat(3_000); // ~1,000 budget tokens each
    const transcript = [
      chair("The original question"),
      ...Array.from({ length: 10 }, (_, i) => said(i % 2 ? gpt : ds, `${i} ${filler}`)),
      chair("The latest question"),
    ];
    const v = view(transcript, claude, { budget: 4_500, floor: { kind: "direct" } });
    const text = v.messages.map((m) => m.content).join("\n");

    expect(v.trimmedCount).toBeGreaterThan(0);
    expect(text).toContain("[Chair]: The original question");
    expect(text).toContain("[Chair]: The latest question");
    expect(text).toContain(`(${v.trimmedCount} older messages trimmed to fit the context window.)`);
    expect(text).not.toContain("0 xxx");
    expect(v.messages[0]?.role).toBe("system");
  });

  it("trims nothing when the meeting fits", () => {
    seq = 0;
    const v = view([chair("Q"), said(gpt, "A")], claude);
    expect(v.trimmedCount).toBe(0);
    expect(v.messages.map((m) => m.content).join("\n")).not.toContain("trimmed");
  });
});

// ── Templates (ADR 0013) ────────────────────────────────────────────────────

describe("renderIntro", () => {
  const intro = renderIntro({
    meetingTitle: "Caching",
    self: {
      displayName: "Claude Opus 5.5",
      model: "claude-opus-5-5",
      persona: "Play the skeptic.",
    },
    roster: [
      { displayName: "Claude Opus 5.5", model: "claude-opus-5-5" },
      { displayName: "GPT-6 Luna", model: "gpt-6-luna" },
    ],
    answerLength: "concise",
  });

  it("says who the seat is and lists the roster", () => {
    expect(intro).toMatch(/^You are Claude Opus 5\.5 \(claude-opus-5-5\)/);
    expect(intro).toContain("- Chair: the human who runs the meeting");
    expect(intro).toContain("- Claude Opus 5.5 (claude-opus-5-5) (you)");
    expect(intro).toContain("- GPT-6 Luna (gpt-6-luna)");
    expect(intro).toContain("Meeting: Caching");
  });

  it("carries the etiquette rules", () => {
    expect(intro).toContain("Disagree when you have a reason, including with the Chair.");
    expect(intro).toContain('Don\'t start your reply with your name or a "[Name]:" tag.');
    expect(intro).toContain('("I agree with GPT-6 Luna")');
    expect(intro).toContain("Keep answers concise");
  });

  it("appends the persona last", () => {
    expect(intro.endsWith("Your role in this meeting:\nPlay the skeptic.")).toBe(true);
  });
});

describe("renderFloorNote", () => {
  it("covers each way of being called", () => {
    expect(renderFloorNote({ kind: "direct" })).toBe("[Floor] The Chair asks you to speak now.");
    expect(renderFloorNote({ kind: "blind", count: 3 })).toContain(
      "All 3 participants answer this independently",
    );
    expect(renderFloorNote({ kind: "in_turn", index: 1, count: 3 })).toContain(
      "You answer 1st of 3, in turn. The others will see your answer",
    );
    expect(renderFloorNote({ kind: "in_turn", index: 3, count: 3 })).toContain(
      "Consider the answers above",
    );
    expect(renderFloorNote({ kind: "wrap_up", wrapKind: "minutes" })).toContain(
      "Write the meeting minutes",
    );
    expect(renderFloorNote({ kind: "wrap_up", wrapKind: "decision" })).toContain(
      "Write the decision",
    );
    expect(renderFloorNote({ kind: "wrap_up", wrapKind: "open_questions" })).toContain(
      "List the open questions",
    );
  });

  it("quotes the message being replied to, cut at 300 characters", () => {
    const long = "word ".repeat(200);
    const note = renderFloorNote({
      kind: "direct",
      replyTo: { author: "GPT-6 Luna", content: long },
    });
    expect(note).toMatch(
      /^\[Floor\] The Chair asks you to respond to GPT-6 Luna's message: "word word/,
    );
    expect(note).toContain('…"');
    const quoted = note.slice(note.indexOf('"') + 1, note.lastIndexOf('"'));
    expect(quoted.length).toBe(REPLY_EXCERPT_CHARS + 1);
    expect(note).not.toContain("speak now");
  });

  it("combines a reply with a round", () => {
    const note = renderFloorNote({
      kind: "in_turn",
      index: 2,
      count: 2,
      replyTo: { author: "Chair", content: "x" },
    });
    expect(note).toContain("respond to Chair's message");
    expect(note).toContain("You answer 2nd of 2");
  });
});

describe("stripSpeakerTag", () => {
  it("removes a leading tag only", () => {
    expect(stripSpeakerTag("[Claude Opus 5.5]: At the edge.")).toBe("At the edge.");
    expect(stripSpeakerTag("  [GPT-6 Luna]:\tYes")).toBe("Yes");
    expect(stripSpeakerTag("At the edge. [Claude]: no")).toBe("At the edge. [Claude]: no");
    expect(stripSpeakerTag("[link](http://x) text")).toBe("[link](http://x) text");
  });
});
