"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REFRESH_OPTIONS } from "./use-refresh-interval";

/** Theme-safe refresh picker shared by live topology maps. */
export function LiveRefreshControl({
  value,
  onValueChange,
  active = true,
  refreshing = false,
  className,
}: {
  value: number;
  onValueChange: (ms: number) => void;
  active?: boolean;
  refreshing?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg border bg-card/90 px-2 py-1 shadow-sm backdrop-blur",
        className,
      )}
    >
      <RefreshCw
        className={cn(
          "size-3 text-muted-foreground",
          refreshing && "animate-spin",
        )}
        aria-hidden
      />
      <span className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        <span
          className={cn(
            "size-1.5 rounded-full",
            active ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
          aria-hidden
        />
        Live
      </span>
      <Select
        value={String(value)}
        onValueChange={(next) => onValueChange(Number(next))}
      >
        <SelectTrigger
          size="sm"
          className="h-6 min-w-14 border-0 bg-transparent px-1 text-xs font-semibold tabular-nums shadow-none dark:bg-transparent dark:hover:bg-muted/40"
          aria-label="Live refresh interval"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" className="min-w-20">
          {REFRESH_OPTIONS.map((option) => (
            <SelectItem key={option.ms} value={String(option.ms)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
