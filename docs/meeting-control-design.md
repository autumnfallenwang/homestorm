# Meeting Control Design

How a meeting is run in **homestorm**: the chair's role, the ruleset, what is real code versus what the bots
are told in natural language, and the UI controls. It builds on [chat-wrapper-research.md](chat-wrapper-research.md),
which covers how each bot's view of the meeting is built.

Agreed 2026-11-02. The approved UI mockup (two boards: "Meeting in progress" and "Controls & states") is kept outside
this repo; §5 describes it in full.

---

## 1. The chair

**The user is chairman and participant.**

- In formal rules (Robert's Rules, the UN), the chair stays neutral and doesn't debate. That fits a room of people who
  all want to talk.
- Here the user both convenes the meeting and wants the answer. That's closer to a judge who questions witnesses, or a
  panel moderator who is also the client: they ask, push back, give their own view, and decide who speaks next.
- Bots never interrupt or ask to speak, so most meeting procedure (requesting the floor, time limits, points of order)
  doesn't apply. The chair's power reduces to one thing: **nothing happens unless the chair starts it.**
- **Safeguard:** every bot is told that the chair wants independent views and that disagreeing with the chair is
  welcome. Models tend to go along with the user, which defeats the point of having more minds.

---

## 2. What we borrowed from real meeting rules

| Source | Idea | Use |
|---|---|---|
| Panel moderator | Moderator directs questions, asks follow-ups, summarizes | ✅ The core pattern |
| Court | Questioning one witness directly | ✅ @mention one seat |
| Court | Cross-examination: challenge another's testimony | ✅ Reply to a message |
| Court | Keeping witnesses apart so they don't hear each other | ✅ **Blind rounds** |
| Delphi method | Experts answer separately, then see each other's answers and revise | ✅ Blind round, then an in-turn round |
| UN | Speakers' list, right of reply | ⏳ Later: a bot *suggests* replying, the chair approves |
| Robert's Rules | Motions, seconding, voting, points of order | ❌ Overkill |
| Debate formats | Fixed sides, fixed speaking order | ❌ If wanted, it's just a persona |

**Why blind rounds matter:** when bots answer one after another, later bots tend to anchor on the first answer and agree
with it, so you get one opinion three times. Answering separately first is what actually produces "more minds".

---

## 3. The ruleset

### The one rule

**A seat speaks only when the chair gives it the floor.**
- Bots never trigger each other.
- So there are no runaway bot-to-bot loops, and every question's cost is predictable.

### Chair actions

| Action | What happens |
|---|---|
| **Message** | The chair posts to the room. It goes to whatever the send-to selector says (default *Everyone · blind*). With *No reply*, it's just a comment or context. |
| **@Seat** | Only the mentioned seat(s) answer. |
| **Round: blind** | All active seats answer at the same time, without seeing each other's answers. The default for a new question. |
| **Round: in turn** | Seats answer one after another in seat order, each seeing the answers before it. Good for discussion after a blind round. |
| **Reply to** | The chosen seat(s) respond to one specific earlier message. With 2 or more seats, blind or in turn. An optional note can be added. |
| **Mute / unmute** | A muted seat is skipped in rounds, but still sees the whole meeting and can be asked directly. |
| **Add / remove seat, reorder** | Seat order is the order for in-turn rounds. |
| **Stop / retry** | Stop one seat or all seats. Retry reruns the same seat on the same view, always with the same model. |
| **Wrap up** | One seat the chair picks writes the minutes, a decision with reasons, or the open questions. The chair reads it first, then posts it in the meeting so every seat sees it. |

### The visibility rule (the only one)

**A seat sees every message that was finished before its turn started.**

- **Blind round:** all seats start together, so they can't see each other's answers.
- **In turn:** each seat starts after the previous one finishes, so it sees the earlier answers.
- **After a round:** everyone sees everything for later turns.

No visibility flags are needed. `buildView(meeting, seat)` just filters by "finished before this turn started".

### How seats behave (natural language, in each seat's intro)

- Be concise.
- Refer to others by name.
- Briefly say "I agree with X" instead of repeating X.
- Disagree when you have a reason, including with the chair.
- Never speak for other seats.
- Don't prefix replies with your own name.

### Building blocks

The whole ruleset rests on **messages** and **rounds**. A round records which seats answer, whether blind or in turn,
and which message they're answering.

---

## 4. Real code versus natural language

Actions are **real code**: the server decides who speaks and what each seat gets to see. The bots never decide it.

| Layer | Who handles it | What it does |
|---|---|---|
| **Control** (hard rules) | Our server | Which seats are called, blind or in turn, who sees what, mute, stop, retry. Fully predictable. |
| **Content** (soft rules) | The bot, in natural language | The intro (identity, roster, etiquette) plus one short note at the end of its view, saying what it's being asked to do now. |

**Why control can't be natural language:**
- **A model always answers when called.** "Only speak when given the floor" can't stop it; the only way to keep a seat
  quiet is not to call it.
- **Blind only works if we hide the answers.** "Don't look at Claude's answer" doesn't work. We don't send it.
- **Cost and loops:** if bots could trigger each other, the cost of a question would be unpredictable.

**What each action looks like in both layers:**

| Action | What the code does | What the seat is told (the note at the end of its view) |
|---|---|---|
| @Seat | Calls that seat | "The chair asks you." |
| Round: blind | Calls all active seats at once | "Everyone answers this independently." |
| Round: in turn | Calls seats one at a time | "You are 2nd of 3. Consider the answers above." |
| Reply to | Calls the chosen seat(s) and marks the target message | "Respond to GPT-6 Luna's message: '…'" |
| Mute | Leaves the seat out of rounds | Nothing |
| Stop / retry | Cancels the request / reruns the same seat | Nothing |
| Wrap up | Calls the chosen seat with a summary task | "Write the meeting minutes." |

The etiquette rules are the only rules that live in natural language. If a bot breaks one, the meeting doesn't break.

---

## 5. UI controls

**One action API on the server, several ways to trigger it in the UI.**
- Every control produces the same structured request, e.g.
  `{text, targets, mode: "blind" | "in_turn" | "none", replyTo, note}`.
- The server never scans the chair's text for commands.

### Layout (see the mockup's board 1)

A modern three-pane chat app in the shadcn style used by the other home apps:

- **Left: meetings list.** App name, New meeting, search, meetings grouped by day (live / minutes written), the chair's
  profile.
- **Middle: the meeting.**
  - **Header:** title, status ("Round 2 in progress"), token count and DeepSeek spend, Export, Wrap up ▾.
  - **Meeting brief** (added 2026-11-04, [ADR 0015](adr/0015-meeting-brief-and-full-context-policy.md)): a card
    pinned above the transcript with the standing context every seat always sees, and Edit. Empty, it's a dashed
    "Add a meeting brief" prompt. Each change shows in the transcript as "You updated the meeting brief · show this
    version". Posted wrap-ups get "Copy into the brief".
  - **Chair messages on the right**, in a bubble. Under each is a line saying where it went ("Sent to everyone · blind",
    "Asked GPT-6 Luna to respond").
  - **Seat messages on the left:** avatar, name, a source tag ("Claude · subscription", "GPT · ChatGPT",
    "DeepSeek · prepaid"), time, Markdown body, and a monospace meta line
    (`model-id · tokens · seconds · $cost` for DeepSeek).
  - **Rounds are grouped in a box:** "Round 1 · Blind · each seat answered without seeing the others · 3 of 3
    answered" / "Round 2 · In turn · 1 of 2".
  - **The seat answering now** shows "Answering…", a streaming cursor and its own Stop button. The next seat shows
    "Next", with a placeholder.
  - **Event lines** in the transcript, e.g. "You muted Claude Sonnet 5.5 for rounds".
  - **Reply-to messages** quote the target message at the top of the chair's bubble, and the reply shows
    "replying to Claude Opus 5.5".
  - **Message box:** the send-to selector (**Everyone · blind ▾**, with a hint like "3 active seats will answer · type @ to
    pick seats instead"), a text area, a status line, Stop all and Send. Under it: "Seats speak only when you give them
    the floor."
- **Right: seats panel** (always visible).
  - A seat card per seat: avatar, name, model ID, status, allowance line + bar from `/v1/limits` (e.g. "NN% left this week ·
    resets <date>", "NN% left this month · resets <date>", "$X.XX left"), and Ask / Mute / ⋯.
  - Muted seats get a dashed card: "Skipped in rounds. Still hears everything."
  - Add seat at the top.
  - A **Room rules** box: answer length (Concise), plus two that are always on: seats speak only when called, and
    seats may disagree with the chair. Blind or in turn is picked per message in the message box, which starts on
    Everyone · blind; the room rule for "new questions go to" was removed on 2026-11-03 because it duplicated it.

### Controls and states (see the mockup's board 2)

1. **Send-to menu.** Everyone · blind (default, checked), Everyone · in turn, Choose seats… (same as typing @), and
   No reply (just a note).
2. **@mention.**
   - Typing `@` opens a list of the meeting's seats with model ID and allowance; arrow keys and Enter pick, Esc closes.
   - Muted seats can still be called.
   - Picking inserts a tag and switches the send-to to that seat. The tag is the target; quoted "@Claude" text never
     calls anyone.
3. **Reply-to picker** (from a message's hover bar).
   - "Who should respond?" checkboxes; the message's author isn't listed.
   - Blind / In turn when 2 or more seats are picked.
   - An optional note, then Cancel / "Ask 2 seats".
4. **Add a seat.**
   - Search, then models grouped by source with each source's allowance (Claude subscription, ChatGPT subscription,
     DeepSeek prepaid).
   - "In this meeting" for seats already added; models not on the plan crossed out ("Not on your plan").
   - Display name, optional persona, then Add seat.
5. **Seat menu (⋯).** Ask now, Mute in rounds, Edit name and persona, Move up / down in seat order, and Remove from
   meeting (in red).
6. **Seat states.** Always labeled in words, not only by color: Answering, Next, Idle, Muted, Rate limited,
   Out of allowance. Rate limited and out-of-allowance seats can't take the floor until reset; the card shows when.
7. **Wrap up dialog.** Pick who writes it, then Minutes (the question, each seat's position, where they agreed and
   disagreed) / Decision and reasons / Open questions, then Write minutes. The wrap-up is held back for the chair
   to read ("not posted"), with **Post to the meeting** under it; "Post it right away" in the dialog skips that
   review. (Changed 2026-11-03: the live test's decision got several who-said-what details wrong.)
8. **Problems stay visible** in place, never as a quiet switch to another model:
   - Rate limited (429), with Retry / Skip this turn.
   - Stopped by you, with Keep partial / Retry.
   - Out of allowance, with Mute until reset.

### Visual decisions

- **Style:** the neutral shadcn look with the Geist / Geist Mono fonts, a blue accent that can be changed, and dark
  primary buttons.
- **Source colors:** each source has its own avatar color (Claude orange, GPT teal, DeepSeek blue). They're always
  paired with a text label.
- **Layout:** chair on the right, seats on the left, like most chat apps; the seats panel is always visible.
- **Accessibility:** real buttons and inputs with labels, `aria-label` on icon-only buttons, and contrast at 4.5:1
  or better.

---

## 6. Later, not now

- **Slash commands** (`/blind`, `/turn`, `/mute claude`, `/minutes`): shortcuts that map to the same action API.
- **Seats asking for the floor:** "I'd like to respond to Claude" shows a one-click give-floor button; the chair still
  decides.
- **Auto-discussion:** seats take turns for N rounds without the chair, with a hard cap.
- **Private questions** to one seat, hidden from the others. This adds a second visibility rule.
- **Poll:** each seat gives a position plus confidence.
- **Council mode:** seats review each other's answers anonymously, then one summarizes (llm-council style).

---

## 7. Next: the data model

- **meeting:** title, room rule (answer length), status.
- **seat:** model ID, `owned_by`, display name, persona, order, muted.
- **message:** author (chair or a seat), content, round, reply-to, status (streaming / done / stopped / error),
  usage, cost, llmgw `req_id`, start and finish times (the visibility rule depends on them).
- **round:** mode (blind / in turn / single), the message being answered, which seats, status.
