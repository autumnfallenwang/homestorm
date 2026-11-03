// How things read in the UI: allowance lines, seat states, tokens, times. Pure, so it's unit tested.

import type { Limits, MeetingState, Message, Round, Seat } from "@homestorm/shared";

export interface AllowanceLine {
  text: string;
  /** 0–100 for the bar, or null for no bar. */
  percent: number | null;
  tone: "ok" | "warn" | "bad" | "muted";
}

export function allowanceLine(limits: Limits | null | undefined, now = new Date()): AllowanceLine {
  if (!limits) return { text: "Allowance unknown", percent: null, tone: "muted" };
  const a = limits.available;
  switch (a.kind) {
    case "percent": {
      const period = /month/i.test(a.binding)
        ? "this month"
        : /week/i.test(a.binding)
          ? "this week"
          : "left";
      const left = Math.max(0, Math.round(a.percentLeft));
      const reset = a.resetsAt ? ` · resets ${shortDate(a.resetsAt, now)}` : "";
      const text = period === "left" ? `${left}% left${reset}` : `${left}% left ${period}${reset}`;
      return {
        text,
        percent: left,
        tone: limits.status === "exhausted" ? "bad" : left < 20 ? "warn" : "ok",
      };
    }
    case "balance":
      return {
        text: `${a.currency === "USD" ? "$" : ""}${a.amount.toFixed(2)}${a.currency === "USD" ? "" : ` ${a.currency}`} left`,
        percent: null,
        tone: limits.status === "exhausted" ? "bad" : a.amount < 1 ? "warn" : "ok",
      };
    case "unlimited":
      return { text: "Unlimited", percent: null, tone: "ok" };
    case "unavailable":
      return { text: "Not on your plan", percent: null, tone: "bad" };
    default:
      return { text: "Allowance unknown", percent: null, tone: "muted" };
  }
}

/** "Nov 6", or "Nov 6, 2027" when not this year. */
export function shortDate(isoDate: string, now = new Date()): string {
  const d = new Date(isoDate);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function clockTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** 1234 → "1.2k", 999 → "999". */
export function compactNumber(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export type SeatStatus =
  | "Answering"
  | "Next"
  | "Idle"
  | "Muted"
  | "Rate limited"
  | "Out of allowance"
  | "Unavailable";

/** A seat's state, always as words (ADR 0007). */
export function seatStatus(
  seat: Seat,
  state: MeetingState,
  limits: Limits | null | undefined,
): SeatStatus {
  const own = state.messages.filter((m) => m.seatId === seat.id);
  if (own.some((m) => m.status === "streaming")) return "Answering";
  if (own.some((m) => m.status === "queued")) return "Next";
  if (limits?.status === "exhausted") return "Out of allowance";
  if (limits?.status === "unavailable") return "Unavailable";
  const last = own.at(-1);
  if (last?.status === "error" && last.error?.code === "rate_limited") return "Rate limited";
  if (seat.muted) return "Muted";
  return "Idle";
}

/** The header's status: "Round 2 in progress", or nothing when idle. */
export function meetingStatus(state: MeetingState): string | null {
  const running = state.rounds.filter((r) => r.status === "running").at(-1);
  if (!running) return null;
  return running.mode === "wrap_up" ? "Writing the wrap-up" : `Round ${running.number} in progress`;
}

export interface MeetingTotals {
  tokens: number;
  estimated: boolean;
  /** DeepSeek spend as llmgw reported it; null when it reported none. */
  deepseekUsd: number | null;
}

export function meetingTotals(messages: Message[]): MeetingTotals {
  let tokens = 0;
  let estimated = false;
  let usd: number | null = null;
  for (const m of messages) {
    if (m.usage) {
      tokens += m.usage.totalTokens;
      estimated ||= m.usage.estimated;
    }
    if (m.ownedBy === "deepseek" && m.costUsd !== null) usd = (usd ?? 0) + m.costUsd;
  }
  return { tokens, estimated, deepseekUsd: usd };
}

/** "3 of 3 answered" for a round box. */
export function roundProgress(round: Round, messages: Message[]): string {
  const own = messages.filter((m) => m.roundId === round.id);
  const answered = own.filter((m) => m.status === "done").length;
  return `${answered} of ${own.length} answered`;
}

/** Where a chair message went, as the line under its bubble. */
export function sentToLine(
  m: Message,
  seatName: (id: string) => string,
  replyAuthor?: string,
): string {
  if (replyAuthor) {
    const who = (m.targetSeatIds ?? []).map(seatName);
    return `Asked ${listWords(who)} to respond to ${replyAuthor}`;
  }
  switch (m.sendMode) {
    case "none":
      return "Comment · no reply";
    case "in_turn":
      return "Sent to everyone · in turn";
    case "blind":
      return "Sent to everyone · blind";
    case "seats":
      return `Asked ${listWords((m.targetSeatIds ?? []).map(seatName))}`;
    default:
      return "";
  }
}

export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Initials for an avatar: "Claude Opus 5.5" → "CO", "GPT-6 Luna" → "GL". */
export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, "")
    .split(/[\s-]+/)
    .filter((w) => /^[A-Za-z]/.test(w));
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

/** Meetings grouped for the sidebar: Today, Yesterday, This week, Older. */
export function dayGroup(isoDate: string, now = new Date()): string {
  const d = new Date(isoDate);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Older";
}

/** Markdown as one line of plain text, for quotes and previews: "**blind** rounds" → "blind rounds". */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

const TIER = ["fable", "opus", "sonnet", "haiku", "sol", "luna", "terra", "astra", "pro", "flash"];

/** Models in the add-seat list: strongest family first, then newest version first. */
export function compareModels(a: string, b: string): number {
  const tier = (id: string) => {
    const i = TIER.findIndex((t) => id.split(/[-/]/).includes(t));
    return i < 0 ? TIER.length : i;
  };
  const version = (id: string) => {
    const parts = id.replace(/^[a-z]+[-/]/, "").match(/\d+(?:[.-]\d+)?/);
    return parts ? Number.parseFloat(parts[0].replace("-", ".")) : 0;
  };
  return tier(a) - tier(b) || version(b) - version(a) || a.localeCompare(b);
}
