"use client";

import {
  ChartBarBig,
  Download,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMeetings } from "@/components/shell/meetings-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Connection } from "@/hooks/use-meeting";
import { api } from "@/lib/api";
import { compactNumber, meetingStatus, meetingTotals } from "@/lib/format";
import { BriefButton } from "./brief";
import { useRoom } from "./room-context";

export function MeetingHeader({
  connection,
  onToggleSeats,
  briefShown,
  onToggleBrief,
}: {
  connection: Connection;
  onToggleSeats: () => void;
  briefShown: boolean;
  onToggleBrief: () => void;
}) {
  const { id, state, running, act, openWrapUp, openPoll } = useRoom();
  const { refresh } = useMeetings();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(state.meeting.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const totals = meetingTotals(state.messages);
  const status =
    connection === "reconnecting"
      ? "Reconnecting…"
      : (meetingStatus(state) ?? (state.messages.length ? "Waiting for you" : "New meeting"));

  async function saveTitle() {
    setEditing(false);
    const t = title.trim();
    if (!t || t === state.meeting.title) return setTitle(state.meeting.title);
    if (await act(() => api.updateMeeting(id, { title: t }))) void refresh();
  }

  async function remove() {
    setDeleting(true);
    if (await act(() => api.deleteMeeting(id))) {
      await refresh();
      router.replace("/");
    }
    setDeleting(false);
  }

  return (
    <header className="flex items-center gap-3 border-b px-4 py-2.5 pl-12 md:pl-4">
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            autoFocus
            aria-label="Meeting title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTitle();
              if (e.key === "Escape") {
                setTitle(state.meeting.title);
                setEditing(false);
              }
            }}
            className="h-7 text-base font-semibold"
          />
        ) : (
          <button
            type="button"
            title="Rename"
            onClick={() => {
              setTitle(state.meeting.title);
              setEditing(true);
            }}
            className="block max-w-full truncate text-left text-base font-semibold hover:underline"
          >
            {state.meeting.title}
          </button>
        )}
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {running && <Loader2 className="size-3 animate-spin text-brand" />}
          <span className={running ? "font-medium text-brand" : undefined}>{status}</span>
          {totals.tokens > 0 && (
            <>
              <span aria-hidden>·</span>
              <span
                title={
                  totals.estimated
                    ? "Estimated: llmgw doesn't report usage for streamed answers yet"
                    : undefined
                }
              >
                {totals.estimated ? "≈" : ""}
                {compactNumber(totals.tokens)} tokens
              </span>
            </>
          )}
          {totals.deepseekUsd !== null && (
            <>
              <span aria-hidden>·</span>
              <span>DeepSeek ${totals.deepseekUsd.toFixed(4)}</span>
            </>
          )}
        </p>
      </div>
      <BriefButton shown={briefShown} onToggle={onToggleBrief} />
      <Button asChild variant="outline" size="sm" className="h-8">
        <a href={api.exportUrl(id)} download>
          <Download />
          <span className="hidden sm:inline">Export</span>
        </a>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8"
        onClick={() => openPoll()}
        disabled={running || !state.seats.some((s) => !s.removedAt && !s.muted)}
        title="Ask every seat one question, answered privately in one line"
      >
        <ChartBarBig />
        <span className="hidden sm:inline">Poll</span>
      </Button>
      <Button
        size="sm"
        className="h-8"
        onClick={openWrapUp}
        disabled={running || !state.seats.some((s) => !s.removedAt)}
      >
        <NotebookPen />
        <span className="hidden sm:inline">Wrap up</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 lg:hidden"
        aria-label="Show seats"
        onClick={onToggleSeats}
      >
        <Users />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Meeting options">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 />
            Delete meeting
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this meeting?</DialogTitle>
            <DialogDescription>
              "{state.meeting.title}" and its whole transcript are deleted. Export it first if you
              want a copy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={deleting}>
              {deleting && <Loader2 className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
