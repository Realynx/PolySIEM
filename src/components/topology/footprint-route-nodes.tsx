"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Cable, CircleHelp, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { hiddenHandle } from "@/components/topology/topology-canvas";
import type { DnsClassification } from "@/lib/topology/footprint";
import {
  ROUTE_HEIGHT,
  ROUTE_WIDTH,
  SWITCH_HEIGHT,
  SWITCH_WIDTH,
  TUNNEL_HEIGHT,
  TUNNEL_WIDTH,
  UNKNOWN_MAX_RULES,
  UNKNOWN_WIDTH,
  type FpSwitchNodeType,
  type RouteNodeType,
  type TunnelNodeType,
  type UnknownNodeType,
} from "@/components/topology/footprint-node-model";
export const FpSwitchNode = memo(function FpSwitchNode({
  data,
}: NodeProps<FpSwitchNodeType>) {
  return (
    <div
      className="flex h-full w-full items-center gap-3 rounded-xl border border-border border-l-4 border-l-warning bg-card px-3 shadow-sm"
      style={{ width: SWITCH_WIDTH, height: SWITCH_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <Cable className="size-5 shrink-0 text-warning" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-card-foreground">
          {data.machine.name}
        </p>
        <p className="text-xs text-muted-foreground">switch</p>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="side"
        className={hiddenHandle}
      />
    </div>
  );
});

/** Dot color per DNS classification (shared by route pills + legend). */
export const ROUTE_DOT: Record<DnsClassification, string> = {
  proxied: "[background:var(--color-chart-3)]",
  "unproxied-wan-exposed": "bg-destructive",
  "unproxied-other": "bg-warning",
  unresolved: "bg-muted-foreground/40",
};

const ROUTE_TITLE: Record<DnsClassification, string> = {
  proxied: "proxied — traffic enters via the provider edge",
  "unproxied-wan-exposed": "EXPOSED — resolves straight to your WAN",
  "unproxied-other": "direct — not behind the provider edge",
  unresolved: "no public DNS records",
};

/** Semantic junction for one ingress tunnel; related hostname lines branch here. */
export const TunnelNode = memo(function TunnelNode({
  data,
}: NodeProps<TunnelNodeType>) {
  const { tunnel, routeCount, count } = data;
  return (
    <div
      className="flex h-full w-full cursor-pointer items-center gap-2.5 rounded-xl border bg-card px-3 shadow-sm transition-colors hover:[border-color:color-mix(in_oklab,var(--color-chart-3)_65%,transparent)] [border-color:color-mix(in_oklab,var(--color-chart-3)_35%,var(--color-border))]"
      style={{ width: TUNNEL_WIDTH, height: TUNNEL_HEIGHT }}
      title={`${tunnel.name}\n${routeCount} published route${routeCount === 1 ? "" : "s"}\n${tunnel.provider}`}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg [background:color-mix(in_oklab,var(--color-chart-3)_13%,transparent)]">
        <Cloud className="size-4 [color:var(--color-chart-3)]" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-tight text-card-foreground">
          {tunnel.name}
        </p>
        <p className="truncate text-[10px] leading-tight text-muted-foreground">
          {tunnel.provider} · {routeCount} route{routeCount === 1 ? "" : "s"}
        </p>
      </div>
      {count !== undefined && (
        <span className="shrink-0 rounded-full border border-border bg-muted/60 px-1.5 text-[9px] font-medium tabular-nums leading-[16px] text-muted-foreground">
          {formatCount(count)}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  );
});

/** A published application route (tunnel ingress hostname), drawn as a compact pill. */
export const RouteNode = memo(function RouteNode({
  data,
}: NodeProps<RouteNodeType>) {
  const { route, count } = data;
  const exposed = route.classification === "unproxied-wan-exposed";
  return (
    <div
      className={cn(
        "flex h-full w-full cursor-pointer items-center gap-1.5 rounded-full border bg-card px-2 shadow-sm transition-colors",
        exposed
          ? "border-destructive/70 bg-destructive/5 hover:border-destructive"
          : "border-border hover:[border-color:color-mix(in_oklab,var(--color-chart-3)_60%,transparent)]",
      )}
      style={{ width: ROUTE_WIDTH, height: ROUTE_HEIGHT }}
      title={`${route.hostname}\n${ROUTE_TITLE[route.classification]}\nvia ${route.tunnelName}`}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          ROUTE_DOT[route.classification],
        )}
        aria-hidden
      />
      <Cloud
        className="size-3 shrink-0 [color:var(--color-chart-3)]"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium leading-none text-card-foreground">
        {route.hostname}
      </span>
      {count !== undefined && (
        <span className="shrink-0 rounded-full border border-border bg-muted/60 px-1 text-[9px] font-medium tabular-nums leading-[14px] text-muted-foreground">
          {formatCount(count)}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  );
});

export const UnknownNode = memo(function UnknownNode({
  data,
}: NodeProps<UnknownNodeType>) {
  const visibleRules = data.natRules.slice(0, UNKNOWN_MAX_RULES);
  const hiddenRules = data.natRules.length - visibleRules.length;
  const scopeLabel = (
    value: string | null,
    kind: "source" | "destination",
  ) => {
    const normalized = value?.trim();
    if (
      !normalized ||
      normalized === "*" ||
      normalized.toLowerCase() === "any"
    ) {
      return kind === "source" ? "all addresses" : "all destinations";
    }
    if (
      kind === "destination" &&
      ["wanip", "wan address", "this firewall"].includes(
        normalized.toLowerCase(),
      )
    ) {
      return "WAN address";
    }
    return normalized;
  };
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-dashed border-destructive/60 bg-card shadow-sm"
      style={{ width: UNKNOWN_WIDTH }}
      title={data.target.via.join("\n")}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <Handle
        type="target"
        position={Position.Left}
        id="nat-in"
        className={hiddenHandle}
      />
      <div className="flex min-h-[50px] shrink-0 items-center gap-2.5 bg-destructive/5 px-3">
        <CircleHelp className="size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-medium text-card-foreground">
            {data.target.ip}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {data.natRules.length > 0
              ? `${data.natRules.length} NAT rule${data.natRules.length === 1 ? "" : "s"}`
              : "undocumented target"}
          </p>
        </div>
      </div>
      {visibleRules.length > 0 && (
        <div className="border-t border-destructive/15 px-2 py-1.5">
          <ul className="space-y-1">
            {visibleRules.map((rule) => {
              const destination = scopeLabel(
                rule.destinationSpec,
                "destination",
              );
              const source = scopeLabel(rule.sourceSpec, "source");
              return (
                <li
                  key={rule.id}
                  className="rounded-md border border-border/70 bg-muted/35 px-2 py-1"
                  title={`${rule.protocol.toUpperCase()} ${rule.publicPort} → ${data.target.ip}:${rule.targetPort}\nAffects ${destination}\nFrom ${source}${rule.enabled ? "" : "\nDisabled"}`}
                >
                  <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-medium leading-tight text-card-foreground">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        rule.enabled ? "bg-destructive" : "bg-muted-foreground/40",
                      )}
                      aria-label={rule.enabled ? "enabled" : "disabled"}
                    />
                    <span className="shrink-0 uppercase">{rule.protocol}</span>
                    <span className="truncate">
                      {rule.publicPort} → {rule.targetPort}
                    </span>
                  </div>
                  <p className="truncate pl-3 font-mono text-[9px] leading-tight text-muted-foreground">
                    {destination} · from {source}
                  </p>
                </li>
              );
            })}
          </ul>
          {hiddenRules > 0 && (
            <p className="px-1 pt-1 text-[9px] italic leading-none text-muted-foreground">
              +{hiddenRules} more NAT rule{hiddenRules === 1 ? "" : "s"}
            </p>
          )}
        </div>
      )}
    </div>
  );
});
