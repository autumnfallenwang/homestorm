"use client";

import type { MeetingSummary } from "@homestorm/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface MeetingsCtx {
  meetings: MeetingSummary[] | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<MeetingsCtx | null>(null);

/** The meetings list, shared by the sidebar and the meeting page (which refreshes it when a round ends). */
export function MeetingsProvider({ children }: { children: ReactNode }) {
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null);
  const refresh = useCallback(async () => {
    try {
      setMeetings(await api.listMeetings());
    } catch {
      setMeetings((m) => m ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  return <Ctx.Provider value={{ meetings, refresh }}>{children}</Ctx.Provider>;
}

export function useMeetings(): MeetingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMeetings() used outside MeetingsProvider");
  return ctx;
}
