"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The four sibling views inside one edge server, in the same order as the
 * desktop card's tabs. Kept local to the phone tree for now — if the desktop
 * layer promotes the order to `edge-networks-types.ts`, import it from there
 * instead of redeclaring it here.
 */
export const EDGE_SERVER_TABS = ["routes", "connectors", "tunnel", "interfaces"] as const;

export type EdgeServerTab = (typeof EDGE_SERVER_TABS)[number];

export interface MobileSegmentedTab<T extends string> {
  key: T;
  label: string;
  /** Compact second line: rule count, "2/3", "On", detected interfaces… */
  badge?: string;
  tone?: "muted" | "success" | "warning";
}

const TONE_CLASS: Record<"muted" | "success" | "warning", string> = {
  muted: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
};

function SegmentButton<T extends string>({
  tab,
  idBase,
  selected,
  onSelect,
}: {
  tab: MobileSegmentedTab<T>;
  idBase: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`${idBase}-tab-${tab.key}`}
      aria-controls={`${idBase}-panel-${tab.key}`}
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 transition-colors",
        selected ? "bg-background shadow-sm" : "active:bg-background/60",
      )}
    >
      <span
        className={cn(
          "text-[12px] leading-none font-medium",
          selected ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {tab.label}
      </span>
      {tab.badge ? (
        <span className={cn("font-mono text-[10px] leading-none", TONE_CLASS[tab.tone ?? "muted"])}>
          {tab.badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * State-driven segmented control. `MobileSegmented` in `mobile/ui` is the
 * URL-driven sibling (one active tab per page); this one switches sibling
 * views *inside* a repeated card, where several controls coexist on one screen
 * and the choice belongs to component state, not the address bar.
 */
export function MobileStateSegmented<T extends string>({
  idBase,
  ariaLabel,
  tabs,
  value,
  onChange,
  className,
}: {
  idBase: string;
  ariaLabel: string;
  tabs: readonly MobileSegmentedTab<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex rounded-lg bg-muted p-0.5", className)}>
      {tabs.map((tab) => (
        <SegmentButton
          key={tab.key}
          tab={tab}
          idBase={idBase}
          selected={tab.key === value}
          onSelect={() => onChange(tab.key)}
        />
      ))}
    </div>
  );
}

/** The panel a `MobileStateSegmented` tab controls. Only the selected one renders. */
export function MobileTabPanel({
  idBase,
  tab,
  children,
}: {
  idBase: string;
  tab: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${tab}`}
      aria-labelledby={`${idBase}-tab-${tab}`}
      className="flex flex-col gap-1.5"
    >
      {children}
    </div>
  );
}
