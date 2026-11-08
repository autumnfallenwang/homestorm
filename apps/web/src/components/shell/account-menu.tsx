"use client";

import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMe } from "@/components/auth/session-gate";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The chair's profile at the bottom of a sidebar, opening Settings and Sign out. `compact` is just the avatar, for the
 * folded rail and phone-width settings.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const avatar = (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
      {initials(me.user.name || "Chair")}
    </span>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={compact ? `${me.user.name}: settings and sign out` : undefined}
          title={compact ? me.user.name : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md text-left hover:bg-accent",
            compact ? "p-1" : "w-full px-2 py-1.5",
          )}
        >
          {avatar}
          {!compact && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{me.user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  Chair · {me.user.email}
                </span>
              </span>
              <ChevronsUpDown className="size-4 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={compact ? "right" : "top"} className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Signed in as {me.user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <Settings />
            Settings
          </Link>
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
  );
}
