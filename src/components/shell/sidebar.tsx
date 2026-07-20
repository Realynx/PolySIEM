"use client";

import { useEffect, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LoaderCircle, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NAV_GROUPS, isActive, type NavGroup } from "./nav";
import { AppLogo } from "./app-logo";

/**
 * Icon + label rendered inside a sidebar <Link>. Uses Next's useLinkStatus
 * (must be a descendant of the Link) to give instant feedback while the
 * navigation is pending: the icon cross-fades into a spinner and the label
 * pulses. The 150ms transition delay avoids a flash on fast (prefetched)
 * navigations.
 */
function NavLinkBody({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  const { pending } = useLinkStatus();

  return (
    <>
      <span className="relative size-4 shrink-0" aria-hidden>
        <Icon
          className={cn(
            "size-4 transition-opacity duration-150",
            pending && "opacity-0 delay-150",
          )}
        />
        <LoaderCircle
          className={cn(
            "absolute inset-0 size-4 transition-opacity duration-150",
            pending ? "animate-spin opacity-100 delay-150" : "opacity-0",
          )}
        />
      </span>
      <span className={cn("truncate", pending && "animate-pulse")}>{title}</span>
    </>
  );
}

/** Items a given viewer actually sees in the rail (palette-only/admin filtered). */
function visibleItems(group: NavGroup, isAdmin: boolean) {
  return group.items.filter((item) => !item.paletteOnly && (isAdmin || !item.adminOnly));
}

/*
 * Approximate rendered heights, in px, of the rail's parts — derived from the
 * Tailwind classes below (py-1.5 + text-sm rows, py-1.5 + text-[11px] group
 * headers, the h-14 logo and the settings footer). Used only to decide whether
 * every section fits on screen at once; a few px of drift is harmless.
 */
const ROW_H = 32;
const GROUP_HEADER_H = 28;
const GROUP_GAP = 4;
const ITEM_GAP = 2;
const RAIL_CHROME_H = 136;

/*
 * How much of the fully-expanded height the window must have before every
 * section opens. The rail sits in a ScrollArea, so a slight overflow just
 * scrolls — 0.9 lets a maximized 1080p window (~950px of viewport after
 * browser chrome) expand, while a genuinely short window stays collapsed.
 */
const FIT_TOLERANCE = 0.9;

/** Height the rail would need with every section expanded. */
function expandedHeight(isAdmin: boolean): number {
  return NAV_GROUPS.reduce((total, group) => {
    const items = visibleItems(group, isAdmin);
    if (items.length === 0) return total;
    const rows = items.length * (ROW_H + ITEM_GAP);
    return total + (group.title ? GROUP_HEADER_H + rows : rows) + GROUP_GAP;
  }, RAIL_CHROME_H);
}

function activeGroupTitle(pathname: string): string | null {
  for (const group of NAV_GROUPS) {
    if (group.title && group.items.some((item) => isActive(pathname, item.href))) {
      return group.title;
    }
  }
  return null;
}

function NavLink({ item, pathname, onNavigate }: {
  item: NavGroup["items"][number];
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <NavLinkBody icon={item.icon} title={item.title} />
    </Link>
  );
}

export function SidebarNav({ instanceName, isAdmin, onNavigate }: {
  instanceName: string;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const activeGroup = activeGroupTitle(pathname);
  // Starts with just the section you're in — the server can't know the viewport
  // height, so this is the SSR-safe baseline. Manual toggles stick for the
  // session (the sidebar lives in the persistent layout, so state survives
  // client-side navigation).
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    activeGroup ? { [activeGroup]: true } : {},
  );

  // On mount, expand every section if the window is tall enough to show them
  // all (bar a little scroll). Runs once: after this the user's toggles win,
  // and a later resize never collapses a section out from under them.
  useEffect(() => {
    if (window.innerHeight < expandedHeight(isAdmin) * FIT_TOLERANCE) return;
    setOpen((prev) => {
      const next = { ...prev };
      for (const group of NAV_GROUPS) {
        if (group.title) next[group.title] = true;
      }
      return next;
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!activeGroup) return;
    setOpen((prev) => (prev[activeGroup] ? prev : { ...prev, [activeGroup]: true }));
  }, [activeGroup]);

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4 font-semibold tracking-tight"
      >
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground shadow-sm shadow-primary/20 ring-1 ring-primary-foreground/15">
          <AppLogo className="size-5" />
        </span>
        <span className="truncate">{instanceName}</span>
      </Link>
      <ScrollArea className="flex-1 px-3 py-3">
        <nav className="flex flex-col gap-1">
          {NAV_GROUPS.map((group) => {
            const items = visibleItems(group, isAdmin);
            if (!group.title) {
              return items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
              ));
            }
            if (items.length === 0) return null; // e.g. an all-adminOnly group viewed by a user
            const isOpen = open[group.title] ?? false;
            const containsActive = group.title === activeGroup;
            return (
              <div key={group.title} className="flex flex-col">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((prev) => ({ ...prev, [group.title!]: !isOpen }))}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors",
                    "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {group.title}
                    {containsActive && !isOpen && (
                      <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                    )}
                  </span>
                  <ChevronRight
                    className={cn("size-3.5 transition-transform duration-200", isOpen && "rotate-90")}
                  />
                </button>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200",
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-border/60 pb-1 pl-2">
                      {items.map((item) => (
                        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
      </ScrollArea>
      <div className="border-t p-3">
        <Link
          href="/settings/profile"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
            pathname.startsWith("/settings")
              ? "bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <NavLinkBody icon={Settings} title="Settings" />
        </Link>
      </div>
    </div>
  );
}
