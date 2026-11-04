# 0014: Tools through mcpgw; homestorm runs the loop

- **Status:** accepted, not built. It waits for mcpgw.
- **Date:** 2026-11-04

## Context

Every model behind llmgw answers only from its training data, so a seat can't check a price, a release date or
today's news. llmgw passes standard function tools through for Claude, GPT and DeepSeek (`tools`, `tool_calls`,
`role: "tool"` results), but it runs no tool and exposes no provider's built-in search.

A tool loop was tried against the real llmgw on 2026-11-04 with a fake MCP server offering one `web_search` that
returned a made-up gold price (`~/agentic/mcpgw/dev/tool-loop-demo/`):

- Claude Haiku 5.5, GPT-5.6 Luna and DeepSeek Flash each **chose** to search for "the current price of gold" and
  wrote their own query. None searched for "Who wrote Hamlet?".
- All three quoted the made-up price, so the answers came from the tool.
- They trusted it differently: Claude called the test feed implausible, DeepSeek said to cross-check, and GPT
  stated it as fact.

## Decision

**Tools come from mcpgw, the home cluster's tool gateway** (design: `~/agentic/mcpgw/docs/design.md`). llmgw stays
the model gateway; mcpgw runs tools (`web_search` through a self-hosted SearXNG, `web_fetch`, more later) over MCP
and a REST mirror.

**homestorm runs the tool loop itself,** because when tools are used is meeting control:

1. **The date in the intro** (no mcpgw needed): "Today is …; your training data may be older." Models that know the
   date can tell when their knowledge may be stale.
2. **Chair search first.** A "Search the web" action: homestorm calls mcpgw's `web_search` and posts the results
   into the record as one "Sources" message. No model decides anything, and every seat reads the same sources, so
   blind rounds stay fair.
3. **Seat tools later.** A seat setting "Can search the web". homestorm passes mcpgw's tools to llmgw for that
   seat only, runs each tool call on mcpgw, and returns the result, up to a few calls per turn. Under the answer:
   "Searched: … · Read: …"; the sources enter the record. A "must search" option sets `tool_choice: required`.

## Alternatives considered

- **Provider built-in search** (Claude's `web_search` server tool, OpenAI's web search). Rejected: not reachable
  through llmgw, and it covers some families and not others, so seats wouldn't be comparable.
- **Tools inside llmgw.** Rejected in the mcpgw design: a slow or crashing tool, or a future code sandbox, must not
  share a process with the model logins every app depends on.
- **The tool loop inside mcpgw** (an agent service). Rejected: homestorm needs to decide which seats may use tools,
  how many calls a turn gets, and who sees the results.
- **Always search before answering** (search-first, as answer engines do). Covered by chair search when wanted;
  not the default, since most meeting questions don't need the web.

## Consequences

- homestorm depends on two gateways: llmgw for models, mcpgw for tools. Without mcpgw, the tool features are off
  and everything else works as now.
- Seat tools make turns slower and use more allowance; the per-turn call limit bounds both.
- In a blind round, seats that search may read different sources. Chair search avoids that, which is why it comes
  first.
- Some models repeat a weak source as fact, so the sources must always be visible to the chair.
- homestorm streams answers; streaming `tool_calls` through llmgw is not tested yet and is checked first when seat
  tools are built.
