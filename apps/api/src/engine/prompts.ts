// The natural-language layer (ADR 0006, ADR 0013): each seat's intro and the floor note at the end of its view.
// Everything about WHO speaks and WHAT they see is decided in code; these texts only set the etiquette and say what
// the seat is being asked to do now. Review the wording here.

import { type AnswerLength, ordinal, type WrapKind } from "@homestorm/shared";

export interface RosterEntry {
  displayName: string;
  model: string;
}

export interface IntroInput {
  meetingTitle: string;
  self: RosterEntry & { persona: string | null };
  /** Every current seat, the speaker included, in seat order. */
  roster: RosterEntry[];
  answerLength: AnswerLength;
  /** The meeting brief at this turn's cutoff (ADR 0015); empty when there is none. */
  brief?: string;
}

const LENGTH_RULE: Record<AnswerLength, string> = {
  concise:
    "Keep answers concise: a few short paragraphs or a short list, unless the Chair asks for more.",
  detailed: "Answer thoroughly, with the detail and examples the question needs.",
};

/** The system prompt. Stable between turns, so prompt caching can work (ADR 0004). */
export function renderIntro(input: IntroInput): string {
  const { self, roster } = input;
  const other = roster.find((r) => r.displayName !== self.displayName)?.displayName;
  const lines = [
    `You are ${self.displayName} (${self.model}), one of several AI participants in a meeting.`,
    "A human, the Chair, runs the meeting.",
    "",
    `Meeting: ${input.meetingTitle}`,
    ...(input.brief?.trim()
      ? [
          "",
          "Meeting brief from the Chair (background and facts for the whole meeting):",
          input.brief.trim(),
        ]
      : []),
    "",
    "Participants:",
    "- Chair: the human who runs the meeting",
    ...roster.map(
      (r) => `- ${r.displayName} (${r.model})${r.displayName === self.displayName ? " (you)" : ""}`,
    ),
    "",
    "How the meeting works:",
    "- You speak only when the Chair gives you the floor. A line starting with [Floor] at the end tells you what you're asked to do now.",
    '- Messages from others appear as "[Name]: …". Your own earlier replies appear as your own turns.',
    "- Sometimes everyone answers the same question independently, without seeing each other's answers. Sometimes participants answer in turn and see the earlier answers.",
    "",
    "How to take part:",
    `- ${LENGTH_RULE[input.answerLength]}`,
    "- Refer to other participants by name.",
    `- If you agree with someone, say so briefly ("I agree with ${other ?? "the others"}") instead of repeating their points.`,
    "- The Chair wants independent views. Disagree when you have a reason, including with the Chair.",
    "- Speak only for yourself. Never write lines for other participants or for the Chair.",
    '- Don\'t start your reply with your name or a "[Name]:" tag.',
    "- Use Markdown when it helps.",
  ];
  if (self.persona?.trim()) {
    lines.push("", "Your role in this meeting:", self.persona.trim());
  }
  return lines.join("\n");
}

/** What the seat is being asked to do now. Goes at the very END of its view. */
export type Floor =
  | { kind: "direct"; replyTo?: ReplyTarget }
  | { kind: "blind"; count: number; replyTo?: ReplyTarget }
  | { kind: "in_turn"; index: number; count: number; replyTo?: ReplyTarget }
  | { kind: "wrap_up"; wrapKind: WrapKind };

export interface ReplyTarget {
  author: string;
  content: string;
}

export const REPLY_EXCERPT_CHARS = 300;

const WRAP_TASK: Record<WrapKind, string> = {
  minutes:
    "Write the meeting minutes: the question or questions discussed, each participant's position, where they agreed, where they disagreed, and any open points. Use short Markdown headings.",
  decision:
    "Write the decision the discussion points to, and the reasons for it. Say which participants supported it and which raised objections, and what would change the decision.",
  open_questions:
    "List the open questions that remain after this discussion, each with a short note on why it's still open and what would settle it.",
};

export function renderFloorNote(floor: Floor): string {
  if (floor.kind === "wrap_up") {
    return `[Floor] The Chair asks you to wrap up the meeting. ${WRAP_TASK[floor.wrapKind]}`;
  }
  const parts: string[] = [];
  if (floor.replyTo) {
    parts.push(
      `The Chair asks you to respond to ${floor.replyTo.author}'s message: "${excerpt(floor.replyTo.content)}"`,
    );
  }
  switch (floor.kind) {
    case "direct":
      if (!floor.replyTo) parts.push("The Chair asks you to speak now.");
      break;
    case "blind":
      parts.push(
        floor.count > 1
          ? `${floor.count === 2 ? "Both" : `All ${floor.count}`} participants answer this independently: you can't see the others' answers and they can't see yours. Give your own view.`
          : "Give your own view.",
      );
      break;
    case "in_turn":
      parts.push(
        floor.index === 1
          ? `You answer ${ordinal(floor.index)} of ${floor.count}, in turn. The others will see your answer before they speak.`
          : `You answer ${ordinal(floor.index)} of ${floor.count}, in turn. Consider the answers above, and say where you agree or disagree.`,
      );
      break;
  }
  return `[Floor] ${parts.join(" ")}`;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > REPLY_EXCERPT_CHARS ? `${flat.slice(0, REPLY_EXCERPT_CHARS)}…` : flat;
}

/** The line that stands in for trimmed messages (ADR 0012). */
export function trimmedNote(count: number, beforeSummary = false): string {
  const n = `${count} older message${count === 1 ? "" : "s"}`;
  return beforeSummary
    ? `(${n} trimmed; the summary below covers them.)`
    : `(${n} trimmed to fit the context window.)`;
}

/** Where a brief version entered the record after the discussion started (ADR 0015). */
export const BRIEF_UPDATED_NOTE =
  "(The Chair updated the meeting brief. Your instructions have the current version.)";
export const BRIEF_CLEARED_NOTE = "(The Chair cleared the meeting brief.)";

/**
 * Follows the brief's images, which open the conversation (ADR 0016). Names say which image is which, also for a
 * text-only seat, which gets llmgw's description of each message's images instead.
 */
export function briefImagesNote(names: string[]): string {
  return names.length === 1
    ? `(The image above is from the meeting brief: ${names[0]}.)`
    : `(The images above are from the meeting brief, in order: ${names.join(", ")}.)`;
}

/**
 * Names a message's images, right after them (ADR 0016). After, not before: llmgw puts a text-only seat's
 * "[Image description: …]" at the start of the message, so "above" reads right for every seat.
 */
export function imagesNote(names: string[]): string {
  return names.length === 1
    ? `(The image above: ${names[0]}.)`
    : `(The images above, in order: ${names.join(", ")}.)`;
}

/** A chair message with files and no text of its own (ADR 0016). */
export const ATTACHMENTS_ONLY = "(See the attached files.)";

/** Ends an answer the chair stopped and then kept, so no seat takes the cut-off text for a finished answer. */
export const CUT_OFF_NOTE = "(The Chair stopped this answer here.)";

/** Stands in for a meeting that starts with a seat speaking, so the view still begins with a user turn. */
export const MEETING_STARTED = "(The meeting has started.)";
