// Sign-in, first-run sign-up and the session (ADR 0011), against Better Auth's routes on the API.
// Plain HTTP on the LAN, accepted as in the sibling apps: the password never appears in a URL or a log line.

import type { UpdateMeInput } from "@homestorm/shared";
import { ApiError, apiBaseUrl } from "./api";

export interface Me {
  user: { id: string; name: string; email: string };
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: init?.method ?? "GET",
    // Better Auth refuses a POST without a JSON content type (415), so even sign-out sends `{}`.
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "include",
    cache: "no-store",
  });
  const parsed = (await res.json().catch(() => null)) as
    | (T & { message?: string; error?: string })
    | null;
  if (!res.ok)
    throw new ApiError(
      res.status,
      parsed?.message ?? parsed?.error ?? `Request failed (${res.status})`,
    );
  return parsed as T;
}

export function signIn(email: string, password: string): Promise<unknown> {
  return call("/api/auth/sign-in/email", {
    method: "POST",
    body: { email: email.trim(), password },
  });
}

/** Only the first account can sign up, and it's the admin; after that the API refuses (403). */
export function signUpAdmin(name: string, email: string, password: string): Promise<unknown> {
  return call("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: name.trim(), email: email.trim(), password },
  });
}

export function signOut(): Promise<unknown> {
  return call("/api/auth/sign-out", { method: "POST", body: {} });
}

export function changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
  return call("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword, revokeOtherSessions: true },
  });
}

/** Settings → Profile: change the admin's name or sign-in email (ADR 0018). */
export function updateMe(patch: UpdateMeInput): Promise<Me> {
  return call("/api/me", { method: "PATCH", body: patch });
}

/** Who is signed in, or null. */
export async function getMe(): Promise<Me | null> {
  try {
    return await call<Me>("/api/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function getSetupState(): Promise<{ needsAdmin: boolean }> {
  return call("/api/public/setup-state");
}
