# 0018: Settings, with Profile and Appearance

- **Status:** accepted, built 2026-11-08
- **Date:** 2026-11-08

## Context

- **The chair's own settings had nowhere to live.** Change password was a dialog in the profile menu at the bottom of
  the meetings list, and the name and email set at first run couldn't be changed at all.
- **No way to pick a look.** homestorm had dark colors in its CSS from the shadcn starter, but nothing to turn them on.
- **homework already solves both.** It has a Settings area with its own sidebar (Back, then one row per tab). Its
  Account tab has name, email and password, and its Appearance tab has a palette, light or dark, and a size. Its
  ADR 0013 found that scaling the root font size works where CSS `zoom` broke menus.

## Decision

**A Settings area at `/settings`, after homework's.** It has its own sidebar in place of the meetings list: Back to
meetings, then Profile and Appearance. On phones the sidebar is a rail of icons. You reach it from the profile menu,
which now holds Settings and Sign out, and which the folded meetings rail shows too.

**Profile:**

- **Profile section:** name and email, saved with `PATCH /api/me`. The email is the sign-in, kept lower case as
  Better Auth does. The session stays, and the new email applies at the next sign-in.
- **Password section:** current, new and confirm. It works as the old dialog did: Better Auth's `change-password`
  signs out other devices. The dialog and its menu item are gone.

**Appearance**, stored per browser in `localStorage`, as in homework, since it's how one screen should look:

- **Palette:** Default (homestorm's neutral grays and blue accent), plus homework's Solarized, Nord, Dracula and High
  contrast. Each has light and dark versions. A palette is a `.theme-<name>` class on `<html>`. Its accent (`--brand`:
  links, the chair's messages, focus) is the palette's primary color. The source colors stay the same in every
  palette, so Claude, GPT and DeepSeek look the same everywhere.
- **Mode:** Light, Dark or System, which follows the device and switches with it. System is the default.
- **Size:** Normal, Large or Larger (100, 115, 130%), or a percentage from 75 to 150. It scales the root font size,
  so everything in rem follows. The range is narrower than homework's 50–200 because three panes stop fitting.
- **No flash:** a small inline script in `<head>` applies these before the first paint, so a dark page never starts
  out white. `ThemeProvider` follows later changes: from this tab, from other tabs, and from the device.
- **Code blocks** get GitHub Dark's colors in dark mode.

## Alternatives considered

- **Keep Change password in the menu, and add Appearance there.** Rejected: the user asked for a Settings area, and
  a page has room for the name and email too.
- **Appearance saved on the server**, so every device matches. Rejected, as in homework: a phone and a desktop often
  want different sizes, and one admin gains little from syncing.
- **CSS `zoom` for size.** Rejected for the reason homework found: Radix menus are placed from screen coordinates, and
  zoom misplaces them.
- **Light as the default mode**, to keep the look unchanged on deploy. Rejected: System is what homework and most apps
  do. A dark device now opens homestorm in dark, which was checked page by page.

## Consequences

- Each browser keeps its own look. A new browser starts on Default and System.
- New colors must come from the tokens (`bg-card`, `text-muted-foreground`, `bg-brand`…), not fixed ones, or they
  break in dark mode or in a palette.
- The admin can change their sign-in email without proving they own the new address. One admin on a home network
  makes that acceptable, and `reset-password` still works by email.
