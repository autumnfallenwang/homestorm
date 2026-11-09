import { describe, expect, it } from "vitest";
import { contextBudgetTokens, maxOutputTokens } from "./budget.js";

describe("maxOutputTokens", () => {
  it("adds thinking room to the answer cap, by effort", () => {
    expect(maxOutputTokens("concise", "low", null)).toBe(10_240);
    expect(maxOutputTokens("concise", "medium", null)).toBe(18_432);
    expect(maxOutputTokens("concise", "high", null)).toBe(34_816);
    expect(maxOutputTokens("detailed", "low", null)).toBe(16_384);
    expect(maxOutputTokens("detailed", "high", null)).toBe(40_960);
    // Off keeps a little, for a model that can't stop thinking.
    expect(maxOutputTokens("concise", "off", null)).toBe(4_096);
  });

  it("never asks for more than the model allows", () => {
    expect(maxOutputTokens("concise", "low", 4_096)).toBe(4_096);
    expect(maxOutputTokens("detailed", "high", 128_000)).toBe(40_960);
  });
});

describe("contextBudgetTokens", () => {
  const cap = 10_240;

  it("gives each preset its size for a 1M-token model", () => {
    expect(contextBudgetTokens("small", 1_000_000, cap, 120_000)).toBe(32_000);
    expect(contextBudgetTokens("standard", 1_000_000, cap, 120_000)).toBe(120_000);
    expect(contextBudgetTokens("large", 1_000_000, cap, 120_000)).toBe(500_000);
    expect(contextBudgetTokens("full", 1_000_000, cap, 120_000)).toBe(985_760);
  });

  it("scales Large and Full to a smaller window", () => {
    expect(contextBudgetTokens("large", 272_000, cap, 120_000)).toBe(136_000);
    expect(contextBudgetTokens("full", 272_000, cap, 120_000)).toBe(257_760);
  });

  it("never goes past the window, and falls back to Standard without one", () => {
    expect(contextBudgetTokens("standard", 32_768, 4_096, 120_000)).toBe(24_672);
    expect(contextBudgetTokens("full", null, cap, 120_000)).toBe(120_000);
    expect(contextBudgetTokens("large", null, cap, 120_000)).toBe(120_000);
    expect(contextBudgetTokens("small", 4_000, 4_096, 120_000)).toBe(1_000);
  });
});
