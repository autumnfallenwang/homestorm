import { describe, expect, it } from "vitest";
import { createLlmgwClient, readUsage } from "./llmgw.js";

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

describe("stream, with tools", () => {
  /** A fake llmgw that answers with these SSE chunks, and records what it was sent. */
  async function serve(chunks: unknown[]) {
    const { createServer } = await import("node:http");
    const sent: Record<string, unknown>[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        sent.push(JSON.parse(body));
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}`, sent, close: () => server.close() };
  }
  const delta = (d: unknown, finish: string | null = null) => ({
    choices: [{ delta: d, finish_reason: finish }],
  });

  it("assembles tool calls from their pieces, and keeps parallel calls apart", async () => {
    const llmgw = await serve([
      delta({ content: "Checking." }),
      delta({
        tool_calls: [{ index: 0, id: "a", function: { name: "web_search", arguments: "" } }],
      }),
      delta({
        tool_calls: [{ index: 1, id: "b", function: { name: "web_fetch", arguments: '{"u' } }],
      }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] }),
      delta({ tool_calls: [{ index: 1, function: { arguments: 'rl":"x"}' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '"gold"}' } }] }),
      delta({}, "tool_calls"),
    ]);
    const events = [];
    for await (const ev of createLlmgwClient(llmgw.url).stream({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      requestId: "r",
    })) {
      events.push(ev);
    }
    llmgw.close();
    expect(events.at(0)).toEqual({ type: "text", text: "Checking." });
    expect(events.at(-1)).toMatchObject({
      type: "done",
      finishReason: "tool_calls",
      toolCalls: [
        { id: "a", name: "web_search", arguments: '{"query":"gold"}' },
        { id: "b", name: "web_fetch", arguments: '{"url":"x"}' },
      ],
    });
  });

  it("reports no tool calls on a plain answer", async () => {
    const llmgw = await serve([delta({ content: "Hi" }), delta({}, "stop")]);
    const events = [];
    for await (const ev of createLlmgwClient(llmgw.url).stream({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      requestId: "r",
    })) {
      events.push(ev);
    }
    llmgw.close();
    expect(events.at(-1)).toMatchObject({ toolCalls: [] });
  });

  it("sends tools and the choice only when there are tools", async () => {
    const llmgw = await serve([delta({ content: "Hi" }, "stop")]);
    const client = createLlmgwClient(llmgw.url);
    const tool = {
      type: "function" as const,
      function: { name: "web_search", parameters: { type: "object" } },
    };
    const drain = async (extra: object) => {
      for await (const _ of client.stream({
        model: "m",
        messages: [{ role: "user", content: "q" }],
        requestId: "r",
        ...extra,
      })) {
        // only what was sent matters here
      }
    };
    await drain({});
    await drain({ tools: [tool] });
    const named = { type: "function", function: { name: "web_search" } };
    await drain({ tools: [tool], toolChoice: named });
    llmgw.close();
    expect(llmgw.sent[0]?.tools).toBeUndefined();
    expect(llmgw.sent[0]?.tool_choice).toBeUndefined();
    expect(llmgw.sent[1]).toMatchObject({ tools: [tool], tool_choice: "auto" });
    expect(llmgw.sent[2]).toMatchObject({ tool_choice: named });
  });
});
