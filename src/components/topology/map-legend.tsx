"use client";

import { ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Shared legend card for topology maps: title, map-specific body, and the
 * reset-layout button that appears once the user has dragged nodes.
 */
export function MapLegend({
  onResetLayout,
  hasSaved,
  className,
  children,
}: {
  onResetLayout: () => void;
  hasSaved: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      defaultOpen
      className={cn(
        "group absolute right-3 top-3 z-10 rounded-xl border border-border bg-card/90 p-2.5 shadow-sm backdrop-blur",
        className,
      )}
    >
      <div className="flex h-6 items-center gap-1">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-1 text-left text-xs font-semibold text-card-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>Legend</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        {hasSaved && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={onResetLayout}
            title="Reset layout"
            aria-label="Reset layout"
          >
            <RotateCcw className="size-3" />
          </Button>
        )}
      </div>
      <CollapsibleContent className="pt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
