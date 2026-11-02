# Progress

A dated log of what was done and decided, newest first. The plan and milestone status live in [plan.md](plan.md).

---

## 2026-11-02

- **Repo created and made public:** `autumnfallenwang/homestorm`, with README, plan, this log, ADRs 0001–0008 and the
  two design docs. It's plain Markdown docs only: no devkit scaffold, hooks or project skills. Account-specific details
  (plans, balances, allowance numbers, how llmgw signs in, private links) live in the gitignored `private/notes.md`.
- **Name decided:** homestorm, as in brainstorming together ([ADR 0008](adr/0008-name-homestorm.md)).
- **UI mockup approved:** a three-pane meeting UI plus a controls-and-states board
  ([ADR 0007](adr/0007-three-pane-meeting-ui.md)).
- **Meeting control designed** ([meeting-control-design.md](meeting-control-design.md)):
  - the user is chair and participant;
  - seats speak only when given the floor;
  - blind and in-turn rounds;
  - a single visibility rule;
  - control lives in server code behind one action API; etiquette lives in the prompts
    ([ADR 0005](adr/0005-chair-controlled-meetings.md), [ADR 0006](adr/0006-control-in-code-etiquette-in-prompts.md)).
- **Chat-wrapper research done** ([chat-wrapper-research.md](chat-wrapper-research.md)):
  - build our own instead of forking ([ADR 0003](adr/0003-build-our-own-app.md));
  - a per-seat view of one shared transcript, based on LobeHub's group-chat design
    ([ADR 0004](adr/0004-per-seat-view-of-shared-transcript.md)).
- **llmgw 0.5.0 verified in production** (commit `e36e08c`):
  - models not on the plan report `unavailable` in `/v1/limits`;
  - usage log lines share `req_id` with the request line;
  - provider names in logs match the API;
  - `GET /` returns the version and commit.
  - One correction: `req_id` isn't a Loki label. Query `{namespace="llmgw"} | json | req_id="<id>"`.
- **DeepSeek wired into llmgw:** `deepseek-v4-pro` and `deepseek-flash` work with plain and `deepseek/…` names, normal
  and streaming. `deepseek-v4-flash` is a 404 at the gateway (good: exact names only).
- **llmgw `/v1/limits` checked** for all three paid sources: weekly windows for Claude (Fable models have their own),
  a monthly window for GPT, and a prepaid balance for DeepSeek.
- **GPT models tested:**
  - **working:** `gpt-6-luna`, `gpt-5.6-terra`, `gpt-5.6-luna`;
  - catalog models that aren't on the current plan return 404.
- **llmgw behavior confirmed from its source:**
  - exact model match only, no fallback to other models;
  - the one exception is the image fallback, when a text-only model receives an image.

## 2026-11-01

- **Idea:** one room where Claude, GPT and Gemini answer the same question with the user as chair, instead of
  copy-pasting between web apps. Existing open-source options surveyed; none does chair-controlled meetings well.
- **llmgw found** at `http://llmgw.arch.internal`. All seven Claude 5.x models work, normal and streaming
  (`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5`, `claude-opus-5`,
  `claude-sonnet-5`).
