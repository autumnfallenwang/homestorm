"use client";

import type { MeetingSummary } from "@homestorm/shared";
import {
  ChevronsUpDown,
  KeyRound,
  Loader2,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMe } from "@/components/auth/session-gate";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { dayGroup, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChangePasswordDialog } from "./change-password-dialog";
import { Logo } from "./logo";
import { useMeetings } from "./meetings-context";
import { NewMeetingDialog } from "./new-meeting-dialog";

const GROUP_ORDER = ["Today", "Yesterday", "This week", "Older"];

/**
 * Left pane: app name, New meeting, search, meetings grouped by day, the chair's profile. `onFold` hides it: into the
 * rail on wide screens, or closing the menu on phones.
 */
export function MeetingsSidebar({
  onNavigate,
  onFold,
}: {
  onNavigate?: () => void;
  onFold: () => void;
}) {
  const { meetings } = useMeetings();
  const me = useMe();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const [query, setQuery] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (meetings ?? []).filter((m) => !q || m.title.toLowerCase().includes(q));
    const map = new Map<string, typeof list>();
    for (const m of list) {
      const g = dayGroup(m.updatedAt);
      map.set(g, [...(map.get(g) ?? []), m]);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g) ?? []] as const);
  }, [meetings, query]);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 pt-4 pr-2 pb-3 pl-4">
        <Logo />
        <span className="font-semibold tracking-tight">Homestorm</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-8 text-muted-foreground"
          aria-label="Hide meetings"
          title="Hide meetings"
          onClick={onFold}
        >
          <PanelLeftClose />
        </Button>
      </div>
      <div className="space-y-2 px-3">
        <NewMeetingDialog>
          <Button className="w-full justify-start" size="sm">
            <Plus />
            New meeting
          </Button>
        </NewMeetingDialog>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search meetings"
            placeholder="Search meetings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 bg-background pl-8 text-sm"
          />
        </div>
      </div>
      <nav className="mt-3 flex-1 overflow-y-auto px-2 pb-3" aria-label="Meetings">
        {meetings === null && <p className="px-2 text-sm text-muted-foreground">Loading…</p>}
        {meetings?.length === 0 && (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            No meetings yet. Start one above.
          </p>
        )}
        {groups.map(([group, items]) => (
          <div key={group} className="mb-3">
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group}</p>
            <ul className="space-y-0.5">
              {items.map((m) => (
                <li key={m.id} className="group relative">
                  <Link
                    href={`/m/${m.id}`}
                    onClick={onNavigate}
                    aria-current={params.id === m.id ? "page" : undefined}
                    className={cn(
                      "block rounded-md py-1.5 pr-9 pl-2 text-sm hover:bg-accent",
                      params.id === m.id && "bg-accent font-medium",
                    )}
                  >
                    <span className="line-clamp-1">{m.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {m.live ? (
                        <span className="inline-flex items-center gap-1 text-ok">
                          <span className="size-1.5 animate-pulse rounded-full bg-ok" />
                          Live
                        </span>
                      ) : m.hasMinutes ? (
                        <span>Minutes written</span>
                      ) : null}
                      {(m.live || m.hasMinutes) && <span aria-hidden>·</span>}
                      <span>
                        {m.seatCount} seat{m.seatCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </Link>
                  <MeetingMenu meeting={m} current={params.id === m.id} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
                {initials(me.user.name || "Chair")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{me.user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  Chair · {me.user.email}
                </span>
              </span>
              <ChevronsUpDown className="size-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Signed in as {me.user.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
              <KeyRound />
              Change password
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                await signOut().catch(() => {});
                router.replace("/sign-in");
              }}
            >
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      </div>
    </aside>
  );
}

/** The folded meetings list on wide screens: open it again, or start a meeting. */
export function MeetingsRail({ onExpand }: { onExpand: () => void }) {
  return (
    <aside
      className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r bg-sidebar pt-4 text-sidebar-foreground"
      aria-label="Meetings, folded"
    >
      <Logo />
      <Button
        variant="ghost"
        size="icon"
        className="mt-1 size-8 text-muted-foreground"
        aria-label="Show meetings"
        title="Show meetings"
        onClick={onExpand}
      >
        <PanelLeftOpen />
      </Button>
      <NewMeetingDialog>
        <Button size="icon" className="size-8" aria-label="New meeting" title="New meeting">
          <Plus />
        </Button>
      </NewMeetingDialog>
    </aside>
  );
}

/**
 * A meeting's ⋯ menu in the list. Deleting asks twice inside the menu itself: the first click only arms it, so a slip
 * of the mouse never deletes a meeting.
 */
function MeetingMenu({ meeting, current }: { meeting: MeetingSummary; current: boolean }) {
  const { refresh } = useMeetings();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setArmed(false);
      setError(null);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMeeting(meeting.id);
      setBusy(false);
      setOpen(false);
      setArmed(false);
      if (current) router.replace("/");
      await refresh();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Couldn't delete it. Try again.");
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Options for ${meeting.title}`}
          className={cn(
            "absolute top-1.5 right-1 size-7 text-muted-foreground hover:bg-background/70",
            // Shown on hover, focus, the open meeting, or a screen with no hover at all (phones).
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100",
            current && "opacity-100",
          )}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {armed ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Delete "<span className="font-medium text-foreground">{meeting.title}</span>" and its
              whole transcript? This can't be undone.
              {meeting.live && " The round in progress stops first."}
            </DropdownMenuLabel>
            {error && (
              <p role="alert" className="px-2 pb-1.5 text-xs text-destructive">
                {error}
              </p>
            )}
            <DropdownMenuItem
              variant="destructive"
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Yes, delete it
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault();
                setArmed(false);
                setError(null);
              }}
            >
              Cancel
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              // Keep the menu open: the next click is the confirmation.
              e.preventDefault();
              setArmed(true);
            }}
          >
            <Trash2 />
            Delete meeting…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
