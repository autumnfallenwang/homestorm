// The client against a fake MCP server over real HTTP, speaking the 2025 protocol the SDK's client uses by default.
// Seeded from mcpgw's dev/tool-loop-demo.
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMcpgwClient } from "./mcpgw.js";

const META = "arch.internal/mcpgw";
let server: Server;
let base: string;
let requests: { method: string; headers: IncomingHttpHeaders }[] = [];
let failAll = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      if (failAll) return void res.writeHead(500).end();
      if (req.method !== "POST") return void res.writeHead(405).end();
      const rpc = JSON.parse(body);
      requests.push({ method: rpc.method, headers: req.headers });
      if (rpc.id === undefined) return void res.writeHead(202).end();
      const reply = (result: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
      };
      if (rpc.method === "initialize") {
        return reply({
          protocolVersion: rpc.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fake-mcpgw", version: "0" },
        });
      }
      if (rpc.method === "tools/list") {
        return reply({
          tools: [
            {
              name: "web_search",
              description: "Search",
              inputSchema: {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ],
        });
      }
      if (rpc.method === "tools/call") {
        if (rpc.params.arguments.query === "fails") {
          return reply({ content: [{ type: "text", text: "It timed out." }], isError: true });
        }
        return reply({
          content: [{ type: "text", text: `Results for ${rpc.params.arguments.query}` }],
          _meta: { [META]: { results: [{ url: "https://a.example/" }] } },
        });
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  requests = [];
  failAll = false;
});

describe("createMcpgwClient", () => {
  it("lists tools in the format llmgw takes, passing the schema through", async () => {
    const tools = await createMcpgwClient(base).list();
    expect(tools).toEqual([
      {
        type: "function",
        function: {
          name: "web_search",
          description: "Search",
          parameters: expect.objectContaining({ required: ["query"] }),
        },
      },
    ]);
  });

  it("caches the list", async () => {
    const client = createMcpgwClient(base);
    await client.list();
    await client.list();
    expect(requests.filter((r) => r.method === "tools/list")).toHaveLength(1);
  });

  it("returns the text for the model and the data for homestorm", async () => {
    const out = await createMcpgwClient(base).call(
      "web_search",
      { query: "gold" },
      { requestId: "r1" },
    );
    expect(out).toEqual({
      text: "Results for gold",
      isError: false,
      meta: { results: [{ url: "https://a.example/" }] },
    });
  });

  it("names itself, and sends each call's own ID", async () => {
    const client = createMcpgwClient(base);
    await Promise.all([
      client.call("web_search", { query: "a" }, { requestId: "turn-a" }),
      client.call("web_search", { query: "b" }, { requestId: "turn-b" }),
    ]);
    const calls = requests.filter((r) => r.method === "tools/call");
    expect(calls.map((c) => c.headers["x-request-id"]).sort()).toEqual(["turn-a", "turn-b"]);
    expect(calls.every((c) => c.headers["x-client"] === "homestorm")).toBe(true);
  });

  it("reports a tool's own failure, without throwing", async () => {
    const out = await createMcpgwClient(base).call(
      "web_search",
      { query: "fails" },
      { requestId: "r" },
    );
    expect(out).toMatchObject({ text: "It timed out.", isError: true, meta: null });
  });

  it("throws when mcpgw is down, and works again once it's back", async () => {
    const client = createMcpgwClient(base);
    failAll = true;
    await expect(client.call("web_search", { query: "a" }, { requestId: "r" })).rejects.toThrow();
    failAll = false;
    await expect(
      client.call("web_search", { query: "a" }, { requestId: "r" }),
    ).resolves.toMatchObject({
      isError: false,
    });
  });

  it("throws when nothing is listening", async () => {
    await expect(createMcpgwClient("http://127.0.0.1:1").list()).rejects.toThrow();
  });
});
