import { describe, expect, it } from "vitest";
import {
  matchOption,
  PollInput,
  parsePollAnswer,
  pollPrompt,
  pollShift,
  pollTally,
  samePoll,
} from "./poll.js";

const OPTIONS = ["4 × 16 TB", "2 × 24 TB", "Neither"];

describe("parsePollAnswer", () => {
  it("reads the one-line format", () => {
    expect(
      parsePollAnswer(
        "Choice: 4 × 16 TB · Confidence: 70% · Why: fixes the space; check serials first.",
        OPTIONS,
      ),
    ).toEqual({
      choice: "4 × 16 TB",
      option: 0,
      confidence: 70,
      why: "fixes the space; check serials first.",
    });
  });

  it("copes with bold, other separators, and parts on their own lines", () => {
    expect(
      parsePollAnswer("**Choice:** Neither | **Confidence:** 80 | **Why:** red flag", OPTIONS),
    ).toMatchObject({ option: 2, confidence: 80, why: "red flag" });
    expect(
      parsePollAnswer("Choice: neither.\nConfidence: 65 %\nWhy: the quote is too cheap", OPTIONS),
    ).toMatchObject({ option: 2, confidence: 65, why: "the quote is too cheap" });
  });

  it("keeps a choice that matches no option, and a missing confidence", () => {
    expect(parsePollAnswer("Choice: wait until January · Why: prices", OPTIONS)).toEqual({
      choice: "wait until January",
      option: null,
      confidence: null,
      why: "prices",
    });
  });

  it("gives null when there's no choice at all", () => {
    expect(parsePollAnswer("I'd rather not pick one.", OPTIONS)).toBeNull();
  });

  it("caps confidence at 100", () => {
    expect(parsePollAnswer("Choice: Neither · Confidence: 150%", OPTIONS)?.confidence).toBe(100);
  });
});

describe("matchOption", () => {
  it("ignores case and punctuation, and takes a choice that starts with an option", () => {
    expect(matchOption("2x24 tb", ["2x24 TB"])).toBe(0);
    expect(matchOption("Neither, for now", OPTIONS)).toBe(2);
    expect(matchOption("Something else", OPTIONS)).toBeNull();
    expect(matchOption("anything", [])).toBeNull();
  });
});

describe("pollTally", () => {
  it("counts each option in order, and the rest as Other", () => {
    const a = (option: number | null) => ({ choice: "x", option, confidence: 50, why: "" });
    expect(pollTally([a(0), a(0), a(2), a(null), null], OPTIONS)).toEqual([
      { label: "4 × 16 TB", count: 2 },
      { label: "2 × 24 TB", count: 0 },
      { label: "Neither", count: 1 },
      { label: "Other", count: 1 },
    ]);
  });
});

describe("pollShift", () => {
  const a = (option: number, confidence: number | null, choice = "x") => ({
    choice,
    option,
    confidence,
    why: "",
  });
  it("says what changed since the same poll last time", () => {
    expect(pollShift(a(0, 80), a(0, 55))).toBe("+25 pts");
    expect(pollShift(a(0, 50), a(0, 70))).toBe("-20 pts");
    expect(pollShift(a(0, 60), a(0, 60))).toBe("no change");
    expect(pollShift(a(1, 60), a(2, 60, "Neither"))).toBe("was Neither");
    expect(pollShift(a(0, 60), null)).toBeNull();
  });
});

describe("PollInput and the prompt", () => {
  it("takes a question with up to 6 different options, or none", () => {
    expect(PollInput.parse({ question: " Which? " })).toEqual({ question: "Which?", options: [] });
    expect(PollInput.safeParse({ question: "Q", options: ["A", "a"] }).success).toBe(false);
    expect(
      PollInput.safeParse({
        question: "Q",
        options: Array(7)
          .fill(0)
          .map((_, i) => `${i}`),
      }).success,
    ).toBe(false);
    expect(PollInput.safeParse({ question: "  " }).success).toBe(false);
  });

  it("writes the options into the chair's message, and knows the same poll again", () => {
    expect(pollPrompt({ question: "Which drives?", options: ["A", "B"] })).toBe(
      "Which drives?\n\nOptions: A / B",
    );
    expect(pollPrompt({ question: "Which drives?", options: [] })).toBe("Which drives?");
    expect(samePoll({ question: "Q ", options: ["A"] }, { question: "Q", options: ["A"] })).toBe(
      true,
    );
    expect(samePoll({ question: "Q", options: ["A"] }, { question: "Q", options: ["B"] })).toBe(
      false,
    );
  });
});
