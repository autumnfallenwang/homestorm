import { describe, expect, it } from "vitest";
import { canTakeFloor, SendActionInput } from "./domain.js";
import { ordinal, prettyModelName, sourceLabel } from "./names.js";

describe("prettyModelName", () => {
  it.each([
    ["claude-opus-5-5", "Claude Opus 5.5"],
    ["claude-fable-5-1", "Claude Fable 5.1"],
    ["claude-sonnet-5", "Claude Sonnet 5"],
    ["claude-haiku-4-5-20251001", "Claude Haiku 4.5"],
    ["gpt-6-luna", "GPT-6 Luna"],
    ["gpt-5.6-terra", "GPT-5.6 Terra"],
    ["gpt-6.1-sol", "GPT-6.1 Sol"],
    ["deepseek-v4-pro", "DeepSeek V4 Pro"],
    ["deepseek-flash", "DeepSeek Flash"],
    ["deepseek/deepseek-flash", "DeepSeek Flash"],
  ])("%s → %s", (id, name) => {
    expect(prettyModelName(id)).toBe(name);
  });
});

describe("sourceLabel", () => {
  it("labels each source in words", () => {
    expect(sourceLabel("anthropic")).toBe("Claude · subscription");
    expect(sourceLabel("openai-codex")).toBe("GPT · ChatGPT");
    expect(sourceLabel("deepseek")).toBe("DeepSeek · prepaid");
  });
});

describe("ordinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [21, "21st"],
  ])("%i → %s", (n, s) => expect(ordinal(n)).toBe(s));
});

describe("canTakeFloor", () => {
  it("blocks exhausted and unavailable seats only", () => {
    expect(canTakeFloor(null)).toBe(true);
    expect(canTakeFloor({ status: "ok", available: { kind: "unknown" } })).toBe(true);
    expect(canTakeFloor({ status: "warning", available: { kind: "unknown" } })).toBe(true);
    expect(canTakeFloor({ status: "unknown", available: { kind: "unknown" } })).toBe(true);
    expect(canTakeFloor({ status: "exhausted", available: { kind: "unknown" } })).toBe(false);
    expect(
      canTakeFloor({ status: "unavailable", available: { kind: "unavailable", reason: "x" } }),
    ).toBe(false);
  });
});

describe("SendActionInput", () => {
  const seat = "6f1c0d3e-2a4b-4c5d-8e9f-0a1b2c3d4e5f";

  it("accepts a blind question to everyone", () => {
    const r = SendActionInput.safeParse({
      text: "Edge or API cache?",
      mode: "blind",
      targets: "everyone",
    });
    expect(r.success).toBe(true);
  });

  it("accepts asking one seat with no text (Ask now)", () => {
    const r = SendActionInput.safeParse({ mode: "blind", targets: [seat] });
    expect(r.success).toBe(true);
  });

  it("refuses an empty comment", () => {
    const r = SendActionInput.safeParse({ text: "  ", mode: "none", targets: "everyone" });
    expect(r.success).toBe(false);
  });

  it("refuses an empty question to everyone", () => {
    const r = SendActionInput.safeParse({ text: "", mode: "blind", targets: "everyone" });
    expect(r.success).toBe(false);
  });

  it("accepts a reply-to with no note", () => {
    const r = SendActionInput.safeParse({ mode: "in_turn", targets: [seat], replyTo: seat });
    expect(r.success).toBe(true);
  });
});
