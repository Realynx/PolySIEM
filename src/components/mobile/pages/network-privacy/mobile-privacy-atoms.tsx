"use client";

import type { ReactNode } from "react";
import { Cpu, Info, ScanEye, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  privacyRuleTierView,
  type VpnConcurrencyNotice,
  type VpnExitHealthView,
  type VpnExitTone,
} from "@/components/network/privacy-router-presentation";
import type { PrivacyRuleTier } from "@/components/network/privacy-router-types";

/**
 * The small repeated pieces of the phone privacy router surface.
 *
 * Every word these render arrives already written by
 * `network/privacy-router-presentation` — the tier label and its explanation, the
 * exit state and what "up" means, the concurrency notice. What lives here is
 * only the phone treatment of them: which tone earns amber, how a badge is
 * sized for a 412px row, and how a notice looks when it is a block of text
 * rather than a desktop `Alert`.
 */

/** Amber is genuine risk; info is "PolySIEM has not proved this yet". */
export type PrivacyNoticeTone = "warning" | "info" | "danger";

const NOTICE_CLASS: Record<PrivacyNoticeTone, string> = {
  warning: "border-warning/30 bg-warning/5 text-warning",
  info: "border-info/30 bg-info/5 text-info",
  danger: "border-destructive/30 bg-destructive/5 text-destructive",
};

/** Block-level consequence text. The title says what, the detail says why. */
export function PrivacyNotice({
  tone,
  title,
  detail,
}: {
  tone: PrivacyNoticeTone;
  title?: string;
  detail: ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-1.5 rounded-xl border px-3 py-2 text-xs", NOTICE_CLASS[tone])}>
      {tone === "info" ? (
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0">
        {title && <span className="block font-medium">{title}</span>}
        <span className={cn("block leading-snug", title && "mt-0.5")}>{detail}</span>
      </span>
    </div>
  );
}

/**
 * A concurrency verdict on a phone — the router-wide `exitsConcurrent` notice,
 * or the per-exit unproven summary that outlives a `true`.
 *
 * `false` is the one place this feature can silently under-deliver, so it is
 * amber and explained; `null` reads as "not probed yet", which is a different
 * claim from "fine" and is styled as information rather than a fault.
 */
export function VpnConcurrencyBlock({ notice }: { notice: VpnConcurrencyNotice | null }) {
  if (!notice) return null;
  return (
    <PrivacyNotice
      tone={notice.tone === "warning" ? "warning" : "info"}
      title={notice.title}
      detail={notice.detail}
    />
  );
}

/**
 * Kernel or Inspected, derived from the whole ordered list.
 *
 * The badge is on every row for the same reason it is on desktop: reordering
 * changes it, so it is the visible half of a decision the operator can act on.
 */
export function PrivacyTierBadge({ tier, className }: { tier: PrivacyRuleTier; className?: string }) {
  const view = privacyRuleTierView(tier);
  const Icon = tier === "kernel" ? Cpu : ScanEye;
  return (
    <Badge
      variant={tier === "kernel" ? "secondary" : "outline"}
      className={cn("gap-1 text-[10px] font-normal", className)}
    >
      <Icon className="size-2.5" aria-hidden="true" />
      {view.label}
    </Badge>
  );
}

const EXIT_TONE_VARIANT: Record<VpnExitTone, "secondary" | "destructive" | "outline"> = {
  up: "secondary",
  down: "destructive",
  disabled: "outline",
  unknown: "outline",
};

/** One exit's state. "Up" means link up AND a handshake inside the limit. */
export function VpnExitStateBadge({ health }: { health: VpnExitHealthView }) {
  return (
    <Badge variant={EXIT_TONE_VARIANT[health.tone]} className="text-[10px] font-normal">
      {health.tone === "up" && <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />}
      {health.label}
    </Badge>
  );
}

/** A wrapped explanation under a key row — the phone stand-in for a tooltip. */
export function PrivacyDetailNote({ children }: { children: ReactNode }) {
  return <p className="px-3.5 pb-2 text-[11px] leading-snug text-muted-foreground">{children}</p>;
}

/** Section caption + optional trailing count, for a list that needs framing. */
export function PrivacyListNote({ children }: { children: ReactNode }) {
  return <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">{children}</p>;
}
