"use client";

import { Plus } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { NewMeetingDialog } from "@/components/shell/new-meeting-dialog";
import { Button } from "@/components/ui/button";

/** No meeting open. */
export default function HomePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <Logo className="mx-auto size-12" />
        <h1 className="text-xl font-semibold tracking-tight">
          Brainstorm with several AI models at once
        </h1>
        <p className="text-sm text-muted-foreground">
          Start a meeting, seat Claude, GPT and DeepSeek around the table, and ask your question.
          You're the chair: seats speak only when you give them the floor.
        </p>
        <NewMeetingDialog>
          <Button>
            <Plus />
            New meeting
          </Button>
        </NewMeetingDialog>
      </div>
    </main>
  );
}
