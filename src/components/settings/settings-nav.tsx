"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DatabaseBackup,
  EyeOff,
  Info,
  KeyRound,
  Palette,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SettingsNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const ACCOUNT_ITEMS: SettingsNavItem[] = [
  { title: "Profile", href: "/settings/profile", icon: User },
  { title: "Appearance", href: "/settings/appearance", icon: Palette },
  { title: "Privacy", href: "/settings/privacy", icon: EyeOff },
];

/** Admin-only settings; System (instance-wide defaults) leads the section. */
export const ADMIN_ITEMS: SettingsNavItem[] = [
  { title: "System", href: "/settings/system", icon: SlidersHorizontal },
  { title: "Users", href: "/settings/users", icon: Users },
  { title: "Integrations", href: "/settings/integrations", icon: Plug },
  { title: "AI assistant", href: "/settings/ai", icon: Sparkles },
  { title: "API tokens", href: "/settings/api-tokens", icon: KeyRound },
  { title: "Web certificate", href: "/settings/certificate", icon: ShieldCheck },
  { title: "Backup & restore", href: "/settings/backup", icon: DatabaseBackup },
  { title: "Danger area", href: "/settings/danger", icon: TriangleAlert },
  { title: "About", href: "/settings/about", icon: Info },
];

function NavLinks({ items, pathname }: { items: SettingsNavItem[]; pathname: string }) {
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {item.title}
          </Link>
        );
      })}
    </>
  );
}

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings"
      className="flex w-full flex-row items-center gap-0.5 overflow-x-auto pb-1 md:w-48 md:shrink-0 md:flex-col md:items-stretch md:gap-4 md:overflow-visible md:pb-0"
    >
      <div className="flex shrink-0 flex-row gap-0.5 md:flex-col">
        <NavLinks items={ACCOUNT_ITEMS} pathname={pathname} />
      </div>
      {isAdmin && (
        <>
          <div aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-border md:hidden" />
          <div className="flex shrink-0 flex-row gap-0.5 md:flex-col">
            <p className="hidden px-2.5 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase md:block">
              Administration
            </p>
            <NavLinks items={ADMIN_ITEMS} pathname={pathname} />
          </div>
        </>
      )}
    </nav>
  );
}
