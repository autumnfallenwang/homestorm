# 0007: A three-pane meeting UI

- **Status:** accepted
- **Date:** 2026-11-02

## Context

The chair needs to see the meeting, every seat's state and allowance, and the controls, without hunting for them. The
user reviewed and approved a mockup ("looking perfect"). The mockup itself is kept outside the repo;
[meeting-control-design.md](../meeting-control-design.md) §5 describes it in full.

## Decision

- **Left: meetings list.** New meeting, search, meetings grouped by day.
- **Middle: the meeting.**
  - **Header:** title, status, tokens and DeepSeek spend, Export, Wrap up.
  - **Chair messages on the right**, with a line saying where each went.
  - **Seat messages on the left:** avatar, name, source tag, Markdown body, and a meta line with model, tokens, time,
    and cost for DeepSeek.
  - **Rounds are grouped in a labeled box:** Round N, Blind or In turn, and progress.
  - **Hover bar on messages:** Reply to…, Retry, Copy.
  - **Message box:** the send-to selector (default *Everyone · blind*), @mentions, Stop all and Send.
- **Right: seats panel**, always visible.
  - One card per seat: model, source, status, allowance bar, and Ask / Mute / ⋯.
  - A Room rules box at the bottom.
- **Dialogs and menus:** send-to menu, @mention list, reply-to picker, add seat (grouped by source, with "Not on your
  plan"), seat menu, wrap up.
- **Problems stay visible in place:** rate limited, stopped, out of allowance.
- **Look:**
  - the neutral shadcn style with the Geist fonts;
  - avatar colors per source (Claude orange, GPT teal, DeepSeek blue), always paired with a text label;
  - states written in words, not only shown by color.

## Alternatives considered

- **Slack-style layout with everyone on the left.** Rejected in favor of the common chat-app pattern (you on the right).
- **A collapsible seats panel.** Deferred: always visible for now.
- **Slash commands as the main input.** Rejected: you can't discover them by looking. They may come later as
  shortcuts.

## Consequences

- The web app is built from shadcn components to match the mockup.
- Seat cards poll or receive `/v1/limits` data; the API exposes it per seat.
- The mockup's sample content and numbers are illustrative; real ones come from llmgw.
