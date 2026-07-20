"use client";

import { useEffect, useState } from "react";
import {
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Smartphone,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { MOBILE_UA_PATTERN, setViewMode } from "@/lib/view-mode";
import { useLogout } from "./use-logout";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "./sidebar";
import { CommandPalette } from "./command-palette";

interface TopbarProps {
  instanceName: string;
  user: { username: string; displayName: string | null; role: "ADMIN" | "USER" };
}

export function Topbar({ instanceName, user }: TopbarProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const logout = useLogout();
  // A phone showing the desktop view (override cookie) gets a way back.
  const [onPhone, setOnPhone] = useState(false);
  useEffect(() => setOnPhone(MOBILE_UA_PATTERN.test(navigator.userAgent)), []);

  const initials = (user.displayName ?? user.username).slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75 no-gpu:bg-background">
      {/* Mobile nav */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav
            instanceName={instanceName}
            isAdmin={user.role === "ADMIN"}
            onNavigate={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Search trigger */}
      <Button
        variant="outline"
        onClick={() => setPaletteOpen(true)}
        className="h-9 w-full max-w-64 justify-start gap-2 text-muted-foreground sm:max-w-80"
      >
        <Search className="size-4" />
        <span className="truncate">Search the lab…</span>
        <kbd className="pointer-events-none ml-auto hidden select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium sm:flex">
          Ctrl K
        </kbd>
      </Button>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} isAdmin={user.role === "ADMIN"} />

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle dark mode"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="size-4.5 dark:hidden" />
          <Moon className="hidden size-4.5 dark:block" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <p className="truncate text-sm font-medium">{user.displayName ?? user.username}</p>
              <p className="truncate text-xs font-normal text-muted-foreground">
                {user.role === "ADMIN" ? "Administrator" : "User"}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/profile">
                <UserIcon className="size-4" /> Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/appearance">
                <Settings className="size-4" /> Settings
              </Link>
            </DropdownMenuItem>
            {onPhone && (
              <DropdownMenuItem onSelect={() => setViewMode("mobile")}>
                <Smartphone className="size-4" /> Switch to mobile view
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={logout}>
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
