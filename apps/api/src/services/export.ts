// A meeting as Markdown (v1 scope, ADR 0009): seats, then the transcript in order, rounds as headings.

import {
  type MeetingState,
  type Message,
  type Round,
  type Seat,
  sourceLabel,
} from "@homestorm/shared";

const MODE_LABEL: Record<Round["mode"], string> = {
  blind: "Blind",
  in_turn: "In turn",
  single: "One seat",
  wrap_up: "Wrap up",
};

const WRAP_LABEL = {
  minutes: "Minutes",
  decision: "Decision",
  open_questions: "Open questions",
} as const;

export function exportMarkdown(state: MeetingState, now = new Date()): string {
  const { meeting, seats, rounds, messages } = state;
  const seatById = new Map(seats.map((s) => [s.id, s]));
  const roundById = new Map(rounds.map((r) => [r.id, r]));
  const roundByPrompt = new Map(
    rounds.filter((r) => r.promptMessageId).map((r) => [r.promptMessageId, r]),
  );
  const name = (m: Message) =>
    m.authorKind === "chair"
      ? "Chair"
      : (seatById.get(m.seatId ?? "")?.displayName ?? "Former seat");
  const byId = new Map(messages.map((m) => [m.id, m]));

  const out: string[] = [
    `# ${meeting.title}`,
    "",
    `Exported from homestorm on ${now.toISOString().slice(0, 10)}. Meeting started ${meeting.createdAt.slice(0, 10)}.`,
    "",
    "## Seats",
    "",
    "| Seat | Model | Source | Notes |",
    "|---|---|---|---|",
    ...seats.map((s: Seat) => {
      const notes = [
        s.removedAt ? "left the meeting" : "",
        s.muted ? "muted" : "",
        s.persona ? `persona: ${oneLine(s.persona)}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      return `| ${s.displayName} | \`${s.model}\` | ${sourceLabel(s.ownedBy)} | ${notes} |`;
    }),
    "",
    "## Transcript",
    "",
  ];

  const headed = new Set<string>();
  const heading = (r: Round) => {
    if (headed.has(r.id)) return;
    headed.add(r.id);
    const label =
      r.mode === "wrap_up" && r.wrapKind
        ? `Wrap up · ${WRAP_LABEL[r.wrapKind]}`
        : MODE_LABEL[r.mode];
    out.push(`### Round ${r.number} · ${label}`, "");
  };

  for (const m of messages) {
    if (m.status === "queued") continue;
    if (m.authorKind === "event") {
      out.push(`_${m.content}_`, "");
      continue;
    }
    const promptOf = roundByPrompt.get(m.id);
    if (promptOf) heading(promptOf);
    const round = m.roundId ? roundById.get(m.roundId) : undefined;
    if (round) heading(round);

    if (m.authorKind === "chair") {
      const target = m.replyToId ? byId.get(m.replyToId) : undefined;
      const where =
        m.sendMode === "none"
          ? "comment, no reply"
          : m.sendMode === "seats"
            ? `to ${(m.targetSeatIds ?? []).map((id) => seatById.get(id)?.displayName ?? "?").join(", ")}`
            : `to everyone · ${m.sendMode === "in_turn" ? "in turn" : "blind"}`;
      out.push(`**Chair** · ${target ? `${where} · replying to ${name(target)}` : where}`, "");
      if (m.content) out.push(quote(m.content), "");
      continue;
    }

    if (m.status === "skipped") {
      out.push(`_${name(m)} skipped this turn_`, "");
      continue;
    }

    const meta = [`\`${m.model ?? "?"}\``];
    if (m.usage)
      meta.push(
        `${m.usage.estimated ? "≈" : ""}${m.usage.totalTokens.toLocaleString("en-US")} tokens`,
      );
    if (m.costUsd !== null) meta.push(`$${m.costUsd.toFixed(4)}`);
    if (m.wrapKind)
      meta.push(`${WRAP_LABEL[m.wrapKind]}${m.hiddenFromSeats ? " (not posted)" : ""}`);
    const target = m.replyToId ? byId.get(m.replyToId) : undefined;
    if (target) meta.push(`replying to ${name(target)}`);
    out.push(`**${name(m)}** · ${meta.join(" · ")}`, "");
    if (m.content) out.push(m.content, "");
    if (m.status === "stopped" || m.stoppedEarly) out.push("_(stopped early)_", "");
    if (m.status === "error") out.push(`_(problem: ${m.error?.message ?? "error"})_`, "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`.trimEnd())
    .join("\n");
}

function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cut = flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
  return cut.replace(/\|/g, "\\|");
}
