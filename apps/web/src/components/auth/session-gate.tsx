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
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMe()
      .then((result) => {
        if (cancelled) return;
        if (!result) router.replace("/sign-in");
        else setMe(result);
      })
      .catch(() => {
        if (!cancelled) router.replace("/sign-in");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const refresh = useCallback(async () => {
    const result = await getMe();
    if (result) setMe(result);
    else router.replace("/sign-in");
  }, [router]);
  const value = useMemo(() => (me ? { me, refresh } : null), [me, refresh]);

  if (!value) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
