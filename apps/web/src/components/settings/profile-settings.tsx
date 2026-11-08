"use client";

import { Check, Loader2 } from "lucide-react";
import { type SyntheticEvent, useState } from "react";
import { useMe, useRefreshMe } from "@/components/auth/session-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { changePassword, updateMe } from "@/lib/auth-client";
import { SettingsSection } from "./section";

/** Settings → Profile (ADR 0018): the admin's name and sign-in email, and the password. Moved here from the menu. */
export function ProfileSettings() {
  return (
    <div className="space-y-6">
      <SettingsSection
        title="Name and email"
        description="Your name is shown in the app. You sign in with the email."
      >
        <ProfileForm />
      </SettingsSection>
      <SettingsSection
        title="Password"
        description="Changing it signs you out on every other device. This one stays signed in."
      >
        <PasswordForm />
      </SettingsSection>
    </div>
  );
}

function ProfileForm() {
  const me = useMe();
  const refreshMe = useRefreshMe();
  const [name, setName] = useState(me.user.name);
  const [email, setEmail] = useState(me.user.email);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const patch = {
    ...(name.trim() !== me.user.name ? { name: name.trim() } : {}),
    ...(email.trim().toLowerCase() !== me.user.email ? { email: email.trim() } : {}),
  };
  const dirty = Object.keys(patch).length > 0;

  function edited() {
    setState("idle");
    setError(null);
  }

  async function save(e: SyntheticEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (!name.trim()) return setError("Enter a name.");
    setState("saving");
    setError(null);
    try {
      await updateMe(patch);
      await refreshMe();
      setState("saved");
    } catch (err) {
      setState("idle");
      setError(
        err instanceof ApiError && err.status === 400
          ? "Check the name and the email address."
          : err instanceof Error
            ? err.message
            : "Couldn't save. Try again.",
      );
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="profile-name">Name</Label>
        <Input
          id="profile-name"
          autoComplete="name"
          maxLength={80}
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            edited();
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="profile-email">Email</Label>
        <Input
          id="profile-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            edited();
          }}
        />
        <p className="text-xs text-muted-foreground">
          You sign in with it. A change applies from the next sign-in.
        </p>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Role</span>
        <span className="font-medium">Chair · the one admin login</span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!dirty || state === "saving"}>
          {state === "saving" && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
        {state === "saved" && (
          <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5 text-ok" /> Saved
          </span>
        )}
      </div>
    </form>
  );
}

function PasswordForm() {
  const me = useMe();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setDone(false);
    if (next.length < 8) return setError("Use at least 8 characters for the new password.");
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && (err.status === 400 || err.status === 401)
          ? "That current password isn't right."
          : "Couldn't change the password. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    auto: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete={auto}
        required
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setDone(false);
          setError(null);
        }}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Lets password managers tie the new password to this login. */}
      <input type="hidden" autoComplete="username" value={me.user.email} readOnly />
      {field("password-current", "Current password", current, setCurrent, "current-password")}
      {field("password-new", "New password", next, setNext, "new-password")}
      {field("password-confirm", "Confirm new password", confirm, setConfirm, "new-password")}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Change password
        </Button>
        {done && (
          <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5 text-ok" /> Password changed
          </span>
        )}
      </div>
    </form>
  );
}
