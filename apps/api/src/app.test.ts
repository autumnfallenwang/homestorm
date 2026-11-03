import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { isPublic } from "./middleware/auth.js";
import { asAdmin, asNobody } from "./test/sessions.js";

describe("app", () => {
  it("answers /health without a session", async () => {
    const res = await createApp({ resolveSession: asNobody }).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("refuses /api/* without a session", async () => {
    const res = await createApp({ resolveSession: asNobody }).request("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns the signed-in admin", async () => {
    const res = await createApp({ resolveSession: asAdmin }).request("/api/me");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { email: string } }).user.email).toBe(
      "chair@example.com",
    );
  });

  it("echoes a sane X-Request-Id and replaces a junk one", async () => {
    const app = createApp({ resolveSession: asNobody });
    const ok = await app.request("/health", { headers: { "X-Request-Id": "abc-123" } });
    expect(ok.headers.get("x-request-id")).toBe("abc-123");
    const junk = await app.request("/health", {
      headers: { "X-Request-Id": "not ok; drop table" },
    });
    expect(junk.headers.get("x-request-id")).not.toBe("not ok; drop table");
  });
});

describe("isPublic", () => {
  it("opens only health, Better Auth and /api/public", () => {
    expect(isPublic("/health")).toBe(true);
    expect(isPublic("/api/auth/sign-in/email")).toBe(true);
    expect(isPublic("/api/public/setup-state")).toBe(true);
    expect(isPublic("/api/meetings")).toBe(false);
    expect(isPublic("/api/meetings/x/events")).toBe(false);
    expect(isPublic("/api/me")).toBe(false);
  });
});
