// Display names for models and sources. A seat's default name comes from its model ID.

import type { Seat, Source } from "./domain.js";

const BRANDS: Record<string, string> = {
  claude: "Claude",
  gpt: "GPT",
  deepseek: "DeepSeek",
};

/**
 * A readable name from a model ID:
 * - `claude-opus-5-5` → "Claude Opus 5.5";
 * - `claude-fable-5-1` → "Claude Fable 5.1";
 * - `gpt-6-luna` → "GPT-6 Luna";
 * - `gpt-5.6-terra` → "GPT-5.6 Terra";
 * - `deepseek-v4-pro` → "DeepSeek V4 Pro".
 *
 * A trailing date (`-20251001`) is dropped, and an `owned_by/` prefix is ignored.
 */
export function prettyModelName(modelId: string): string {
  const id = modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;
  const parts = id.split("-").filter((p) => !/^\d{8}$/.test(p));
  const [first, ...rest] = parts;
  if (!first) return modelId;
  const brand = BRANDS[first.toLowerCase()];

  // GPT puts its version right after the brand with a hyphen: GPT-6, GPT-5.6.
  if (brand === "GPT" && rest[0] && /^\d/.test(rest[0])) {
    const [version, ...words] = rest;
    return [`GPT-${version}`, ...words.map(titleWord)].join(" ");
  }

  // Claude-style versions are split into number parts: opus-5-5 → Opus 5.5.
  const words: string[] = [];
  let version: string[] = [];
  for (const part of rest) {
    if (/^\d+$/.test(part)) {
      version.push(part);
    } else {
      if (version.length) words.push(version.join("."));
      version = [];
      words.push(titleWord(part));
    }
  }
  if (version.length) words.push(version.join("."));
  return [brand ?? titleWord(first), ...words].join(" ");
}

function titleWord(word: string): string {
  // v4 → V4; a plain word → Capitalized.
  if (/^v\d/i.test(word)) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ── Seat names ──────────────────────────────────────────────────────────
// Every view tags messages with the author's display name, so two seats with one name would read as one participant:
// each would see its twin's answers under its own name. Names are unique within a meeting, ignoring case and
// counting removed seats, because a removed seat's earlier messages keep its name.

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** `base` if it's free, else "base (2)", "base (3)", …: "Claude Opus 5.5 (2)" for a second seat on one model. */
export function uniqueSeatName(base: string, taken: Iterable<string>): string {
  const keys = new Set(Array.from(taken, nameKey));
  if (!keys.has(nameKey(base))) return base;
  for (let n = 2; ; n++) if (!keys.has(nameKey(`${base} (${n})`))) return `${base} (${n})`;
}

/** The seat that already has this name, if any. `selfId` is the seat being renamed, which may keep its name. */
export function seatNameClash(
  name: string,
  seats: Pick<Seat, "id" | "displayName" | "removedAt">[],
  selfId?: string,
): Pick<Seat, "id" | "displayName" | "removedAt"> | undefined {
  const key = nameKey(name);
  return seats.find((s) => s.id !== selfId && nameKey(s.displayName) === key);
}

/** Why a name can't be used, in words for the Chair. */
export function seatNameClashMessage(clash: Pick<Seat, "displayName" | "removedAt">): string {
  return clash.removedAt
    ? `A seat you removed was called "${clash.displayName}", and its messages keep that name. Pick another name.`
    : `Another seat is already called "${clash.displayName}". Pick another name.`;
}

/** The source tag on a seat ("Claude · subscription"). */
export function sourceLabel(source: Source): string {
  switch (source) {
    case "anthropic":
      return "Claude · subscription";
    case "openai-codex":
      return "GPT · ChatGPT";
    case "deepseek":
      return "DeepSeek · prepaid";
  }
}

/**
 * What a message cost in real money, or null. llmgw prices every reply at list price (`cost_usd`, llmgw 0.8.0), but
 * only DeepSeek is paid per request; for the subscriptions it's the API-price equivalent, not a charge, so it isn't
 * shown as spend.
 */
export function spendUsd(message: {
  ownedBy: Source | null;
  costUsd: number | null;
}): number | null {
  return message.ownedBy === "deepseek" ? message.costUsd : null;
}

/** The short family name used for avatar colors and grouping. */
export function sourceFamily(source: Source): "Claude" | "GPT" | "DeepSeek" {
  switch (source) {
    case "anthropic":
      return "Claude";
    case "openai-codex":
      return "GPT";
    case "deepseek":
      return "DeepSeek";
  }
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
