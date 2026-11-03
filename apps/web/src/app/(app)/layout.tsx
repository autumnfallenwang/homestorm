"use client";

import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { SessionGate } from "@/components/auth/session-gate";
import { MeetingsProvider } from "@/components/shell/meetings-context";
import { MeetingsSidebar } from "@/components/shell/meetings-sidebar";
import { Button } from "@/components/ui/button";

/** The three-pane shell (ADR 0007): meetings list on the left; each page fills the middle and right. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <SessionGate>
      <MeetingsProvider>
        <div className="flex h-full">
          <div className="hidden md:flex">
            <MeetingsSidebar />
          </div>
          {menuOpen && (
            <div className="fixed inset-0 z-40 flex md:hidden">
              <MeetingsSidebar onNavigate={() => setMenuOpen(false)} />
              <button
                type="button"
                aria-label="Close menu"
                className="flex-1 bg-black/30"
                onClick={() => setMenuOpen(false)}
              />
            </div>
          )}
          <div className="relative flex min-w-0 flex-1">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 left-2 z-10 md:hidden"
              aria-label="Open meetings"
              onClick={() => setMenuOpen(true)}
            >
              <Menu />
            </Button>
            {children}
          </div>
        </div>
      </MeetingsProvider>
    </SessionGate>
  );
}
