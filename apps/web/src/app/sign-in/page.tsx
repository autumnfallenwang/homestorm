"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMe, getSetupState, signIn, signUpAdmin } from "@/lib/auth-client";

/** Sign in, or on first run create the one admin login (ADR 0011). */
export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"loading" | "sign-in" | "setup">("loading");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        if (await getMe()) return router.replace("/");
        const { needsAdmin } = await getSetupState();
        setMode(needsAdmin ? "setup" : "sign-in");
      } catch {
        setError("Can't reach the homestorm API.");
        setMode("sign-in");
      }
    })();
  }, [router]);

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "setup") {
        if (password.length < 8) throw new Error("Use at least 8 characters for the password.");
        await signUpAdmin(name || "Chair", email, password);
      } else {
        await signIn(email, password);
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <main className="flex h-full items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="size-10" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {mode === "setup" ? "Set up Homestorm" : "Sign in to Homestorm"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "setup"
                ? "Create the admin login. You're the chair of every meeting."
                : "Brainstorm with several AI models at once."}
            </p>
          </div>
        </div>
        {mode === "loading" ? (
          <div className="flex justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5 shadow-xs">
            {mode === "setup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Chair"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "setup" ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {mode === "setup" ? "Create admin and start" : "Sign in"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
