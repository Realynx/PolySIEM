"use client";

import { Cable, Cloud, Globe, Monitor, Pin, Radar, Router, Share2, TriangleAlert, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { MapLegend } from "@/components/topology/map-legend";
import type { BandwidthData, BandwidthWindow } from "@/components/topology/use-bandwidth";

const BANDWIDTH_WINDOWS: BandwidthWindow[] = ["1h", "6h", "24h"];

/**
 * Bandwidth footer for the legend: a window selector when live counters flow,
 * a single quiet line when polling is off or the API user lacks the privilege.
 */
function BandwidthLegendRow({
  bandwidth,
  window,
  onWindowChange,
}: {
  bandwidth: BandwidthData | null;
  window: BandwidthWindow;
  onWindowChange: (w: BandwidthWindow) => void;
}) {
  if (!bandwidth) return null;
  if (!bandwidth.status.enabled) {
    return (
      <p
        className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground/70"
        title="Enable “Poll traffic counters” on the OPNsense integration to annotate paths with live bandwidth."
      >
        Bandwidth: off
      </p>
    );
  }
  const missing = bandwidth.status.skipped?.[0];
  if (missing && bandwidth.rules.length === 0) {
    return (
      <p
        className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-snug text-muted-foreground/70"
        title={`Grant the OPNsense API user the “${missing.missingPrivilege}” privilege to collect these counters.`}
      >
        Bandwidth: missing privilege “{missing.missingPrivilege}”
      </p>
    );
  }
  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
      <span className="text-[11px] text-muted-foreground">Bandwidth · avg</span>
      <div
        className="flex overflow-hidden rounded-md border border-border"
        role="group"
        aria-label="Bandwidth window"
      >
        {BANDWIDTH_WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onWindowChange(w)}
            className={cn(
              "px-1.5 py-0.5 text-[10px] font-medium transition-colors",
              w === window
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
            aria-pressed={w === window}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AccessMapLegend({
  unmapped,
  pveUnresolved,
  hasPve,
  hasCloudflare,
  hasTailscale,
  onResetLayout,
  hasSaved,
  bandwidth,
  bwWindow,
  onBwWindowChange,
}: {
  unmapped: string[];
  pveUnresolved: string[];
  hasPve: boolean;
  hasCloudflare: boolean;
  hasTailscale: boolean;
  onResetLayout: () => void;
  hasSaved: boolean;
  bandwidth: BandwidthData | null;
  bwWindow: BandwidthWindow;
  onBwWindowChange: (w: BandwidthWindow) => void;
}) {
  return (
    <MapLegend
      className="w-52 max-w-[calc(100%-1.5rem)] transition-[width] duration-200 data-[state=open]:w-[34rem]"
      onResetLayout={onResetLayout}
      hasSaved={hasSaved}
    >
      <ul className="grid gap-x-5 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-2">
        <li className="flex items-center gap-2">
          <span className="h-3 w-1 shrink-0 rounded bg-primary" /> LAN network
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-1 shrink-0 rounded bg-warning" /> Management
          network
        </li>
        <li className="flex items-center gap-2">
          <Globe className="size-3.5 shrink-0 text-info" /> WAN / Internet
        </li>
        <li className="flex items-center gap-2">
          <Monitor className="size-3.5 shrink-0 text-muted-foreground" /> Synced
          device / workload endpoint
        </li>
        <li className="flex items-center gap-2">
          <Router className="size-3.5 shrink-0 text-info" /> OPNsense interface
          gate for the VLAN
        </li>
        {hasCloudflare && (
          <li className="flex items-center gap-2">
            <Cloud className="size-3.5 shrink-0 text-info" /> Cloudflare
            published app / private route
          </li>
        )}
        {hasTailscale && (
          <>
            <li className="flex items-center gap-2">
              <Share2 className="size-3.5 shrink-0 text-indigo-500" /> Tailscale overlay membership
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-4 shrink-0 rounded [background:var(--color-chart-4)]" /> Enabled subnet / exit route
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-4 shrink-0 rounded bg-indigo-500" /> Policy-approved Tailscale peer path
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0 w-4 shrink-0 border-t border-dashed border-info" /> DNS / split-DNS route
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0 w-4 shrink-0 border-t-2 border-dashed [border-color:var(--color-chart-5)]" /> App connector entry point
            </li>
          </>
        )}
        <li className="flex items-center gap-2">
          <span className="h-0.5 w-4 shrink-0 rounded bg-success" /> Allowed
          packet path · label shows protocol/port and live rate
        </li>
        <li className="flex items-center gap-2">
          <Cable className="size-3.5 shrink-0 text-warning" /> Switch / VLAN
          delivery
        </li>
        <li className="flex items-center gap-2">
          <Wifi className="size-3.5 shrink-0 text-info" /> WiFi / SSID delivery
        </li>
        {hasPve && (
          <>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-4 shrink-0 rounded [background:var(--color-chart-3)]" />{" "}
              Proxmox workload policy
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0 w-4 shrink-0 border-t-2 [border-color:var(--color-chart-3)]" />{" "}
              Direct bidirectional peer path
            </li>
          </>
        )}
        <li className="flex items-center gap-2">
          <Wifi className="size-3.5 shrink-0 text-info" /> Dynamic DHCP lease
        </li>
        <li className="flex items-center gap-2">
          <Pin className="size-3.5 shrink-0" /> DHCP reservation
        </li>
        <li className="flex items-center gap-2">
          <Radar className="size-3.5 shrink-0 text-success" /> Detected device
          (ARP)
        </li>
      </ul>
      <p className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-snug text-muted-foreground">
        Read left to right: public ingress, delivery, and endpoint evidence → VLAN transit
        boundary → OPNsense interface gate → routed policy rails → workload
        policy. Click any rail for its packet class, source integration,
        supporting rules, and bandwidth history. Hover any node to spotlight
        its connected circuit; click the node to lock or clear that focus.
        Default-deny is assumed otherwise.
      </p>
      <BandwidthLegendRow
        bandwidth={bandwidth}
        window={bwWindow}
        onWindowChange={onBwWindowChange}
      />
      {(unmapped.length > 0 || pveUnresolved.length > 0) && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/60 p-1.5 text-[11px] leading-snug text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warning" />
          <span className="min-w-0 break-words">
            Unmapped: {[...unmapped, ...pveUnresolved].join(", ")}
          </span>
        </p>
      )}
    </MapLegend>
  );
}
