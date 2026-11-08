// A meeting as Markdown (v1 scope, ADR 0009): seats, then the transcript in order, rounds as headings.

import {
  type AttachmentMeta,
  briefAt,
  type MeetingState,
  type Message,
  type Round,
  type Seat,
  seatWebAccess,
  sourceLabel,
  toolSummary,
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

/**
 * `texts` holds text files' contents by attachment id, so the export carries them whole. Images are listed by name
 * and size: the file stays readable without them, and they're one click away in the app.
 */
export function exportMarkdown(
  state: MeetingState,
  now = new Date(),
  texts: Map<string, string> = new Map(),
): string {
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
        s.answerLength ? `answers: ${s.answerLength}` : "",
        s.contextBudget && s.contextBudget !== "standard" ? `context: ${s.contextBudget}` : "",
        seatWebAccess(s, meeting) !== "off" ? `web tools: ${seatWebAccess(s, meeting)}` : "",
        s.persona ? `persona: ${oneLine(s.persona)}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      return `| ${s.displayName} | \`${s.model}\` | ${sourceLabel(s.ownedBy)} | ${notes} |`;
    }),
    "",
  ];
  const brief = briefAt(messages, meeting.clock);
  const firstBriefId = messages.find((m) => m.authorKind === "brief")?.id;
  const currentBrief = messages
    .filter((m) => m.authorKind === "brief" && m.visibleSeq !== null)
    .sort((a, b) => (a.visibleSeq ?? 0) - (b.visibleSeq ?? 0))
    .at(-1);
  const files = (m: Message) => attachmentLines(m.attachments, texts);
  if (brief || currentBrief?.attachments.length) {
    out.push("## Meeting brief", "");
    if (brief) out.push(brief, "");
    if (currentBrief) out.push(...files(currentBrief));
  }
  out.push("## Transcript", "");

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
    if (m.authorKind === "brief") {
      const verb = m.id === firstBriefId ? "set" : "updated";
      if (!m.content && !m.attachments.length) {
        out.push("_You cleared the meeting brief_", "");
        continue;
      }
      out.push(`_You ${verb} the meeting brief:_`, "");
      if (m.content) out.push(quote(m.content), "");
      if (m.attachments.length)
        out.push(
          ...m.attachments.map((a) => `> ${a.kind === "image" ? "Image" : "File"}: ${a.name}`),
          "",
        );
      continue;
    }
    if (m.authorKind === "sources") {
      out.push("**Web search** · posted by the Chair", "", quote(m.content), "");
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
      out.push(...files(m));
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
    const sources = toolSummary(m.toolCalls);
    if (sources) out.push(`_${sources}_`, "");
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

/** "- Image: photo.png (1280×720)", and each text file in full in a fenced block. */
function attachmentLines(files: AttachmentMeta[], texts: Map<string, string>): string[] {
  if (!files.length) return [];
  const out: string[] = [];
  for (const f of files) {
    if (f.kind === "image") {
      out.push(`- Image: ${f.name}${f.width && f.height ? ` (${f.width}×${f.height})` : ""}`);
      continue;
    }
    out.push(`- File: ${f.name} (${(f.textChars ?? 0).toLocaleString("en-US")} characters)`);
    const text = texts.get(f.id);
    if (text !== undefined) {
      const fence = text.includes("```") ? "~~~~" : "```";
      out.push("", `${fence}text`, text, fence, "");
    }
  }
  out.push("");
  return out;
}
