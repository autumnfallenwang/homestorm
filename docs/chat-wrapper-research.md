# Chat Wrapper Research

Reference notes for the **homestorm** home app: a meeting room where several AI models answer the same
questions, with the user as chairman. This doc covers only the **LLM wrapper part**: what a chat app does around
the model call, which existing apps we looked at, and how each bot sees a shared meeting. The chair and turn rules
are designed separately.

Researched 2026-11-02.

---

## 1. Decision

**Build our own app in the home-app stack, and borrow design ideas (not code) from LobeHub's group chat.**

- **Stack:** the same as homejobboard / homenews / homecal / homework. That's a pnpm + turbo monorepo with a Hono API
  (`@hono/node-server`), Postgres via Drizzle, zod and vitest on the server, and Next.js + React + shadcn + Tailwind on
  the web side. LLM calls use the `openai` package pointed at llmgw.
- **Why:**
  - llmgw already does the heavy wrapper work: providers, streaming, limits, cost and logging.
  - The feature that matters (several bots in one meeting, with the user as chair) is exactly what existing apps do worst.
  - Forking any of them means fighting a "one chat = one assistant" data model, or an AI moderator.
- **Optional before building:** spend 10 minutes trying LobeHub's group chat, to see what feels right or wrong in practice.

---

## 2. Backend: llmgw

Everything goes through the home LLM gateway. Nothing in the chat room talks to a provider directly.

| Item | Value |
|---|---|
| Base URL | `http://llmgw.arch.internal` (from the dev host; `llmgw.arch.local` did not resolve) |
| API docs | `/docs` (Swagger UI), `/openapi.json` |
| Version check | `GET /` returns `version` + `commit` (0.5.0 / `e36e08c` on 2026-11-02) |
| Chat | `POST /v1/chat/completions`, OpenAI format, `stream: true` for SSE, supports `reasoning_effort` |
| Model list | `GET /v1/models` returns `id`, `owned_by`, `context_window`, `max_tokens`, `status`, `status_detail` |
| Limits | `GET /v1/limits[?model=]` returns `status`, `available` (percent left + reset time, a balance, or `unavailable`) and `windows`, cached about 1 minute |

**Sources (`owned_by`):**

| `owned_by` | What it is | Billing |
|---|---|---|
| `anthropic` | Claude, via the Claude subscription | Subscription windows (weekly; Fable models also have their own weekly window) |
| `openai-codex` | GPT, via the ChatGPT subscription | Monthly window |
| `deepseek` | DeepSeek, via the API key | Prepaid balance |
| `ollama` | Local models | Unlimited. **Not used in the chat room.** |

Gemini: none for now.

**Working models (verified 2026-11-01/02):**

- **Claude:** `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5`,
  `claude-opus-5`, `claude-sonnet-5`
- **GPT:** `gpt-6-luna`, `gpt-5.6-terra`, `gpt-5.6-luna`. Catalog models that aren't on the current plan return 404,
  and `/v1/limits` reports them `unavailable`.
- **DeepSeek:** `deepseek-v4-pro`, `deepseek-flash`. `deepseek-v4-flash` is a 404 at the gateway, even though
  DeepSeek's own API accepts it as another name.

**How the gateway behaves:**

- **Exact model only:** you pass the exact ID or `owned_by/model` (e.g. `deepseek/deepseek-flash`). There are no
  aliases and no fallback to another model. An unknown ID returns 404, and upstream errors come back as-is
  (429 / 404 / 500).
- **Response `model`:** it echoes what was sent, which is accurate because nothing gets swapped.
- **Image exception:** if an image goes to a text-only model, another model describes it first, and for GPT that can
  be a local Ollama model. The current Claude/GPT models normally read images, so this shouldn't trigger.
- **Logs:** each call writes a `completion.usage` log line with provider, model, tokens, `cost_usd`, limit status and
  `req_id`, shared with its `http.request` line. For streamed requests, `http.request.latency_ms` is only the time
  until the stream starts.
- **Loki:** `req_id` is not a label. Search with `{namespace="llmgw"} | json | req_id="<id>"`.
- **Account details** (plans, balances, how llmgw signs in to each provider) are kept in the gitignored
  `private/notes.md`, not in this repo. homestorm only depends on llmgw's API, so it doesn't change when they change.

---

## 3. Existing apps we looked at

| App | License | Stack | Several bots in one chat? | Verdict |
|---|---|---|---|---|
| **Open WebUI** | BSD-3 + branding clause (since v0.6.6; doesn't apply at 50 or fewer users per 30 days) | Python + Svelte | Only "Channels": @mention a model, and it replies with the channel history | Different stack; enforcing chair rules means deep changes |
| **LibreChat** | MIT | Node + React + MongoDB + Meilisearch (+ pgvector RAG) | No: one conversation has one assistant | Cleanest license, but several speakers would touch its core data model |
| **LobeHub v2** | LobeHub Community License (Apache 2.0 + conditions: distributing a modified version needs a commercial license) | Next.js monorepo, 30+ packages | **Yes**: group chat with an AI moderator, @mentions, modes such as sequential / parallel / debate | Closest match, but huge, and its AI moderator conflicts with "the user is the chair". Best as a **design reference** (local clone at `~/agentic/lobe-chat`, v2.1.28) |
| **big-AGI** | MIT (core) | Next.js | "Beam": several models answer side by side, then merge | A comparison tool, not a meeting |
| **Vercel AI SDK + chatbot template / AI Elements** | Open source | React hooks + shadcn-based components | Built around one assistant per thread | Possible UI building blocks only |
| **assistant-ui** | Open source | React chat components | Built around one assistant per thread | Same |
| **karpathy/llm-council** | Open source | Python + OpenRouter | All answer, rank each other anonymously, then a "chairman" AI summarizes | Idea for a later meeting mode |

---

## 4. What a chat wrapper does, and what we need

### Needed from the start

1. **Streaming display** over SSE from llmgw, with **stop**, **retry** and **regenerate**. Retry and regenerate
   always use the same model, matching the no-fallback rule.
2. **Saving everything:** meetings, participants and messages in Postgres. Store the per-message `model`,
   `owned_by`, token usage, `cost_usd` and the llmgw `req_id`, so every message can be traced to its source and its
   Loki logs.
3. **Building each bot's view** of the meeting (see §5). This is the core of the wrapper.
4. **Fitting long meetings into each model's limit.** Every bot re-reads the whole meeting each turn, so the
   transcript grows quickly.
   - Take each model's limit from `/v1/models` (`context_window`, `max_tokens`); different bots have different limits.
   - Start by dropping the oldest turns, while always keeping the intro and the current question.
   - Later, add a running summary of older turns.
5. **Markdown + code rendering** for replies.
6. **Showing cost and limits:**
   - per message: tokens and cost, from the reply's `usage` and the llmgw usage data;
   - per participant: allowance left, from `/v1/limits?model=`;
   - a participant whose limit is `unavailable` or `exhausted` can't take the floor.
7. **Showing errors clearly:** rate limited, unavailable, context too long. Never hide an error or switch models.

### Later

- Attachments and images. Watch llmgw's image workaround: a second model may see the image.
- Export meeting minutes as Markdown.
- Branching a meeting from a past message.
- Search across meetings.
- Per-participant `reasoning_effort`.
- Meeting title generation with a cheap model (e.g. `deepseek-flash` or `claude-haiku-5-5`).
- "Council" mode: anonymous peer review, then a summary (llm-council style).

### Skip (most of what big chat apps are made of)

Document search and knowledge bases (RAG), MCP / tools, web search, image generation, voice, plugin marketplaces,
team logins / admin panels, and memory across meetings.

---

## 5. Building each bot's view of the shared meeting

LLM APIs only know `system`, `user` and `assistant`, so a room with many speakers has to be translated **separately
for each bot** on every turn. The pattern below comes from LobeHub's context engine
(`~/agentic/lobe-chat/packages/context-engine/src`: `processors/GroupRoleTransform.ts` and
`providers/GroupContextInjector.ts`), plus the Mastra and MindStudio write-ups.

### Rules

1. **Own messages stay `assistant`.** When bot X is about to speak, X's earlier messages are sent as `assistant`.
2. **Everyone else becomes `user`, with a speaker tag.** That covers the chairman (the human) and every other bot:
   `[Chair]: …`, `[Claude Opus 5.5]: …`, `[GPT-6 Luna]: …`.
   - LobeHub notes that tagging only other speakers stops the model from imitating speaker tags in its own reply.
   - Still strip any leading `[Name]:` the model writes anyway, and say in the intro "don't prefix your reply with
     your name".
3. **Merge back-to-back `user` messages into one.** Some providers reject two `user` messages in a row (DeepSeek
   is named in the Mastra write-up). Merge the tagged messages between X's turns into a single `user` message.
4. **The intro goes first** (system prompt, LobeHub's "group context injection"). It contains:
   - the bot's own identity (display name, which model it is);
   - the roster (who else is in the room);
   - the meeting purpose, plus the current rules (only speak when given the floor, how to address others,
     how long to answer);
   - an optional per-participant persona.
5. **Never rewrite earlier messages, only add to the end.**
   - Build each bot's view the same way every time, so the start of each request stays identical between that bot's
     turns.
   - That lets prompt caching kick in (llmgw's usage log already has a `cache_read_tokens` field; whether caching
     actually happens for each model is still unchecked).
   - Caching matters because every turn re-sends the whole meeting.
   - Put anything that changes from turn to turn, such as "you now have the floor; the chair asks…", at the **end**,
     never in the intro.
6. **Use the same view everywhere:** one function, `buildView(meeting, participantId)`, returns the messages for a
   given bot. Every model goes through llmgw in the same OpenAI format, so nothing differs per provider in the
   chat room.

### Example: what Claude sees when it gets the floor

```
system:    You are "Claude Opus 5.5" in a meeting chaired by the user. Members: Chair (human),
           Claude Opus 5.5 (you), GPT-6 Luna, DeepSeek V4 Pro. Speak only when given the floor.
           Don't prefix replies with your name. …
user:      [Chair]: Should we cache at the edge or in the API?
assistant: (Claude's own earlier answer)
user:      [GPT-6 Luna]: I disagree with Claude on …
           [DeepSeek V4 Pro]: Both miss …
           [Chair]: Claude, respond to GPT's point.
```

---

## 6. Open questions for the next design steps

- The data model: meeting, participant (model + display name + persona), message (speaker, content, usage,
  `req_id`), and turn / floor state.
- Chair controls: give the floor, go around the table, mute, ask everyone, private question to one bot, end and
  summarize.
- Whether private questions are hidden from the other bots' views. If so, `buildView` has to filter by who can see
  each message.
- When several bots answer at once ("ask everyone"): does each see the others' answers, or answer blind?
  llm-council's approach is blind first, then a review round.
- Rules for trimming long meetings: how many turns to keep, and when to add a summary.

---

## Sources

- [wz-it: Open WebUI, LibreChat, AnythingLLM & co. compared (2026)](https://wz-it.com/en/blog/open-source-ai-chat-platforms-comparison/)
- [Pinggy: open-source ChatGPT alternatives (2026)](https://pinggy.io/blog/best_open_source_alternatives_to_chatgpt/)
- [Open WebUI license](https://docs.openwebui.com/license/) and the [branding clause explained](https://wz-it.com/en/blog/open-webui-license-branding-business/)
- [Open WebUI Channels](https://docs.openwebui.com/features/channels.md)
- [LobeHub Community License](https://cdn.jsdelivr.net/npm/@lobehub/chat@1.143.3/LICENSE) and the [license discussion (issue #9325)](https://github.com/lobehub/lobehub/issues/9325)
- [LobeHub RFC 130: multi-agent group chat](https://lobehub.com/blog/rfc-130) and the [v2 changelog](https://lobehub.com/changelog/2026-01-27-v2)
- [About LibreChat (MIT)](https://librechat.ai/about) and the [LibreChat 2026 roadmap](https://www.librechat.ai/blog/2026-02-18_2026_roadmap)
- [big-AGI](https://github.com/enricoros/big-AGI)
- [Vercel AI chatbot template](https://chat.vercel.ai), [AI Elements](https://elements.ai-sdk.dev/docs/ai-sdk-ui), [assistant-ui + AI SDK](https://www.assistant-ui.com/docs/runtimes/ai-sdk)
- [Mastra: multi-user, multi-channel agents (speaker names, merging user turns)](https://mastra.ai/blog/building-multi-user-multi-channel-agents)
- [MindStudio: agent chat rooms / multi-agent debate](https://www.mindstudio.ai/blog/agent-chat-rooms-multi-agent-debate-claude-code)
- [karpathy/llm-council](https://github.com/karpathy/llm-council)
