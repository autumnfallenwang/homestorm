"use client";

import { useEffect } from "react";
import { APPEARANCE_EVENT, applyAppearance, readAppearance } from "@/lib/appearance";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Keeps <html> in step with this browser's appearance settings (ADR 0018). The inline script in the root layout
 * applies them before the first paint; this follows changes after: from Settings → Appearance, from another tab, and
 * the system's light/dark switch while the mode is System. Renders nothing.
 */
export function ThemeProvider() {
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const sync = () => applyAppearance(readAppearance(), media.matches);
    sync();
    media.addEventListener("change", sync);
    window.addEventListener(APPEARANCE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener(APPEARANCE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return null;
}
