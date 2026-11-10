// A scripted stand-in for mcpgw, next to FakeLlm. Every call is recorded, so tests can check what really ran.

import type { ToolDefinition } from "../services/llmgw.js";
import type { ToolClient, ToolOutcome } from "../services/mcpgw.js";

const def = (name: string): ToolDefinition => ({
  type: "function",
  function: {
    name,
    description: `The ${name} tool`,
    parameters: { type: "object", properties: {}, required: [] },
  },
});

export const SEARCH_URLS = ["https://news.example/gold", "https://metals.example/spot"];

export class FakeTools implements ToolClient {
  readonly calls: { name: string; args: Record<string, unknown>; requestId: string }[] = [];
  /** Make the next `list()` throw, as if mcpgw were down. */
  down = false;
  /** Make `call()` throw, as if mcpgw went down mid-turn. */
  callThrows = false;
  /** Hang in `call()` until aborted, to test Stop. */
  hang = false;
  /** What `web_fetch` returns for a URL; a miss gets a generic page. */
  readonly pages = new Map<string, ToolOutcome>();
  searchResult: ToolOutcome = {
    text: `1. Gold today\n   ${SEARCH_URLS[0]}\n   Gold is $1,234.56.\n\nUse web_fetch to read a page.`,
    isError: false,
    meta: {
      results: [
        { title: "Gold today", url: SEARCH_URLS[0], snippet: "Gold is $1,234.56." },
        {
          title: "Spot prices",
          url: SEARCH_URLS[1],
          snippet: "Spot metals.",
          published: "2026-11-01",
        },
      ],
    },
  };

  /** What code_run returns: by default the code printed 4. */
  codeResult: ToolOutcome = {
    text: "Output:\n4",
    isError: false,
    meta: { status: "ok", output: "4\n", value: null, error: null },
  };
  /** Tools mcpgw also lists that homestorm doesn't run, as a newer mcpgw might. */
  extraTools: string[] = [];

  async list(): Promise<ToolDefinition[]> {
    if (this.down) throw new Error("mcpgw is down");
    return [def("web_search"), def("web_fetch"), def("code_run"), ...this.extraTools.map(def)];
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    opts: { requestId: string; signal?: AbortSignal },
  ): Promise<ToolOutcome> {
    this.calls.push({ name, args, requestId: opts.requestId });
    if (this.callThrows) throw new Error("mcpgw went away");
    if (this.hang) {
      await new Promise((_, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    if (name === "web_search") return this.searchResult;
    if (name === "code_run") return this.codeResult;
    const url = String(args.url);
    return (
      this.pages.get(url) ?? {
        text: `Page title\n${url}\n\nPAGE TEXT from ${url}. See also https://linked-from-page.example/next`,
        isError: false,
        meta: { title: "Page title", final_url: url },
      }
    );
  }
}
