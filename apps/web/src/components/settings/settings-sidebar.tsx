"use client";

import { ArrowLeft, CircleUser, type LucideIcon, Palette } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/shell/account-menu";
import { Logo } from "@/components/shell/logo";
import { cn } from "@/lib/utils";

export const SETTINGS_TABS: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/settings/profile", label: "Profile", icon: CircleUser },
  { href: "/settings/appearance", label: "Appearance", icon: Palette },
];

/**
 * Settings' own sidebar, in place of the meetings list (ADR 0018), as homework does: Back, then one row per tab. On
 * phones it's a rail of icons.
 */
export function SettingsSidebar() {
  const pathname = usePathname();
  const row =
    "flex items-center justify-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors md:justify-start";
  return (
    <aside
      className="flex h-full w-14 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:w-56"
      aria-label="Settings"
    >
      <div className="flex items-center justify-center gap-2 px-2 pt-4 pb-3 md:justify-start md:px-4">
        <Logo />
        <span className="hidden font-semibold tracking-tight md:inline">Settings</span>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        <Link
          href="/"
          title="Back to meetings"
          className={cn(row, "text-muted-foreground hover:bg-accent hover:text-foreground")}
        >
          <ArrowLeft className="size-4 shrink-0" />
          <span className="hidden md:inline">Back to meetings</span>
        </Link>
      </nav>
      <nav className="mt-2 flex flex-col gap-0.5 px-2" aria-label="Settings sections">
        {SETTINGS_TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                row,
                active
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="hidden md:inline">{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t p-2">
        <div className="flex justify-center md:hidden">
          <AccountMenu compact />
        </div>
        <div className="hidden md:block">
          <AccountMenu />
        </div>
      </div>
    </aside>
  );
}
