# 0007: A three-pane meeting UI

- **Status:** accepted
- **Date:** 2026-11-02, updated 2026-11-07 (the brief in the header, folding side panels, a menu on each meeting)

## Context

The chair needs to see the meeting, every seat's state and allowance, and the controls, without hunting for them. The
user reviewed and approved a mockup ("looking perfect"). The mockup itself is kept outside the repo;
[meeting-control-design.md](../meeting-control-design.md) §5 describes it in full.

## Decision

- **Left: meetings list.** New meeting, search, meetings grouped by day. Each meeting has a ⋯ menu with **Delete
  meeting…**, which asks again inside the menu ("Yes, delete it" / Cancel) instead of opening a dialog.
- **Middle: the meeting.**
  - **Header:** title, status, tokens and DeepSeek spend, Brief, Export, Wrap up. **Brief** shows the meeting brief
    pinned under the header, where it stays while the transcript scrolls (it used to be a card at the top of the
    transcript, which scrolled away). With no brief it reads **Add brief** and opens the editor.
  - **Chair messages on the right**, with a line saying where each went.
  - **Seat messages on the left:** avatar, name, source tag, Markdown body, and a meta line with model, tokens, time,
    and cost for DeepSeek.
  - **Rounds are grouped in a labeled box:** Round N, Blind or In turn, and progress.
  - **Hover bar on messages:** Reply to…, Retry, Copy.
  - **Message box:** the send-to selector (default *Everyone · blind*), @mentions, Stop all and Send.
- **Right: seats panel.**
  - One card per seat: model, source, status, allowance bar, and Ask / Mute / ⋯.
  - A Room rules box at the bottom: answer length, and the two fixed rules. (It also had "New questions go to"
    until 2026-11-03; that duplicated the message box's selector, so it was removed.)
- **Both side panels fold** (since 2026-11-07) into a narrow rail on wide screens: the meetings rail keeps Show and New
  meeting; the seats rail keeps Show, Add seat and each seat's avatar with its status. The browser remembers each
  choice. On phones, where the panels open over the meeting, the same button closes them.
- **Dialogs and menus:** send-to menu, @mention list, reply-to picker, add seat (grouped by source, with "Not on your
  plan"), seat menu, wrap up.
- **Problems stay visible in place:** rate limited, stopped, out of allowance.
- **Look:**
  - the neutral shadcn style with the Geist fonts;
  - avatar colors per source (Claude orange, GPT teal, DeepSeek blue), always paired with a text label;
  - states written in words, not only shown by color.

## Alternatives considered

- **Slack-style layout with everyone on the left.** Rejected in favor of the common chat-app pattern (you on the right).
- **A collapsible seats panel.** Deferred at first; built on 2026-11-07, for both side panels, at the user's request.
- **Slash commands as the main input.** Rejected: you can't discover them by looking. They may come later as
  shortcuts.

## Consequences

- The web app is built from shadcn components to match the mockup.
- Seat cards poll or receive `/v1/limits` data; the API exposes it per seat.
- The mockup's sample content and numbers are illustrative; real ones come from llmgw.
