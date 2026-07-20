"use client";

import {
  ACCOUNT_ITEMS,
  ADMIN_ITEMS,
  type SettingsNavItem,
} from "@/components/settings/settings-nav";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";

function IndexRows({ items }: { items: SettingsNavItem[] }) {
  return (
    <>
      {items.map((item) => (
        <MobileListRow
          key={item.href}
          href={item.href}
          leading={
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <item.icon className="size-4" />
            </span>
          }
          title={item.title}
        />
      ))}
    </>
  );
}

/**
 * Phone settings home: a native-style grouped index instead of the desktop
 * side nav. Rows mirror `SettingsNav` (same source arrays), including its
 * admin-only visibility.
 */
export function MobileSettingsIndexPage({ isAdmin }: { isAdmin: boolean }) {
  return (
    <>
      <MobilePageHeader title="Settings" />
      <MobilePage>
        <MobileSection title="Account">
          <MobileList>
            <IndexRows items={ACCOUNT_ITEMS} />
          </MobileList>
        </MobileSection>
        {isAdmin && (
          <MobileSection title="Administration">
            <MobileList>
              <IndexRows items={ADMIN_ITEMS} />
            </MobileList>
          </MobileSection>
        )}
      </MobilePage>
    </>
  );
}
