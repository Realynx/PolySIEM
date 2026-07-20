import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Floating action button for a page's single primary action, docked above the
 * tab bar. Spreads props so it composes with Radix triggers:
 * `<EntityFormDialog trigger={<MobileFab aria-label="Add host"><Plus /></MobileFab>} />`
 */
export function MobileFab({ className, children, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex size-13 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg transition-transform outline-none active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-6",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
