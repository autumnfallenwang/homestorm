# 0003: Build our own app instead of forking a chat app

- **Status:** accepted
- **Date:** 2026-11-02

## Context

Mature open-source chat apps exist. The question was whether to use one, fork one, or build our own. The comparison is
in [chat-wrapper-research.md](../chat-wrapper-research.md) §3.

## Decision

**Build our own**, in the house stack ([0001](0001-house-stack.md)).

Borrow **design ideas, not code** from LobeHub's group chat (its context engine's `GroupRoleTransform` and
`GroupContextInjector`) and from karpathy/llm-council, for a later council mode.

## Alternatives considered

- **Open WebUI** (BSD-3 plus a branding clause; Python + Svelte). Its Channels @mention models, but there are no chair
  rules, and it's a different stack.
- **LibreChat** (MIT; Node + React + MongoDB). Its "one conversation, one assistant" data model would have to change at
  the core.
- **LobeHub v2** (Community License; Next.js, 30+ packages). It has group chat, but it's huge, its AI moderator
  conflicts with "the user is the chair", and distributing a modified version needs a paid license.
- **big-AGI, Vercel AI SDK, assistant-ui.** Built for side-by-side comparison or one assistant per chat; at most a
  source of UI building blocks.

## Consequences

- We build only what we need: most of these apps' code (document search, MCP tools, voice, plugins, team logins) is
  skipped.
- **The chair rules are ours**, with no upstream app's assumptions in the way.
- **We own the basics:** streaming, Markdown rendering, saving and context limits. llmgw already handles providers,
  limits and cost.
