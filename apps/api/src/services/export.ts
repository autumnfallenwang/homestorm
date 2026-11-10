// A meeting as Markdown (v1 scope, ADR 0009): seats, then the transcript in order, rounds as headings.

import {
  ANSWER_LENGTH_LABEL,
  type AttachmentMeta,
  briefAt,
  CODE_ACCESS_LABEL,
  type MeetingState,
  type Message,
  type Poll,
  type PollAnswer,
  parsePollAnswer,
  pollTally,
  type Round,
  type Seat,
  sourceLabel,
  spendUsd,
  toolSummary,
  WEB_ACCESS_LABEL,
} from "@homestorm/shared";

const MODE_LABEL: Record<Round["mode"], string> = {
  blind: "Blind",
  in_turn: "In turn",
  single: "One seat",
  wrap_up: "Wrap up",
  poll: "Poll",
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
    "## Room rules",
    "",
    `- Answer length: ${ANSWER_LENGTH_LABEL[meeting.answerLength]}`,
    `- Web tools: ${WEB_ACCESS_LABEL[meeting.webAccess]}`,
    `- Python: ${CODE_ACCESS_LABEL[meeting.codeAccess]}`,
    "",
    "## Seats",
    "",
    "A seat follows the room rules unless its notes give its own setting.",
    "",
    "| Seat | Model | Source | Notes |",
    "|---|---|---|---|",
    ...seats.map((s: Seat) => {
      const notes = [
        s.removedAt ? "left the meeting" : "",
        s.muted ? "muted" : "",
        s.answerLength ? `answers: ${ANSWER_LENGTH_LABEL[s.answerLength]}` : "",
        s.contextBudget && s.contextBudget !== "standard" ? `context: ${s.contextBudget}` : "",
        s.webAccess ? `web tools: ${WEB_ACCESS_LABEL[s.webAccess]}` : "",
        s.codeAccess ? `Python: ${CODE_ACCESS_LABEL[s.codeAccess]}` : "",
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
  /** The Python a seat ran and what came back (ADR 0021), so the record shows how a number was reached. */
  const codeRuns = (m: Message): string[] =>
    m.toolCalls
      .filter((c) => c.tool === "code_run" && c.status !== "running")
      .flatMap((c) => [
        `_Ran Python${c.status === "ok" ? "" : ` (${c.detail ?? "failed"})`}:_`,
        "",
        "```python",
        c.input.trimEnd(),
        "```",
        ...(c.output ? ["", "```text", c.output, "```"] : []),
        "",
      ]);

  /** A poll's answers as a table, with the tally when it had options (ADR 0020). */
  const pollTable = (r: Round, poll: Poll): string[] => {
    const answers = messages
      .filter((x) => x.roundId === r.id && x.authorKind === "seat" && x.status === "done")
      .map((x) => ({ seat: name(x), a: parsePollAnswer(x.content, poll.options) }))
      .filter((x): x is { seat: string; a: PollAnswer } => x.a !== null);
    if (!answers.length) return [];
    const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
    const tally = pollTally(
      answers.map((x) => x.a),
      poll.options,
    )
      .filter((t) => t.count > 0)
      .map((t) => `${t.label} ${t.count}`)
      .join(" · ");
    return [
      ...(poll.options.length ? [`**Tally:** ${tally}`, ""] : []),
      "| Seat | Choice | Confidence | Why |",
      "|---|---|---|---|",
      ...answers.map(
        ({ seat, a }) =>
          `| ${cell(seat)} | ${cell(a.choice)} | ${a.confidence === null ? "" : `${a.confidence}%`} | ${cell(a.why)} |`,
      ),
      "",
    ];
  };

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
      if (promptOf?.mode === "poll" && promptOf.poll)
        out.push(...pollTable(promptOf, promptOf.poll));
      continue;
    }
    // A poll's answers are in its table; only one that failed or couldn't be read is listed on its own.
    if (
      round?.mode === "poll" &&
      m.status === "done" &&
      parsePollAnswer(m.content, round.poll?.options ?? [])
    )
      continue;

    if (m.status === "skipped") {
      out.push(`_${name(m)} skipped this turn_`, "");
      continue;
    }

    const meta = [`\`${m.model ?? "?"}\``];
    if (m.usage)
      meta.push(
        `${m.usage.estimated ? "≈" : ""}${m.usage.totalTokens.toLocaleString("en-US")} tokens`,
      );
    const spend = spendUsd(m);
    if (spend !== null) meta.push(`$${spend.toFixed(4)}`);
    if (m.wrapKind)
      meta.push(`${WRAP_LABEL[m.wrapKind]}${m.hiddenFromSeats ? " (not posted)" : ""}`);
    const target = m.replyToId ? byId.get(m.replyToId) : undefined;
    if (target) meta.push(`replying to ${name(target)}`);
    out.push(`**${name(m)}** · ${meta.join(" · ")}`, "");
    if (m.content) out.push(m.content, "");
    const sources = toolSummary(m.toolCalls);
    if (sources) out.push(`_${sources}_`, "");
    out.push(...codeRuns(m));
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
