import type { ReactNode } from "react";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { cn } from "@/lib/utils";

/**
 * Shared frame for phone settings subpages: compact app bar backed by
 * /settings plus the page's forms stacked full width. The reused desktop form
 * components are already vertical; the two desktop-shaped habits they carry
 * (inputs capped at `max-w-sm`, inline submit buttons) are normalized here so
 * every subpage gets full-width fields and thumb-reachable submit buttons
 * without forking the forms.
 */
export function MobileSettingsSubpage({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <MobilePageHeader title={title} backHref="/settings" />
      <MobilePage
        className={cn(
          "[&_.max-w-sm]:max-w-none [&_button[type=submit]]:w-full",
          className,
        )}
      >
        {children}
      </MobilePage>
    </>
  );
}
