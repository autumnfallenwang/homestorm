import { type Source, sourceLabel } from "@homestorm/shared";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const AVATAR: Record<Source, string> = {
  anthropic: "bg-src-claude",
  "openai-codex": "bg-src-gpt",
  deepseek: "bg-src-deepseek",
};

const TAG: Record<Source, string> = {
  anthropic: "text-src-claude border-src-claude/30 bg-src-claude/5",
  "openai-codex": "text-src-gpt border-src-gpt/30 bg-src-gpt/5",
  deepseek: "text-src-deepseek border-src-deepseek/30 bg-src-deepseek/5",
};

/** A seat's avatar: its source's color, always shown next to its name in words (ADR 0007). */
export function SeatAvatar({
  name,
  source,
  size = "md",
  dashed = false,
}: {
  name: string;
  source: Source;
  size?: "sm" | "md";
  dashed?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        size === "sm" ? "size-6 text-[0.625rem]" : "size-8 text-xs",
        dashed
          ? "border-2 border-dashed border-current bg-transparent text-muted-foreground"
          : AVATAR[source],
      )}
    >
      {initials(name)}
    </span>
  );
}

/** "Claude · subscription", "GPT · ChatGPT", "DeepSeek · prepaid". */
export function SourceTag({ source, className }: { source: Source; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-px text-[0.6875rem] font-medium whitespace-nowrap",
        TAG[source],
        className,
      )}
    >
      {sourceLabel(source)}
    </span>
  );
}
