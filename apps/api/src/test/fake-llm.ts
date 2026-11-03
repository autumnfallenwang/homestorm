// A scripted stand-in for llmgw, for engine and route tests. Each model answers from a script; every call is recorded
// so tests can check exactly what each seat was shown.

import type { Limits, ModelInfo, Source } from "@homestorm/shared";
import { type ChatTurn, type LlmClient, LlmError, type StreamEvent } from "../services/llmgw.js";

export interface Script {
  chunks: string[];
  /** Wait this long before each chunk (ms). */
  delayMs?: number;
  /** After the chunks, hang until the call is aborted (to test Stop). */
  hangAfterChunks?: boolean;
  /** On abort, end the stream quietly instead of throwing (what the openai SDK does). */
  quietAbort?: boolean;
  /** Throw this after the chunks. */
  error?: LlmError;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

const DEFAULT_MODELS: ModelInfo[] = [
  model("claude-opus-5-5", "anthropic"),
  model("gpt-6-luna", "openai-codex"),
  model("deepseek-v4-pro", "deepseek"),
  {
    ...model("gpt-6-sol", "openai-codex"),
    available: false,
    statusDetail: "not supported on this plan",
  },
];

function model(id: string, ownedBy: Source): ModelInfo {
  return {
    id,
    ownedBy,
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    available: true,
    statusDetail: null,
  };
}

export class FakeLlm implements LlmClient {
  readonly calls: ChatTurn[] = [];
  readonly limitsByModel = new Map<string, Limits | null>();
  /** Scripts per model; each call takes the next one, the last repeats. */
  readonly scripts = new Map<string, Script[]>();
  models: ModelInfo[] = DEFAULT_MODELS;

  /** Answer `model` with these scripts, in order. */
  on(model: string, ...scripts: Script[]): this {
    this.scripts.set(model, scripts);
    return this;
  }

  callsFor(model: string): ChatTurn[] {
    return this.calls.filter((c) => c.model === model);
  }

  async *stream(turn: ChatTurn): AsyncGenerator<StreamEvent> {
    this.calls.push(turn);
    const queue = this.scripts.get(turn.model) ?? [];
    const script = (queue.length > 1 ? queue.shift() : queue[0]) ?? {
      chunks: [`answer from ${turn.model}`],
    };
    for (const chunk of script.chunks) {
      await sleep(script.delayMs ?? 1, turn.signal);
      yield { type: "text", text: chunk };
    }
    if (script.hangAfterChunks) {
      try {
        await sleep(60_000, turn.signal);
      } catch (err) {
        if (!script.quietAbort) throw err;
        yield { type: "done", finishReason: null, usage: null, costUsd: null, llmgwReqId: null };
        return;
      }
    }
    if (script.error) throw script.error;
    yield {
      type: "done",
      finishReason: "stop",
      usage: script.usage ?? null,
      costUsd: null,
      llmgwReqId: null,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models;
  }

  async limits(model: string): Promise<Limits | null> {
    return (
      this.limitsByModel.get(model) ?? {
        status: "ok",
        available: { kind: "percent", percentLeft: 80, resetsAt: null, binding: "weekly" },
      }
    );
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

export { LlmError };
