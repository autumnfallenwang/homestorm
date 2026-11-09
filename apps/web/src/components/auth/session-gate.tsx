"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getMe, type Me } from "@/lib/auth-client";
import { sessionRetryDelay } from "@/lib/session-retry";

const MeContext = createContext<{ me: Me; refresh: () => Promise<void> } | null>(null);

/** The signed-in admin, inside a `SessionGate`. */
export function useMe(): Me {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe() used outside a SessionGate");
  return ctx.me;
}

/** Reads the admin again, after Settings → Profile changes their name or email. */
export function useRefreshMe(): () => Promise<void> {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useRefreshMe() used outside a SessionGate");
  return ctx.refresh;
}

/**
 * Renders its children only when signed in; otherwise goes to /sign-in. Routing convenience only: the API enforces
 * the session on every route (ADR 0011).
 *
 * Only a 401 means signed out. When the API doesn't answer at all, as for about 15 seconds while a deploy restarts
 * it, the page waits and asks again instead: it used to send every tab that loaded then to the sign-in page, losing
 * its place, though the login was fine.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = async (attempt: number) => {
      try {
        const result = await getMe();
        if (cancelled) return;
        if (!result) return router.replace("/sign-in");
        setUnreachable(false);
        setMe(result);
      } catch {
        if (cancelled) return;
        setUnreachable(true);
        retry = setTimeout(() => void check(attempt + 1), sessionRetryDelay(attempt));
      }
    };
    void check(0);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [router]);

  const refresh = useCallback(async () => {
    try {
      const result = await getMe();
      if (result) setMe(result);
      else router.replace("/sign-in");
    } catch {
      // The API didn't answer: keep the admin we know.
    }
  }, [router]);
  const value = useMemo(() => (me ? { me, refresh } : null), [me, refresh]);

  if (!value) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
        {unreachable && (
          <p role="status" className="text-sm text-muted-foreground">
            Can't reach homestorm right now. Trying again…
          </p>
        )}
      </div>
    );
  }
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
