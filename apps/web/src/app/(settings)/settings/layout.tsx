import type { ReactNode } from "react";
import { SessionGate } from "@/components/auth/session-gate";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";

/** Settings (ADR 0018): its own sidebar in place of the meetings list, and one page per tab. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      <div className="flex h-full">
        <SettingsSidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6">{children}</div>
        </main>
      </div>
    </SessionGate>
  );
}
