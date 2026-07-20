"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import { LogOut, Monitor, Moon, Search, Settings, Sun } from "lucide-react";
import { NAV_GROUPS, isActive } from "@/components/shell/nav";
import { CommandPalette } from "@/components/shell/command-palette";
import { useLogout } from "@/components/shell/use-logout";
import { AppLogo } from "@/components/shell/app-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { setViewMode } from "@/lib/view-mode";
import { cn } from "@/lib/utils";
import { BottomSheet } from "../ui/bottom-sheet";

export interface MobileShellUser {
  username: string;
  displayName: string | null;
  role: "ADMIN" | "USER";
}

/**
 * Everything that isn't one of the four tabs: full navigation (derived from
 * NAV_GROUPS — never duplicate routes here), global search, and account
 * actions. Mirrors what the desktop sidebar + topbar menu offer.
 */
export function MobileMoreSheet({
  open,
  onOpenChange,
  instanceName,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceName: string;
  user: MobileShellUser;
}) {
  const pathname = usePathname();
  const logout = useLogout();
  const { resolvedTheme, setTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isAdmin = user.role === "ADMIN";
  const initials = (user.displayName ?? user.username).slice(0, 2).toUpperCase();

  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange} title={instanceName} hideHeader>
        <div className="flex flex-col gap-4">
          {/* Identity + quick account actions */}
          <div className="flex items-center gap-3">
            <AppLogo className="size-7 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{instanceName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user.displayName ?? user.username} · {isAdmin ? "Administrator" : "User"}
              </p>
            </div>
            <Link
              href="/settings/profile"
              onClick={() => onOpenChange(false)}
              aria-label="Profile"
              className="flex size-10 items-center justify-center rounded-full active:bg-muted"
            >
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Link>
          </div>

          {/* Global search */}
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              setPaletteOpen(true);
            }}
            className="flex h-10 items-center gap-2 rounded-xl bg-muted px-3 text-sm text-muted-foreground active:bg-muted/70"
          >
            <Search className="size-4" />
            Search the lab…
          </button>

          {/* Full navigation, straight from the canonical nav definition. */}
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(
              (item) => !item.paletteOnly && (!item.adminOnly || isAdmin),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.title ?? "root"} className="flex flex-col gap-1.5">
                {group.title && (
                  <p className="px-0.5 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                    {group.title}
                  </p>
                )}
                <div className="grid grid-cols-4 gap-1.5">
                  {items.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => onOpenChange(false)}
                        className={cn(
                          "flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2 text-center transition-colors active:bg-muted",
                          active
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "bg-card text-foreground",
                        )}
                      >
                        <item.icon className="size-5" strokeWidth={1.8} />
                        <span className="text-[10px] leading-tight font-medium">{item.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* App actions */}
          <div className="divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
            <Link
              href="/settings"
              onClick={() => onOpenChange(false)}
              className="flex min-h-12 items-center gap-3 px-3.5 text-sm font-medium active:bg-muted/70"
            >
              <Settings className="size-4.5 text-muted-foreground" /> Settings
            </Link>
            <button
              type="button"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="flex min-h-12 w-full items-center gap-3 px-3.5 text-sm font-medium active:bg-muted/70"
            >
              <Sun className="size-4.5 text-muted-foreground dark:hidden" />
              <Moon className="hidden size-4.5 text-muted-foreground dark:block" />
              Toggle dark mode
            </button>
            <button
              type="button"
              onClick={() => setViewMode("desktop")}
              className="flex min-h-12 w-full items-center gap-3 px-3.5 text-sm font-medium active:bg-muted/70"
            >
              <Monitor className="size-4.5 text-muted-foreground" /> Switch to desktop view
            </button>
            <button
              type="button"
              onClick={logout}
              className="flex min-h-12 w-full items-center gap-3 px-3.5 text-sm font-medium text-destructive active:bg-muted/70"
            >
              <LogOut className="size-4.5" /> Sign out
            </button>
          </div>
        </div>
      </BottomSheet>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} isAdmin={isAdmin} />
    </>
  );
}
