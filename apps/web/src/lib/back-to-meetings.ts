"use client";

// Where Settings' "Back to meetings" goes: the meetings page this tab last showed, so it returns to the meeting you
// came from instead of the home page. Per tab (sessionStorage): another tab's meeting isn't where you came from.

import { useEffect, useState } from "react";

const KEY = "homestorm.back-to";
/** Only the home page or a meeting: a stored value can never send the link anywhere else. */
const MEETINGS_PAGE = /^\/(m\/[0-9a-f-]{36})?$/;

/** The path to go back to, from what was stored; "/" for nothing, or anything that isn't a meetings page. */
export function backPath(saved: string | null): string {
  return saved && MEETINGS_PAGE.test(saved) ? saved : "/";
}

/** Called by the meetings layout on each page it shows. */
export function rememberMeetingsPage(path: string): void {
  if (!MEETINGS_PAGE.test(path)) return;
  try {
    window.sessionStorage.setItem(KEY, path);
  } catch {
    // Blocked storage: Back goes to the home page, as it did before.
  }
}

/** Settings' Back link. "/" on the first render, so the server's HTML and the client's agree. */
export function useBackToMeetings(): string {
  const [path, setPath] = useState("/");
  useEffect(() => {
    try {
      setPath(backPath(window.sessionStorage.getItem(KEY)));
    } catch {}
  }, []);
  return path;
}
