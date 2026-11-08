"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * An on/off setting this browser remembers, such as a folded panel. Storage can be blocked or empty (a private
 * window, cleared site data), so it starts from `initial` and only ever adds convenience.
 */
export function useStoredFlag(key: string, initial = false): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(initial);

  // Read after mount, so the server's render and the first client render agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved !== null) setValue(saved === "1");
    } catch {}
  }, [key]);

  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {}
    },
    [key],
  );

  return [value, set];
}
