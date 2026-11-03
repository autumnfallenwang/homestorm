/** Three seats around a table: Claude orange, GPT teal, DeepSeek blue. */
export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <circle cx="11" cy="13" r="3.2" className="fill-src-claude" />
      <circle cx="21" cy="13" r="3.2" className="fill-src-gpt" />
      <circle cx="16" cy="21.5" r="3.2" className="fill-src-deepseek" />
    </svg>
  );
}
