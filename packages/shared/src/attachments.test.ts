import { describe, expect, it } from "vitest";
import { AttachmentInput, imageTokens, isTextFileName, readsImages } from "./attachments.js";

describe("attachments", () => {
  it("estimates image tokens near what llmgw's providers charged, scaled to 2,048 px", () => {
    // Measured 2026-11-04: 640×360 cost 355 (Claude) and 324 (GPT).
    expect(imageTokens(640, 360)).toBe(368);
    // A 4000×2250 photo is scaled to 2048×1152 first: measured about 3,100 and 2,800.
    expect(imageTokens(4000, 2250)).toBe(imageTokens(2048, 1152));
    expect(imageTokens(2048, 1152)).toBe(3206);
  });

  it("knows which models get a description instead of the image", () => {
    expect(readsImages("claude-haiku-5-5")).toBe(true);
    expect(readsImages("deepseek-flash")).toBe(true);
    expect(readsImages("deepseek-v4-pro")).toBe(false);
    // llmgw 0.6.0's /v1/models says it directly, and that wins over the list.
    expect(readsImages("deepseek-v4-pro", { input: ["text", "image"] })).toBe(true);
    expect(readsImages("claude-haiku-5-5", { input: ["text"] })).toBe(false);
    expect(readsImages("deepseek-v4-pro", { input: null })).toBe(false);
  });

  it("takes text files by extension and refuses SVG images", () => {
    expect(isTextFileName("notes.MD")).toBe(true);
    expect(isTextFileName("app.tsx")).toBe(true);
    expect(isTextFileName("Dockerfile")).toBe(true);
    expect(isTextFileName("photo.heic")).toBe(false);
    expect(
      AttachmentInput.safeParse({
        kind: "image",
        name: "x.svg",
        mime: "image/svg+xml",
        data: "AAA",
      }).success,
    ).toBe(false);
  });
});
