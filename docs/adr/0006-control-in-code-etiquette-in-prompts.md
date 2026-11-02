# 0006: Floor control is server code; only etiquette is natural language

- **Status:** accepted
- **Date:** 2026-11-02

## Context

The chair actions in [0005](0005-chair-controlled-meetings.md) could be enforced by code, or asked of the models in
natural language ("only speak when given the floor"). Details are in
[meeting-control-design.md](../meeting-control-design.md) §4–5.

## Decision

- **Control layer (server code):** which seats are called, blind or in turn, who sees what, mute, stop and retry. It
  is predictable and never depends on a model behaving.
- **Content layer (natural language):** each seat's intro (identity, roster, etiquette) and one short floor note at the
  end of its view, saying what it's being asked to do now.
- **One action API:** every UI control (send-to selector, @mention, reply-to picker, seat buttons, stop, wrap up)
  produces the same structured request, e.g. `{text, targets, mode: "blind" | "in_turn" | "none", replyTo, note}`.
- **@mentions are picked from a list** and become structured targets. The server never scans the chair's text for
  commands.

## Alternatives considered

- **Rules as prompts only.** Rejected:
  - a model always answers when called, so it can't be told to stay quiet;
  - blind rounds only work if the other answers aren't sent;
  - bots triggering each other makes cost unpredictable.
- **Parsing commands out of free text** (e.g. "@Claude" anywhere, or "let's hear from everyone"). Rejected as
  ambiguous. Slash commands may come later as shortcuts that map to the same action API.

## Consequences

- If a bot breaks an etiquette rule, the meeting doesn't break.
- The action API is the one place to test meeting behavior.
- Slash commands and other input methods can be added later without touching the engine.
