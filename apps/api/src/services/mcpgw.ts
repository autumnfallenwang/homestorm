// The mcpgw client (ADR 0014): every tool call homestorm makes goes through here. mcpgw runs the tools; homestorm
// decides which seats may use them, how many calls a turn gets, and who sees the results.

import { AsyncLocalStorage } from "node:async_hooks";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { ToolDefinition } from "./llmgw.js";

/** Where mcpgw puts data for apps on a tool result. Models don't see it. */
const META_KEY = "arch.internal/mcpgw";
const TOOLS_TTL_MS = 5 * 60_000;

export interface ToolOutcome {
  /** What the model reads. */
  text: string;
  /** The tool ran and couldn't finish. `text` says why, for the model to read. */
  isError: boolean;
  /** The same data as JSON, for homestorm. */
  meta: Record<string, unknown> | null;
}

export interface ToolClient {
  /** The tools in the OpenAI format llmgw takes. Throws when mcpgw can't be reached. */
  list(): Promise<ToolDefinition[]>;
  /** Throws when mcpgw can't be reached. A tool that fails comes back with `isError`. */
  call(
    name: string,
    args: Record<string, unknown>,
    opts: { requestId: string; signal?: AbortSignal },
  ): Promise<ToolOutcome>;
}

export function createMcpgwClient(baseUrl: string): ToolClient {
  const url = new URL("/mcp", baseUrl);
  // One connection serves every seat, so each call's ID travels this way to the fetch below.
  const call = new AsyncLocalStorage<{ requestId: string }>();
  let connecting: Promise<Client> | null = null;
  let toolsCache: { at: number; data: ToolDefinition[] } | null = null;

  function connection(): Promise<Client> {
    connecting ??= (async () => {
      const client = new Client({ name: "homestorm", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(url, {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set("X-Client", "homestorm");
          const requestId = call.getStore()?.requestId;
          if (requestId) headers.set("X-Request-Id", requestId);
          return fetch(input, { ...init, headers });
        },
      });
      await client.connect(transport);
      return client;
    })().catch((err) => {
      connecting = null;
      throw err;
    });
    return connecting;
  }

  /** mcpgw is stateless, so after any failure the next call simply connects again. */
  async function withConnection<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await connection();
    try {
      return await fn(client);
    } catch (err) {
      connecting = null;
      void client.close().catch(() => {});
      throw err;
    }
  }

  return {
    async list() {
      if (toolsCache && Date.now() - toolsCache.at < TOOLS_TTL_MS) return toolsCache.data;
      const { tools } = await withConnection((client) => client.listTools());
      const data = tools.map(
        (t): ToolDefinition => ({
          type: "function",
          function: {
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            parameters: t.inputSchema,
          },
        }),
      );
      toolsCache = { at: Date.now(), data };
      return data;
    },

    call(name, args, opts) {
      return call.run({ requestId: opts.requestId }, () =>
        withConnection(async (client) => {
          const result = await client.callTool(
            { name, arguments: args },
            opts.signal ? { signal: opts.signal } : undefined,
          );
          const blocks = (result.content ?? []) as { type: string; text?: string }[];
          return {
            text: blocks
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("\n"),
            isError: result.isError === true,
            meta: (result._meta?.[META_KEY] as Record<string, unknown> | undefined) ?? null,
          };
        }),
      );
    },
  };
}
