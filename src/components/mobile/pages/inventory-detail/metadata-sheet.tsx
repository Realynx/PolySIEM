"use client";

import { Braces, ChevronRight } from "lucide-react";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";

/**
 * Phone replacement for the desktop MetadataCard collapsible: a tappable card
 * row that opens the raw integration payload in a bottom sheet.
 */
export function MobileMetadataSheet({ metadata }: { metadata: unknown }) {
  if (metadata == null) return null;
  return (
    <BottomSheet
      title="Raw metadata"
      description="Integration payload recorded for this entity."
      trigger={
        <button
          type="button"
          className="flex min-h-13 w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-left transition-colors active:bg-muted/70"
        >
          <Braces className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm font-medium">Raw metadata</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
        </button>
      }
    >
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </BottomSheet>
  );
}
