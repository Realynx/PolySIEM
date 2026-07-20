"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe, Network, Radio, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { title: string; href: string; icon: LucideIcon }[] = [
  { title: "Networks", href: "/network", icon: Network },
  { title: "IP addresses", href: "/network/ips", icon: Globe },
  { title: "Clients", href: "/network/dhcp", icon: Radio },
];

/** Section tabs for the networks page — subnets, their addresses and their clients. */
export function NetworkTabs() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b">
      {TABS.map((tab) => {
        // "Networks" is the parent route, so it only lights up on its own list
        // (and detail) pages — never while an IP/Clients subtab is showing.
        const active =
          tab.href === "/network" ? pathname === "/network" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary font-medium text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <tab.icon className="size-4" />
            {tab.title}
          </Link>
        );
      })}
    </div>
  );
}
