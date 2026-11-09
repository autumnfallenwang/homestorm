import { describe, expect, it } from "vitest";
import { backPath } from "./back-to-meetings";

describe("Settings' Back link", () => {
  it("returns to the meeting this tab came from, or the home page", () => {
    expect(backPath("/m/bc416963-c957-4e03-b474-42b9767d1a68")).toBe(
      "/m/bc416963-c957-4e03-b474-42b9767d1a68",
    );
    expect(backPath("/")).toBe("/");
    expect(backPath(null)).toBe("/");
  });

  it("goes nowhere but a meetings page", () => {
    for (const saved of [
      "https://evil.example/",
      "//evil.example",
      "/settings/profile",
      "/m/x",
      "/m/1/../..",
    ]) {
      expect(backPath(saved)).toBe("/");
    }
  });
});
