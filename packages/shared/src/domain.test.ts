import { describe, expect, it } from "vitest";
import { seatAnswerLength, seatWebAccess } from "./domain.js";

describe("seatAnswerLength", () => {
  it("follows the room rule unless the seat has its own", () => {
    expect(seatAnswerLength({ answerLength: null }, { answerLength: "concise" })).toBe("concise");
    expect(seatAnswerLength({ answerLength: null }, { answerLength: "detailed" })).toBe("detailed");
    expect(seatAnswerLength({ answerLength: "detailed" }, { answerLength: "concise" })).toBe(
      "detailed",
    );
    expect(seatAnswerLength({ answerLength: "concise" }, { answerLength: "detailed" })).toBe(
      "concise",
    );
  });
});

describe("seatWebAccess", () => {
  it("follows the room rule unless the seat has its own, Off included", () => {
    expect(seatWebAccess({ webAccess: null }, { webAccess: "off" })).toBe("off");
    expect(seatWebAccess({ webAccess: null }, { webAccess: "must" })).toBe("must");
    expect(seatWebAccess({ webAccess: "on" }, { webAccess: "off" })).toBe("on");
    expect(seatWebAccess({ webAccess: "off" }, { webAccess: "on" })).toBe("off");
  });
});
