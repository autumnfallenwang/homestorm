import { describe, expect, it } from "vitest";
import { maxOutputTokens, viewBudget } from "./tokens.js";

describe("maxOutputTokens", () => {
  it("adds thinking room to the answer cap, by effort", () => {
    expect(maxOutputTokens("concise", "low", null)).toBe(10_240);
    expect(maxOutputTokens("concise", "medium", null)).toBe(18_432);
    expect(maxOutputTokens("concise", "high", null)).toBe(34_816);
    expect(maxOutputTokens("detailed", "low", null)).toBe(16_384);
    expect(maxOutputTokens("detailed", "high", null)).toBe(40_960);
  });

  it("never asks for more than the model allows", () => {
    expect(maxOutputTokens("concise", "low", 4_096)).toBe(4_096);
    expect(maxOutputTokens("detailed", "high", 128_000)).toBe(40_960);
  });
});

describe("viewBudget", () => {
  it("leaves room for the reply and a margin, under homestorm's cap", () => {
    expect(viewBudget(null, 10_240, 120_000)).toBe(120_000);
    expect(viewBudget(1_000_000, 10_240, 120_000)).toBe(120_000);
    expect(viewBudget(32_768, 4_096, 120_000)).toBe(24_672);
  });
});
