import { describe, expect, it } from "vitest";
import { readUsage } from "./llmgw.js";

describe("readUsage", () => {
  it("counts the whole prompt even when llmgw reports only Claude's uncached part", () => {
    // Claude through llmgw 0.6.0, a 7.2k-token prompt read from cache.
    expect(readUsage({ prompt_tokens: 4, completion_tokens: 50, total_tokens: 7287 })).toEqual({
      promptTokens: 7237,
      completionTokens: 50,
      totalTokens: 7287,
    });
    // GPT and DeepSeek report it whole.
    expect(
      readUsage({ prompt_tokens: 5614, completion_tokens: 6, total_tokens: 5620 })?.promptTokens,
    ).toBe(5614);
    expect(readUsage({ prompt_tokens: 10, completion_tokens: 2 })?.promptTokens).toBe(10);
    expect(readUsage({ completion_tokens: 2 })).toBeNull();
  });
});
