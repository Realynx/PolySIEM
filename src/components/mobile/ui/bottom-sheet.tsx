"use client";

import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Wrapped with asChild — pass a button-like element. */
  trigger?: ReactNode;
  title: string;
  /** Screen-reader only when omitted from the visible header via hideHeader. */
  description?: string;
  hideHeader?: boolean;
  children: ReactNode;
  contentClassName?: string;
}

/**
 * Phone-native detail/filter surface: slides from the bottom with a drag
 * handle, rounds the top, caps at 85svh and scrolls inside. Use this instead
 * of popovers or side sheets in mobile page components.
 */
export function BottomSheet({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  hideHeader = false,
  children,
  contentClassName,
}: BottomSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[85svh] gap-0 rounded-t-2xl p-0"
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/25" aria-hidden />
        <div className={cn("flex flex-col gap-0.5 px-4 pt-2 pb-3", hideHeader && "sr-only")}>
          <SheetTitle className="text-[15px]">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="text-xs">{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
            contentClassName,
          )}
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
