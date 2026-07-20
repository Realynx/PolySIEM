"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Container, Monitor, Server, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { title: string; href: string; icon: LucideIcon }[] = [
  { title: "Hosts", href: "/inventory/hosts", icon: Server },
  { title: "Virtual machines", href: "/inventory/vms", icon: Monitor },
  { title: "Containers", href: "/inventory/containers", icon: Container },
];

/** Section tabs for the compute inventory — one page, three views. */
export function ComputeTabs() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
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
