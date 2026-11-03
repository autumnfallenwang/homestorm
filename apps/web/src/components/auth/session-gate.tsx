"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { getMe, type Me } from "@/lib/auth-client";

const MeContext = createContext<Me | null>(null);

/** The signed-in admin, inside a `SessionGate`. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe() used outside a SessionGate");
  return me;
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

  if (!me) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}
