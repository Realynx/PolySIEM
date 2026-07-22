"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import { pushWithNavigationFeedback } from "@/components/shell/navigation-feedback";
import { Cable, Container, HardDrive, Monitor, Server, ShieldCheck, type LucideIcon } from "lucide-react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hiddenHandle } from "@/components/topology/topology-canvas";

/* ---------------- dimensions (shared with the dagre layout pass) ---------------- */

export const CARD_WIDTH = 300;
const CARD_PAD = 10;
const HEADER_HEIGHT = 82;
const GROUP_CAPTION_HEIGHT = 20;
const CHIP_HEIGHT = 44;
const CHIP_GAP = 4;
const GROUP_GAP = 6;

function groupHeight(count: number): number {
  const rows = Math.ceil(count / 2);
  return GROUP_CAPTION_HEIGHT + rows * CHIP_HEIGHT + (rows - 1) * CHIP_GAP;
}

/** Card height for a host with the given guest-group sizes (0 = group absent). */
export function hostCardHeight(vmCount: number, ctCount: number): number {
  let height = CARD_PAD * 2 + HEADER_HEIGHT;
  const groups = [vmCount, ctCount].filter((n) => n > 0);
  for (const count of groups) height += GROUP_GAP + groupHeight(count);
  return height;
}

export interface MapGuest {
  id: string;
  type: "vm" | "container";
  name: string;
  vmid: number | null;
  status: string;
  powerState: string;
  osName: string | null;
  metricKey: string | null;
  cpuUsage?: number | null;
  memoryUsedBytes?: number | null;
  memoryTotalBytes?: number | null;
}

export type HostCardData = {
  /** Device id — duplicated into data so the header link can navigate. */
  id: string;
  name: string;
  kind: string;
  status: string;
  osName: string | null;
  cpuCores: number | null;
  memoryBytes: number | null;
  cpuUsage: number | null;
  memoryUsedBytes: number | null;
  uptimeSec: number | null;
  vms: MapGuest[];
  containers: MapGuest[];
};

export type HostCardFlowNode = Node<HostCardData, "hostCard">;
export type InventoryFlowNode = HostCardFlowNode;

const KIND_ICON: Record<string, LucideIcon> = {
  firewall: ShieldCheck,
  switch: Cable,
  nas: HardDrive,
  storage: HardDrive,
};

/** Power-state indicator dot, colored per state. */
export function PowerDot({ powerState, className }: { powerState: string; className?: string }) {
  return (
    <span
      title={powerState.toLowerCase()}
      className={cn(
        "size-2 shrink-0 rounded-full",
        powerState === "RUNNING" && "bg-emerald-500",
        powerState === "PAUSED" && "bg-amber-500",
        (powerState === "STOPPED" || powerState === "UNKNOWN") && "bg-muted-foreground/40",
        className,
      )}
    />
  );
}

function GuestChip({ guest }: { guest: MapGuest }) {
  const router = useRouter();
  const Icon = guest.type === "vm" ? Monitor : Container;
  const href = `/inventory/${guest.type === "vm" ? "vms" : "containers"}/${guest.id}`;
  const cpu = guest.cpuUsage == null ? null : Math.round(guest.cpuUsage * 100);
  const memory = guest.memoryUsedBytes != null && guest.memoryTotalBytes
    ? Math.round((guest.memoryUsedBytes / guest.memoryTotalBytes) * 100)
    : null;
  return (
    <button
      type="button"
      title={`${guest.name}${guest.vmid != null ? ` (${guest.type === "vm" ? "VM" : "CT"} ${guest.vmid})` : ""}${guest.osName ? ` · ${guest.osName}` : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        pushWithNavigationFeedback(router, href);
      }}
      className={cn(
        "nodrag flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-muted/60 px-1.5 text-left transition-colors hover:border-primary/50 hover:bg-muted",
        guest.status === "STALE" && "opacity-60",
      )}
      style={{ height: CHIP_HEIGHT }}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[11px] leading-tight text-card-foreground">{guest.name}</span>
          <PowerDot powerState={guest.powerState} />
        </span>
        <span className="grid gap-0.5 pl-[18px]">
          {([[
            "CPU",
            cpu,
          ], [
            "RAM",
            memory,
          ]] as const).map(([label, value]) => (
            <span key={label} className="flex items-center gap-1" title={`${label} ${value == null ? "unavailable" : `${value}%`}`}>
              <span className="w-4 font-mono text-[7px] leading-none text-muted-foreground">{label}</span>
              <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-background/70">
                <span
                  className={cn("block h-full rounded-full bg-primary", value !== null && value >= 85 && "bg-warning")}
                  style={{ width: `${value ?? 0}%` }}
                />
              </span>
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

function GuestGroup({ label, guests }: { label: string; guests: MapGuest[] }) {
  const running = guests.filter((g) => g.powerState === "RUNNING").length;
  return (
    <div style={{ marginTop: GROUP_GAP }}>
      <p
        className="flex items-baseline gap-1.5 px-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
        style={{ height: GROUP_CAPTION_HEIGHT }}
      >
        {label} <span>· {running}/{guests.length} up</span>
      </p>
      <div className="grid grid-cols-2" style={{ gap: CHIP_GAP }}>
        {guests.map((guest) => (
          <GuestChip key={guest.id} guest={guest} />
        ))}
      </div>
    </div>
  );
}

/**
 * One compact card per physical device: header with kind/specs, then its
 * guests as dense two-column chip grids grouped by type. Guests are inline
 * chips (not nodes) — clicking a chip opens the guest, the header the host.
 */
export const HostCardNode = memo(function HostCardNode({ data, width, height }: NodeProps<HostCardFlowNode>) {
  const router = useRouter();
  const Icon = KIND_ICON[data.kind] ?? Server;
  const specs = [
    data.cpuCores != null ? `${data.cpuCores}c` : null,
    data.memoryBytes != null ? formatBytes(data.memoryBytes) : null,
    data.osName,
  ].filter(Boolean);
  const cpu = data.cpuUsage == null ? null : Math.round(data.cpuUsage * 100);
  const memory = data.memoryUsedBytes != null && data.memoryBytes
    ? Math.round((data.memoryUsedBytes / data.memoryBytes) * 100)
    : null;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col rounded-xl border border-border bg-card shadow-sm",
        data.status === "STALE" && "border-dashed opacity-70",
      )}
      style={{ width, height, padding: CARD_PAD }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          pushWithNavigationFeedback(router, `/inventory/hosts/${data.id}`);
        }}
        className="nodrag group flex w-full cursor-pointer flex-col justify-center rounded-lg text-left"
        style={{ height: HEADER_HEIGHT - 4 }}
      >
        <div className="flex w-full items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-primary/10">
            <Icon className="size-4.5 text-muted-foreground transition-colors group-hover:text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-card-foreground group-hover:text-primary">
              {data.name}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              <span className="capitalize">{data.kind}</span>
              {specs.length > 0 && <> · {specs.join(" · ")}</>}
            </p>
          </div>
        </div>
        <div className="mt-1.5 grid w-full grid-cols-2 gap-3 px-0.5">
          {([[
            "CPU",
            cpu,
          ], [
            "RAM",
            memory,
          ]] as const).map(([label, value]) => (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between font-mono text-[9px] text-muted-foreground">
                <span>{label}</span><span>{value == null ? "—" : `${value}%`}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full bg-primary transition-[width] duration-500", value !== null && value >= 85 && "bg-warning")}
                  style={{ width: `${value ?? 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </button>

      {data.vms.length > 0 && <GuestGroup label="VMs" guests={data.vms} />}
      {data.containers.length > 0 && <GuestGroup label="Containers" guests={data.containers} />}

      <Handle type="source" position={Position.Bottom} className={hiddenHandle} />
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
    </div>
  );
});
