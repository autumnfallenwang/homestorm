// The real login flow against Postgres (ADR 0011): first sign-up is the admin, then sign-up closes.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { closeDb } from "./db/index.js";
import { hasTestDb, truncateAll } from "./test/db.js";

/** A tiny cookie-keeping client over app.request. */
function browser(app: ReturnType<typeof createApp>) {
  let cookie = "";
  return async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await app.request(path, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        origin: "http://localhost:3000",
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
    return res;
  };
}

describe.skipIf(!hasTestDb)("login (integration)", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  it("creates the admin on first sign-up, then closes sign-up", async () => {
    const app = createApp({ rateLimit: false });
    const b = browser(app);

    expect(await (await b("/api/public/setup-state")).json()).toEqual({ needsAdmin: true });
    expect((await b("/api/me")).status).toBe(401);

    const signUp = await b("/api/auth/sign-up/email", {
      method: "POST",
      body: { name: "Chair", email: "chair@example.com", password: "correct horse battery" },
    });
    expect(signUp.status).toBe(200);

    const me = await b("/api/me");
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe("chair@example.com");
    expect(await (await b("/api/public/setup-state")).json()).toEqual({ needsAdmin: false });

    const second = await browser(app)("/api/auth/sign-up/email", {
      method: "POST",
      body: { name: "Intruder", email: "x@example.com", password: "correct horse battery" },
    });
    expect(second.status).toBe(403);
  });

  it("signs in with the password and out again", async () => {
    const app = createApp({ rateLimit: false });
    await browser(app)("/api/auth/sign-up/email", {
      method: "POST",
      body: { name: "Chair", email: "chair@example.com", password: "correct horse battery" },
    });

    const b = browser(app);
    const wrong = await b("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: "chair@example.com", password: "wrong password!" },
    });
    expect(wrong.status).toBe(401);

    const ok = await b("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: "chair@example.com", password: "correct horse battery" },
    });
    expect(ok.status).toBe(200);
    expect((await b("/api/me")).status).toBe(200);

    expect((await b("/api/auth/sign-out", { method: "POST", body: {} })).status).toBe(200);
    expect((await b("/api/me")).status).toBe(401);
  });

  it("changes the password: the old one stops working, the new one signs in", async () => {
    const app = createApp({ rateLimit: false });
    const b = browser(app);
    await b("/api/auth/sign-up/email", {
      method: "POST",
      body: { name: "Chair", email: "chair@example.com", password: "correct horse battery" },
    });
    const changed = await b("/api/auth/change-password", {
      method: "POST",
      body: {
        currentPassword: "correct horse battery",
        newPassword: "staple battery horse",
        revokeOtherSessions: true,
      },
    });
    expect(changed.status).toBe(200);
    expect((await b("/api/me")).status).toBe(200);

    const signIn = (password: string) =>
      browser(app)("/api/auth/sign-in/email", {
        method: "POST",
        body: { email: "chair@example.com", password },
      });
    expect((await signIn("correct horse battery")).status).toBe(401);
    expect((await signIn("staple battery horse")).status).toBe(200);
  });

  it("changes the admin's name and sign-in email from Settings → Profile (ADR 0018)", async () => {
    const app = createApp({ rateLimit: false });
    const b = browser(app);
    await b("/api/auth/sign-up/email", {
      method: "POST",
      body: { name: "Chair", email: "chair@example.com", password: "correct horse battery" },
    });

    const patch = (body: unknown) => b("/api/me", { method: "PATCH", body });
    expect((await patch({})).status).toBe(400);
    expect((await patch({ name: "  " })).status).toBe(400);
    expect((await patch({ email: "not an email" })).status).toBe(400);

    const changed = await patch({ name: " Aaron ", email: " Aaron@Example.com " });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { user: unknown }).user).toMatchObject({
      name: "Aaron",
      email: "aaron@example.com",
    });
    // This session carries on, and sees the change.
    const me = (await (await b("/api/me")).json()) as { user: { name: string; email: string } };
    expect(me.user).toMatchObject({ name: "Aaron", email: "aaron@example.com" });

    const signIn = (email: string) =>
      browser(app)("/api/auth/sign-in/email", {
        method: "POST",
        body: { email, password: "correct horse battery" },
      });
    expect((await signIn("chair@example.com")).status).toBe(401);
    expect((await signIn("aaron@example.com")).status).toBe(200);

    expect((await browser(app)("/api/me", { method: "PATCH", body: { name: "X" } })).status).toBe(
      401,
    );
  });
});
