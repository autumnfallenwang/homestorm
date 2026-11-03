// Smoke test against the real llmgw. Spends a few tokens of real allowance, so it only runs on request:
//   LLMGW_LIVE=1 pnpm --filter @homestorm/api test:live
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { config } from "../config.js";
import { createLlmgwClient, LlmError, type StreamEvent } from "./llmgw.js";

const live = process.env.LLMGW_LIVE === "1";

describe.skipIf(!live)("llmgw (live)", () => {
  const llm = createLlmgwClient(config.llmgwUrl);

  it("lists the three sources' chat models, with plan availability", async () => {
    const models = await llm.listModels();
    const sources = new Set(models.map((m) => m.ownedBy));
    expect([...sources].sort()).toEqual(["anthropic", "deepseek", "openai-codex"]);
    expect(models.some((m) => m.id === "claude-haiku-5-5" && m.available)).toBe(true);
    expect(models.every((m) => !m.id.startsWith("qwen"))).toBe(true);
  });

  it.each(["claude-haiku-5-5", "gpt-5.6-luna", "deepseek-flash"])(
    "streams a short answer from %s",
    async (model) => {
      const events: StreamEvent[] = [];
      for await (const e of llm.stream({
        model,
        messages: [
          { role: "system", content: "Answer in at most five words." },
          {
            role: "user",
            content:
              "[Chair]: Say hello to the meeting.\n\n[Floor] The Chair asks you to speak now.",
          },
        ],
        maxTokens: 512,
        reasoningEffort: "low",
        requestId: `homestorm-smoke-${randomUUID()}`,
      })) {
        events.push(e);
      }
      const text = events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
      expect(text.trim().length).toBeGreaterThan(0);
      expect(events.at(-1)?.type).toBe("done");
    },
    60_000,
  );

  it("reports an unknown model as model_not_found, never a fallback", async () => {
    const run = async () => {
      for await (const _ of llm.stream({
        model: "claude-does-not-exist-9",
        messages: [{ role: "user", content: "hi" }],
        requestId: randomUUID(),
      })) {
        // no output expected
      }
    };
    await expect(run()).rejects.toMatchObject({ code: "model_not_found" });
    await expect(run()).rejects.toBeInstanceOf(LlmError);
  }, 30_000);

  it("reads limits for a model, and unavailable for one not on the plan", async () => {
    const ok = await llm.limits("claude-haiku-5-5");
    expect(ok?.status).toMatch(/ok|warning|exhausted|unknown/);
    const models = await llm.listModels();
    const off = models.find((m) => !m.available);
    if (off) {
      const l = await llm.limits(off.id);
      expect(l?.status).toBe("unavailable");
    }
  }, 30_000);
});
