// The llmgw client (ADR 0002): every model call homestorm makes goes through here, with the exact model the seat
// names. It never retries on another model, and never retries silently at all: `maxRetries: 0`, because the
// openai SDK would otherwise retry 429s and 5xx behind the chair's back.
//
// llmgw 0.5.0 streams text and reasoning deltas only (ADR 0009). `usage`, `cost_usd` and its `req_id` are read when
// present, from a stream chunk or the response headers, so nothing changes here when llmgw starts sending them.

import type { ErrorCode, LimitStatus, Limits, ModelInfo, Source } from "@homestorm/shared";
import { SOURCES } from "@homestorm/shared";
import OpenAI, { APIError } from "openai";
import { log } from "../lib/logger.js";

/** OpenAI-style content parts; images go as `image_url` data URLs (ADR 0016). */
export type ChatTurnPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatTurn {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string | ChatTurnPart[] }[];
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  /** homestorm's id for this call, sent as X-Request-Id. */
  requestId: string;
  signal?: AbortSignal;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking" }
  | {
      type: "done";
      finishReason: string | null;
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cacheReadTokens?: number;
      } | null;
      costUsd: number | null;
      llmgwReqId: string | null;
    };

/** A failed call, mapped onto the problems the chair sees in place. */
export class LlmError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmClient {
  stream(turn: ChatTurn): AsyncGenerator<StreamEvent>;
  listModels(): Promise<ModelInfo[]>;
  limits(model: string): Promise<Limits | null>;
}

const MODELS_TTL_MS = 5 * 60_000;
const LIMITS_TTL_MS = 60_000;

export function createLlmgwClient(baseUrl: string): LlmClient {
  const base = baseUrl.replace(/\/+$/, "");
  const openai = new OpenAI({
    baseURL: `${base}/v1`,
    apiKey: "homestorm", // llmgw needs no key; the SDK insists on one.
    maxRetries: 0,
    timeout: 10 * 60_000,
  });

  let modelsCache: { at: number; data: ModelInfo[] } | null = null;
  const limitsCache = new Map<string, { at: number; data: Limits | null }>();

  async function getJson(path: string): Promise<unknown> {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok)
      throw new LlmError("gateway_error", `llmgw ${path} returned ${res.status}`, res.status);
    return res.json();
  }

  return {
    async *stream(turn) {
      let llmgwReqId: string | null = null;
      let usage: Extract<StreamEvent, { type: "done" }>["usage"] = null;
      let costUsd: number | null = null;
      let finishReason: string | null = null;
      try {
        const { data: chunks, response } = await openai.chat.completions
          .create(
            {
              model: turn.model,
              // Only user turns carry image parts (the view puts images there); the SDK's types split roles finer.
              messages: turn.messages as OpenAI.Chat.ChatCompletionMessageParam[],
              stream: true,
              stream_options: { include_usage: true },
              ...(turn.maxTokens ? { max_tokens: turn.maxTokens } : {}),
              ...(turn.reasoningEffort ? { reasoning_effort: turn.reasoningEffort } : {}),
            },
            { signal: turn.signal, headers: { "X-Request-Id": turn.requestId } },
          )
          .withResponse();
        llmgwReqId = response.headers.get("x-request-id") ?? response.headers.get("x-llmgw-req-id");

        for await (const chunk of chunks) {
          const raw = chunk as unknown as RawChunk;
          if (raw.usage) usage = readUsage(raw.usage) ?? usage;
          const cost = raw.usage?.cost_usd ?? raw.cost_usd;
          if (typeof cost === "number") costUsd = cost;
          if (typeof raw.req_id === "string") llmgwReqId = raw.req_id;
          const choice = raw.choices?.[0];
          if (!choice) continue;
          if (choice.delta?.refusal) yield { type: "text", text: choice.delta.refusal };
          if (choice.delta?.content) yield { type: "text", text: choice.delta.content };
          else if (choice.delta?.reasoning) yield { type: "thinking" };
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      } catch (err) {
        throw toLlmError(err, turn.signal);
      }
      // ⚠️ The openai SDK ends the stream QUIETLY when the signal aborts: no throw. Without this check a stopped
      // answer looked finished (found in the M6 browser run: Stop all saved a cut-off answer as done).
      if (turn.signal?.aborted) throw new DOMException("The answer was stopped", "AbortError");
      yield { type: "done", finishReason, usage, costUsd, llmgwReqId };
    },

    async listModels() {
      if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.data;
      const body = (await getJson("/v1/models")) as { data: RawModel[] };
      const data = body.data
        .filter(
          (m) =>
            (SOURCES as readonly string[]).includes(m.owned_by) &&
            (m.capability ?? "chat") === "chat",
        )
        .map(
          (m): ModelInfo => ({
            id: m.id,
            ownedBy: m.owned_by as Source,
            contextWindow: m.context_window ?? null,
            maxTokens: m.max_tokens ?? null,
            input: Array.isArray(m.input)
              ? m.input.filter((x) => x === "text" || x === "image")
              : null,
            available: m.status !== "error",
            statusDetail: m.status_detail ?? null,
          }),
        );
      modelsCache = { at: Date.now(), data };
      return data;
    },

    async limits(model) {
      const hit = limitsCache.get(model);
      if (hit && Date.now() - hit.at < LIMITS_TTL_MS) return hit.data;
      let data: Limits | null = null;
      try {
        data = readLimits(await getJson(`/v1/limits?model=${encodeURIComponent(model)}`));
      } catch (err) {
        // No allowance data is not a reason to block a seat: it shows as unknown.
        log.warn({ event: "llmgw.limits_failed", model, err }, "could not read limits");
      }
      limitsCache.set(model, { at: Date.now(), data });
      return data;
    },
  };
}

interface RawChunk {
  choices?: {
    delta?: { content?: string | null; reasoning?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: RawUsage | null;
  cost_usd?: number;
  req_id?: string;
}

export interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  cache_read_tokens?: number;
  cost_usd?: number;
}

interface RawModel {
  id: string;
  owned_by: string;
  capability?: string;
  context_window?: number;
  max_tokens?: number;
  /** llmgw 0.6.0+: ["text"] or ["text", "image"]. */
  input?: string[];
  status?: string;
  status_detail?: string | null;
}

/**
 * llmgw's usage, in homestorm's shape. The prompt is the larger of `prompt_tokens` and `total − completion`: for
 * Claude, llmgw 0.6.0 reports only the uncached part as `prompt_tokens` (4 of a 7,233-token prompt), while the total
 * counts all of it.
 */
export function readUsage(u: RawUsage): Extract<StreamEvent, { type: "done" }>["usage"] {
  if (typeof u.prompt_tokens !== "number" || typeof u.completion_tokens !== "number") return null;
  const cache = u.cache_read_tokens ?? u.prompt_tokens_details?.cached_tokens;
  const fromTotal = typeof u.total_tokens === "number" ? u.total_tokens - u.completion_tokens : 0;
  return {
    promptTokens: Math.max(u.prompt_tokens, fromTotal),
    completionTokens: u.completion_tokens,
    totalTokens: u.total_tokens ?? u.prompt_tokens + u.completion_tokens,
    ...(typeof cache === "number" ? { cacheReadTokens: cache } : {}),
  };
}

/** llmgw's /v1/limits entry, in homestorm's shape. */
export function readLimits(raw: unknown): Limits | null {
  const r = raw as { status?: string; available?: Record<string, unknown> } | null;
  if (!r?.status) return null;
  const a = r.available ?? {};
  const status = r.status as LimitStatus;
  switch (a.kind) {
    case "percent":
      return {
        status,
        available: {
          kind: "percent",
          percentLeft: Number(a.percent_left ?? 0),
          resetsAt: (a.resets_at as string | null) ?? null,
          binding: String(a.binding ?? ""),
        },
      };
    case "balance":
      return {
        status,
        available: {
          kind: "balance",
          amount: Number(a.amount ?? 0),
          currency: String(a.currency ?? "USD"),
        },
      };
    case "unlimited":
      return { status, available: { kind: "unlimited" } };
    case "unavailable":
      return {
        status,
        available: { kind: "unavailable", reason: String(a.reason ?? "Not available") },
      };
    default:
      return { status, available: { kind: "unknown" } };
  }
}

/** Map anything a call can throw onto one visible problem. */
export function toLlmError(err: unknown, signal?: AbortSignal): LlmError | Error {
  if (signal?.aborted) return err instanceof Error ? err : new Error("aborted");
  if (err instanceof LlmError) return err;
  if (err instanceof APIError) {
    const code = String(err.code ?? "");
    const type = String(err.type ?? "");
    const message =
      err.error && typeof err.error === "object" && "message" in err.error
        ? String((err.error as { message: unknown }).message)
        : err.message;
    // Out of allowance: DeepSeek's empty balance, a subscription's used-up window. Told apart from a short rate
    // limit so the problem says what it is.
    if (
      code === "insufficient_quota" ||
      (err.status === 429 && /usage limit|quota|insufficient balance|out of credits/i.test(message))
    ) {
      return new LlmError("out_of_allowance", message, err.status);
    }
    if (err.status === 429 || code === "rate_limit_exceeded" || type === "rate_limit_exceeded") {
      return new LlmError("rate_limited", message, err.status);
    }
    if (code === "context_length_exceeded")
      return new LlmError("context_too_long", message, err.status);
    if (err.status === 404 || code === "model_not_found")
      return new LlmError("model_not_found", message, err.status);
    if (/not supported/i.test(message)) return new LlmError("unavailable", message, err.status);
    return new LlmError("gateway_error", message, err.status);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new LlmError("gateway_error", `Couldn't reach llmgw: ${message}`);
}
