import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One block of a settings page, as in homework: a title, a line saying what it does, and its controls in a card.
 * `card={false}` when the controls bring their own frame.
 */
export function SettingsSection({
  title,
  description,
  card = true,
  children,
}: {
  title: string;
  description?: ReactNode;
  card?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="px-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className={cn(card && "rounded-lg border bg-card p-4 shadow-xs")}>{children}</div>
    </section>
  );
}

/** A settings page's heading. */
export function SettingsHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-6 space-y-1">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </header>
  );
}
