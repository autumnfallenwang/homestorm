"use client";

import type { Limits, MeetingEvent } from "@homestorm/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { applyEvent, emptyLive, type LiveState } from "@/lib/meeting-state";

export type Connection = "connecting" | "live" | "reconnecting" | "not-found";

/**
 * Follow one meeting's live stream (ADR 0010). The first event is a snapshot; after that, small changes. A text
 * chunk beyond what we have means something was missed: reopen the stream for a fresh snapshot.
 */
export function useMeeting(id: string) {
  const router = useRouter();
  const liveRef = useRef<LiveState>(emptyLive);
  const [live, setLive] = useState<LiveState>(emptyLive);
  const [connection, setConnection] = useState<Connection>("connecting");

  useEffect(() => {
    liveRef.current = emptyLive;
    setLive(emptyLive);
    setConnection("connecting");
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const open = () => {
      if (disposed) return;
      es?.close();
      es = new EventSource(api.eventsUrl(id), { withCredentials: true });
      es.onmessage = (e) => {
        const event = JSON.parse(e.data) as MeetingEvent;
        const result = applyEvent(liveRef.current, event);
        liveRef.current = result.live;
        setLive(result.live);
        if (event.type === "snapshot") setConnection("live");
        if (result.gap) open();
      };
      es.onerror = () => {
        if (disposed || !es) return;
        if (es.readyState !== EventSource.CLOSED) {
          setConnection("reconnecting"); // the browser retries by itself
          return;
        }
        // Closed for good: find out why (signed out? deleted?) before trying again.
        setConnection("reconnecting");
        api.getMeeting(id).then(
          () => {
            retry = setTimeout(open, 1_500);
          },
          (err) => {
            if (err instanceof ApiError && err.status === 401) router.replace("/sign-in");
            else if (err instanceof ApiError && err.status === 404) setConnection("not-found");
            else retry = setTimeout(open, 3_000);
          },
        );
      };
    };
    open();
    return () => {
      disposed = true;
      clearTimeout(retry);
      es?.close();
    };
  }, [id, router]);

  return { live, connection };
}

/** Allowance per seat from llmgw (cached about a minute there): on load, every minute, and after each round. */
export function useLimits(id: string, refreshKey: string) {
  const [limits, setLimits] = useState<Record<string, Limits | null>>({});
  const load = useCallback(async () => {
    try {
      setLimits(await api.limits(id));
    } catch {
      // keep the last known values
    }
  }, [id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the trigger
  useEffect(() => {
    void load();
  }, [refreshKey, load]);

  return limits;
}
