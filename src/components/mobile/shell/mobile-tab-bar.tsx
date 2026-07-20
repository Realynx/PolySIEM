"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Ellipsis,
  LayoutDashboard,
  Network,
  Server,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileMoreSheet, type MobileShellUser } from "./mobile-more-sheet";

interface Tab {
  title: string;
  href: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

/**
 * The four primary destinations. Everything else lives in the More sheet, so
 * this list only changes when the app's top-level shape does.
 */
const TABS: Tab[] = [
  { title: "Home", href: "/", icon: LayoutDashboard, match: (p) => p === "/" },
  { title: "Lab", href: "/inventory/hosts", icon: Server, match: (p) => p.startsWith("/inventory") },
  {
    title: "Network",
    href: "/network",
    icon: Network,
    match: (p) => p.startsWith("/network") || p.startsWith("/firewall"),
  },
  {
    title: "Security",
    href: "/security",
    icon: Shield,
    match: (p) =>
      p.startsWith("/security") ||
      p.startsWith("/keys") ||
      p.startsWith("/credentials") ||
      p.startsWith("/logs/threats"),
  },
];

function TabButton({
  title,
  icon: Icon,
  active,
}: {
  title: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <span
      className={cn(
        "flex h-full flex-col items-center justify-center gap-0.5 transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
      <span className="text-[10px] leading-none font-medium tracking-wide">{title}</span>
    </span>
  );
}

/** Fixed bottom navigation — the phone shell's spine. */
export function MobileTabBar({
  instanceName,
  user,
}: {
  instanceName: string;
  user: MobileShellUser;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabActive = TABS.some((t) => t.match(pathname));

  return (
    <>
      <nav
        aria-label="Primary"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 no-gpu:bg-background print:hidden"
      >
        <div className="grid h-14 grid-cols-5">
          {TABS.map((tab) => (
            <Link key={tab.href} href={tab.href} className="active:opacity-60" aria-label={tab.title}>
              <TabButton title={tab.title} icon={tab.icon} active={tab.match(pathname)} />
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="active:opacity-60"
            aria-label="More"
          >
            <TabButton title="More" icon={Ellipsis} active={moreOpen || !tabActive} />
          </button>
        </div>
      </nav>
      <MobileMoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        instanceName={instanceName}
        user={user}
      />
    </>
  );
}
