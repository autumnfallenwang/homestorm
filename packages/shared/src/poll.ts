// Polls (ADR 0020): every seat answers one question privately, in one line, and the chair sees a table instead of a
// round of essays. The answer stays an ordinary message, so seats read it in later turns like anything else said.

import { z } from "zod";

export const POLL_MAX_OPTIONS = 6;
export const POLL_OPTION_MAX_CHARS = 80;
export const POLL_QUESTION_MAX_CHARS = 500;

export const PollInput = z.object({
  question: z.string().trim().min(1, "Write the question.").max(POLL_QUESTION_MAX_CHARS),
  /** Choices for the seats to pick from. None: each seat answers in a few words of its own. */
  options: z
    .array(z.string().trim().min(1).max(POLL_OPTION_MAX_CHARS))
    .max(POLL_MAX_OPTIONS)
    .default([])
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, {
      message: "The options must differ.",
    }),
});
export type PollInput = z.input<typeof PollInput>;

/** A poll as its round keeps it. */
export interface Poll {
  question: string;
  options: string[];
}

/** The chair's message that opens a poll: the question, and the options if there are any. */
export function pollPrompt(poll: Poll): string {
  return poll.options.length
    ? `${poll.question}\n\nOptions: ${poll.options.join(" / ")}`
    : poll.question;
}

export interface PollAnswer {
  /** As the seat wrote it. */
  choice: string;
  /** Which option it is, or null when it's none of them (or the poll has none). */
  option: number | null;
  /** 0–100, or null when the seat gave none. */
  confidence: number | null;
  why: string;
}

/**
 * A seat's answer line, `Choice: … · Confidence: …% · Why: …`, read leniently: models add bold, change the separator,
 * or put the parts on separate lines. Null when there's no choice to be found.
 */
export function parsePollAnswer(content: string, options: readonly string[]): PollAnswer | null {
  const text = content.replace(/[*_`]/g, "").replace(/\r/g, "");
  const field = (name: string, stop: string) => {
    const m = text.match(new RegExp(`${name}\\s*[:：]\\s*([^\\n]*?)\\s*(?=${stop}|\\n|$)`, "i"));
    return m?.[1]?.trim() ?? null;
  };
  const choice = field("choice", "[·|;]\\s*(?:confidence|why)\\b");
  if (!choice) return null;
  const conf = field("confidence", "[·|;]\\s*why\\b");
  const pct = conf?.match(/(\d{1,3})(?:\s*%)?/);
  const confidence = pct ? Math.min(100, Number(pct[1])) : null;
  const why = field("why", "$^") ?? "";
  return { choice, option: matchOption(choice, options), confidence, why };
}

/** The option a choice names: the same words, ignoring case and punctuation, or the one it starts with. */
export function matchOption(choice: string, options: readonly string[]): number | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const c = norm(choice);
  const exact = options.findIndex((o) => norm(o) === c);
  if (exact >= 0) return exact;
  const prefix = options.findIndex((o) => c.startsWith(norm(o)) || norm(o).startsWith(c));
  return prefix >= 0 && c.length > 0 ? prefix : null;
}

/** How many seats picked each option, in the options' order, then "other" for answers that matched none. */
export function pollTally(
  answers: ReadonlyArray<PollAnswer | null>,
  options: readonly string[],
): { label: string; count: number }[] {
  const counts = options.map((label) => ({ label, count: 0 }));
  let other = 0;
  for (const a of answers) {
    if (!a) continue;
    if (a.option !== null && counts[a.option]) counts[a.option]!.count++;
    else other++;
  }
  return other ? [...counts, { label: "Other", count: other }] : counts;
}

/** How a seat's answer moved since the last time the same poll was taken. */
export function pollShift(now: PollAnswer, before: PollAnswer | null | undefined): string | null {
  if (!before) return null;
  const sameChoice =
    now.option !== null ? now.option === before.option : now.choice === before.choice;
  if (!sameChoice) return `was ${before.choice}`;
  if (now.confidence === null || before.confidence === null) return null;
  const d = now.confidence - before.confidence;
  return d === 0 ? "no change" : `${d > 0 ? "+" : ""}${d} pts`;
}

/** Two polls are the same poll when the question and the options are. "Poll again" asks exactly the same. */
export function samePoll(a: Poll, b: Poll): boolean {
  return (
    a.question.trim() === b.question.trim() &&
    a.options.length === b.options.length &&
    a.options.every((o, i) => o === b.options[i])
  );
}
