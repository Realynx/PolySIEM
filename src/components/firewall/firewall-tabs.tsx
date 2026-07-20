"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListTree, Shield, ShieldCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { title: string; href: string; icon: LucideIcon }[] = [
  { title: "Overview", href: "/firewall", icon: Shield },
  { title: "Rules", href: "/firewall/rules", icon: ShieldCheck },
  { title: "Aliases", href: "/firewall/aliases", icon: ListTree },
];

/** Section tabs rendered by the firewall layout — one page, three views. */
export function FirewallTabs() {
  const pathname = usePathname();

  return (
    <div className="mb-5 flex min-w-0 flex-wrap items-end gap-1 border-b">
      {TABS.map((tab) => {
        const active = tab.href === "/firewall" ? pathname === "/firewall" : pathname.startsWith(tab.href);
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
