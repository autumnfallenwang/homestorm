import { describe, expect, it } from "vitest";
import { seatAnswerLength, seatWebAccess, toolSummary } from "./domain.js";

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

describe("toolSummary", () => {
  it("lists each search and page once, even from a turn that repeated one", () => {
    const page = "https://a.example/burn-in";
    expect(
      toolSummary([
        { tool: "web_search", input: "burn-in 16TB", status: "ok", urls: [page] },
        { tool: "web_fetch", input: "https://b.example/x", status: "failed", detail: "HTTP 403" },
        { tool: "web_fetch", input: page, status: "ok" },
        { tool: "web_fetch", input: page, status: "ok" },
      ]),
    ).toBe(`Searched: "burn-in 16TB" · Read: ${page}`);
  });
});

describe("toolSummary with Python", () => {
  it("counts the code runs that worked", () => {
    const run = (status: "ok" | "failed") => ({ tool: "code_run" as const, input: "x", status });
    expect(toolSummary([run("ok")])).toBe("Ran Python");
    expect(toolSummary([run("ok"), { ...run("ok"), input: "y" }, run("failed")])).toBe(
      "Ran Python twice",
    );
    expect(
      toolSummary([
        { tool: "web_search", input: "q", status: "ok" },
        ...["a", "b", "c"].map((input) => ({ ...run("ok"), input })),
      ]),
    ).toBe('Searched: "q" · Ran Python 3 times');
  });
});
